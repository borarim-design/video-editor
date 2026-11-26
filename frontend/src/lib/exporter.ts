/**
 * 브라우저 단독 내보내기.
 *
 * 서버(/api/render) 없이 **오프스크린 Canvas + captureStream() + MediaRecorder**
 * 로 미리보기와 똑같은 프레임(트림·비율 크롭·모자이크·후킹 타이틀·자막)을 합성하고,
 * 원본 영상의 오디오는 Web Audio API 로 같은 스트림에 실어 준다.
 *
 * 결과물: 브라우저가 MP4 녹화를 지원하면 MP4(video/mp4), 아니면 WebM(video/webm).
 * 그리는 함수는 미리보기와 동일한 drawPreview() 를 쓰므로 결과가 화면과 일치한다.
 */
import type { EditSpec, ExportResult, PersonTrack } from '../types';
import { drawPreview } from './preview';
import { outputGeometry } from './layout';
import { clamp } from './format';

export class ExportCanceledError extends Error {
  constructor() {
    super('내보내기를 취소했습니다.');
    this.name = 'ExportCanceledError';
  }
}

export interface ExportParams {
  /** 편집 대상 원본 영상(숨김 <video>). 미리보기 요소와 별개여야 한다. */
  video: HTMLVideoElement;
  projectWidth: number;
  projectHeight: number;
  spec: EditSpec;
  tracks: PersonTrack[];
  trim: { start: number; end: number };
  hasAudio: boolean;
  fps: number;
  fileBaseName?: string;
  onProgress?: (ratio: number, message: string) => void;
  /** 취소 함수를 넘겨받는다(진행 중 버튼에서 사용). */
  onCancelReady?: (cancel: () => void) => void;
}

interface AudioGraph {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  dest: MediaStreamAudioDestinationNode;
}

/** createMediaElementSource 는 요소당 한 번만 만들 수 있어 WeakMap 에 보관한다. */
const audioGraphs = new WeakMap<HTMLVideoElement, AudioGraph>();

function ensureAudioGraph(video: HTMLVideoElement): AudioGraph | null {
  try {
    const existing = audioGraphs.get(video);
    if (existing) return existing;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    const source = ctx.createMediaElementSource(video);
    const dest = ctx.createMediaStreamDestination();
    // 스피커로는 보내지 않는다(내보내는 동안 소리가 나지 않게). 스트림으로만 흘려보낸다.
    source.connect(dest);
    const graph: AudioGraph = { ctx, source, dest };
    audioGraphs.set(video, graph);
    return graph;
  } catch {
    return null;
  }
}

const AUDIO_CODECS = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.4D401F,mp4a.40.2', 'video/mp4;codecs=h264,aac', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

const SILENT_CODECS = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1.4D401F', 'video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

function pickMimeType(withAudio: boolean): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  const candidates = withAudio ? AUDIO_CODECS : SILENT_CODECS;
  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function waitReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error('영상을 불러오지 못했습니다. 페이지를 새로 고친 뒤 다시 시도해 주세요.'));
    };
    const cleanup = () => {
      video.removeEventListener('loadeddata', ok);
      video.removeEventListener('error', fail);
      window.clearTimeout(timer);
    };
    const timer = window.setTimeout(ok, 10000);
    video.addEventListener('loadeddata', ok);
    video.addEventListener('error', fail);
  });
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  const target = clamp(t, 0, Math.max(0, video.duration || t));
  if (Math.abs(video.currentTime - target) < 0.005) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, 5000);
    video.addEventListener('seeked', done);
    try {
      video.currentTime = target;
    } catch {
      done();
    }
  });
}

function baseName(name: string | undefined): string {
  if (!name) return 'reelcut';
  const trimmed = name.replace(/\.[^.]+$/, '');
  return trimmed || 'reelcut';
}

/** 이 브라우저가 만들 수 있는 컨테이너 이름(버튼 표기용) */
export function exportFormatLabel(): 'MP4' | 'WebM' {
  const mime = pickMimeType(true);
  return mime && mime.startsWith('video/mp4') ? 'MP4' : 'WebM';
}

/** 실시간 재생을 그대로 녹화한다(오디오·영상 싱크 유지). */
export async function exportVideo(params: ExportParams): Promise<ExportResult> {
  const { video, projectWidth, projectHeight, spec, tracks, trim, hasAudio } = params;
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('이 브라우저는 영상 내보내기(MediaRecorder)를 지원하지 않습니다. Chrome·Edge 최신 버전에서 시도해 주세요.');
  }

  const start = Math.max(0, Math.min(trim.start, trim.end));
  const end = Math.max(start + 0.05, trim.end);
  const duration = end - start;
  const outFps = clamp(Math.round(params.fps || 30), 12, 60);
  const geo = outputGeometry(projectWidth, projectHeight, spec.aspect);

  const canvas = document.createElement('canvas');
  canvas.width = geo.outW;
  canvas.height = geo.outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들지 못했습니다.');

  await waitReady(video);

  // ---- 오디오(Web Audio) ----
  const graph = hasAudio ? ensureAudioGraph(video) : null;
  if (graph) {
    try {
      await graph.ctx.resume();
    } catch {
      /* 사용자 조작 후 다시 시도된다 */
    }
  }

  // ---- 캔버스 + 오디오 → 하나의 MediaStream ----
  const canvasEl = canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream };
  if (typeof canvasEl.captureStream !== 'function') {
    throw new Error('이 브라우저는 캔버스 녹화(captureStream)를 지원하지 않습니다. Chrome·Edge 최신 버전에서 시도해 주세요.');
  }
  const canvasStream = canvasEl.captureStream(outFps);

  const stream = new MediaStream();
  canvasStream.getVideoTracks().forEach((t) => stream.addTrack(t));
  const audioTrack = graph?.dest.stream.getAudioTracks()[0] ?? null;
  if (audioTrack) stream.addTrack(audioTrack);

  const mimeType = pickMimeType(Boolean(audioTrack));
  if (!mimeType) {
    canvasStream.getVideoTracks().forEach((t) => t.stop());
    throw new Error('이 브라우저에서는 MP4/WebM 녹화를 지원하지 않습니다. Chrome·Edge 최신 버전에서 시도해 주세요.');
  }

  const bitrate = Math.round(clamp(geo.outW * geo.outH * outFps * 0.12, 4_000_000, 20_000_000));
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate, audioBitsPerSecond: 128_000 });
  } catch {
    recorder = new MediaRecorder(stream, { mimeType });
  }

  const chunks: BlobPart[] = [];
  let stopped = false;
  let canceled = false;
  let rafId = 0;
  let watchdog = 0;

  const blobPromise = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType.split(';')[0] }));
    recorder.onerror = (event) => {
      const detail = (event as unknown as { error?: { message?: string } }).error;
      reject(new Error(detail?.message ? `녹화 중 오류: ${detail.message}` : '녹화 중 오류가 발생했습니다.'));
    };
  });

  const startedAt = performance.now();

  const draw = () => {
    const tSource = video.currentTime;
    drawPreview({
      canvas,
      video,
      projectWidth,
      projectHeight,
      spec,
      tracks,
      t: Math.max(0, tSource - start),
      tSource,
    });
  };

  const stopRecorder = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(watchdog);
    if (rafId) window.cancelAnimationFrame(rafId);
    try {
      video.pause();
    } catch {
      /* ignore */
    }
    if (recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }
  };

  params.onCancelReady?.(() => {
    canceled = true;
    stopRecorder();
  });

  const anyVideo = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number, meta: unknown) => void) => number;
    cancelVideoFrameCallback?: (id: number) => void;
  };

  const tick = () => {
    if (stopped) return;
    draw();
    const t = video.currentTime;
    const ratio = clamp((t - start) / duration, 0, 1);
    params.onProgress?.(ratio, ratio >= 1 ? '마무리 중…' : `내보내는 중… ${Math.round(ratio * 100)}%`);
    if (t >= end - 0.01 || video.ended) {
      stopRecorder();
      return;
    }
    schedule();
  };

  const schedule = () => {
    if (stopped) return;
    if (typeof anyVideo.requestVideoFrameCallback === 'function') {
      anyVideo.requestVideoFrameCallback(() => tick());
    } else {
      rafId = window.requestAnimationFrame(() => tick());
    }
  };

  watchdog = window.setTimeout(() => {
    // 프레임 콜백이 멈춰도(탭 전환 등) 끝나도록 하는 안전장치
    stopRecorder();
  }, Math.round((duration + 20) * 1000));

  // ---- 녹화 시작 ----
  // 재생을 먼저 시작하고 첫 프레임이 올라온 뒤에 녹화를 시작해야
  // 영상·오디오가 같은 시점에서 출발한다(시작 정지화면이 오디오를 밀지 않도록).
  await seekTo(video, start);
  draw();
  params.onProgress?.(0, '내보내는 중… 0%');

  try {
    video.muted = false;
    video.playbackRate = 1;
    await video.play();
  } catch {
    canvasStream.getVideoTracks().forEach((t) => t.stop());
    throw new Error('브라우저가 영상 재생을 막았습니다. 화면을 한 번 누른 뒤 다시 내보내 주세요.');
  }

  if (graph) {
    try {
      await graph.ctx.resume();
    } catch {
      /* ignore */
    }
  }

  // 재생이 시작된 첫 프레임까지 기다린다(최대 250ms).
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    if (typeof anyVideo.requestVideoFrameCallback === 'function') {
      anyVideo.requestVideoFrameCallback(() => done());
    }
    window.setTimeout(done, 250);
  });

  draw();
  try {
    recorder.start(250);
  } catch (err) {
    stopRecorder();
    canvasStream.getVideoTracks().forEach((t) => t.stop());
    throw err instanceof Error ? err : new Error('녹화를 시작하지 못했습니다.');
  }

  schedule();

  let blob: Blob | null = null;
  try {
    blob = await blobPromise;
  } finally {
    window.clearTimeout(watchdog);
    if (rafId) window.cancelAnimationFrame(rafId);
    canvasStream.getVideoTracks().forEach((t) => t.stop());
    try {
      video.pause();
    } catch {
      /* ignore */
    }
  }

  if (canceled) throw new ExportCanceledError();
  if (!blob) throw new Error('내보내기 결과를 만들지 못했습니다. 다시 시도해 주세요.');

  const extension = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  const fileName = `${baseName(params.fileBaseName)}-reelcut.${extension}`;
  const url = URL.createObjectURL(blob);

  return {
    width: geo.outW,
    height: geo.outH,
    duration,
    elapsedSec: (performance.now() - startedAt) / 1000,
    hasAudio: Boolean(audioTrack),
    sizeBytes: blob.size,
    url,
    fileName,
    mimeType: mimeType.split(';')[0],
    extension,
  };
}
