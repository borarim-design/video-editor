/**
 * 브라우저 단독 내보내기.
 *
 * 서버(/api/render) 없이 **오프스크린 Canvas + captureStream() + MediaRecorder**
 * 로 미리보기와 똑같은 프레임(트림·비율 크롭·모자이크·후킹 타이틀·자막)을 합성하고,
 * 원본 영상들의 오디오는 Web Audio API 로 같은 스트림에 실어 준다.
 *
 * 여러 클립을 올렸을 때는 클립 순서대로 **이어서 재생하며 한 번에 녹화**한다.
 * (클립마다 숨김 <video> 를 하나씩 두고, 앞 클립이 끝나면 다음 클립을 재생)
 *
 * 결과물: 브라우저가 MP4 녹화를 지원하면 MP4(video/mp4), 아니면 WebM(video/webm).
 * 그리는 함수는 미리보기와 동일한 drawPreview() 를 쓰므로 결과가 화면과 일치한다.
 */
import type { AudioLayer, EditSpec, ExportResult, PersonTrack } from '../types';
import { drawPreview } from './preview';
import { preloadStickerImages } from './stickers';
import { outputGeometry } from './layout';
import { clamp } from './format';

export class ExportCanceledError extends Error {
  constructor() {
    super('내보내기를 취소했습니다.');
    this.name = 'ExportCanceledError';
  }
}

/** 내보내기에 쓰는 클립 정보(원본 파일 대신 blob URL 만 있으면 된다). */
export interface ExportClip {
  id: string;
  url: string;
  trimStart: number;
  trimEnd: number;
  hasAudio: boolean;
}

export interface ExportParams {
  /** 타임라인 순서대로 이어 붙일 클립들 */
  clips: ExportClip[];
  projectWidth: number;
  projectHeight: number;
  spec: EditSpec;
  tracks: PersonTrack[];
  /** 추가 오디오 레이어(BGM·효과음) — 원본 영상 소리와 함께 믹싱한다. */
  audioLayers?: AudioLayer[];
  /** 원본 영상 소리 크기(0~1) */
  videoVolume?: number;
  fps: number;
  fileBaseName?: string;
  onProgress?: (ratio: number, message: string) => void;
  /** 취소 함수를 넘겨받는다(진행 중 버튼에서 사용). */
  onCancelReady?: (cancel: () => void) => void;
}

function clipDur(clip: ExportClip): number {
  return Math.max(0, clip.trimEnd - Math.max(0, clip.trimStart));
}

/** blob: 오디오 파일을 AudioBuffer 로 디코딩(콜백·Promise 두 방식 모두 지원). */
function decodeAudio(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ok = (buf: AudioBuffer) => {
      if (!settled) {
        settled = true;
        resolve(buf);
      }
    };
    const fail = (err: unknown) => {
      if (!settled) {
        settled = true;
        reject(err instanceof Error ? err : new Error('오디오를 해석하지 못했습니다.'));
      }
    };
    try {
      const maybe = ctx.decodeAudioData(data, ok, fail);
      if (maybe && typeof maybe.then === 'function') maybe.then(ok).catch(fail);
    } catch (err) {
      fail(err);
    }
  });
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

function audioContextCtor(): typeof AudioContext | null {
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  );
}

/** 이 브라우저가 만들 수 있는 컨테이너 이름(버튼 표기용) */
export function exportFormatLabel(): 'MP4' | 'WebM' {
  const mime = pickMimeType(true);
  return mime && mime.startsWith('video/mp4') ? 'MP4' : 'WebM';
}

/** 실시간 재생을 그대로 녹화한다(오디오·영상 싱크 유지). */
export async function exportVideo(params: ExportParams): Promise<ExportResult> {
  const { clips, projectWidth, projectHeight, spec, tracks } = params;
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('이 브라우저는 영상 내보내기(MediaRecorder)를 지원하지 않습니다. Chrome·Edge 최신 버전에서 시도해 주세요.');
  }
  if (!clips.length) throw new Error('내보낼 영상이 없습니다.');

  // 클립별 편집본 시작 시각(합산 시간축)
  const offsets: { start: number; end: number; clip: ExportClip }[] = [];
  let acc = 0;
  for (const clip of clips) {
    const len = clipDur(clip);
    offsets.push({ start: acc, end: acc + len, clip });
    acc += len;
  }
  const duration = acc;
  if (duration <= 0.01) throw new Error('내보낼 구간이 없습니다. 클립을 0.1초 이상 남겨 주세요.');

  const outFps = clamp(Math.round(params.fps || 30), 12, 60);
  const geo = outputGeometry(projectWidth, projectHeight, spec.aspect);

  const canvas = document.createElement('canvas');
  canvas.width = geo.outW;
  canvas.height = geo.outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들지 못했습니다.');

  // ---- 클립마다 숨김 <video> 하나(화면 밖). 순서대로 재생한다 ----
  const elements = clips.map((clip) => {
    const el = document.createElement('video');
    el.src = clip.url;
    el.preload = 'auto';
    el.playsInline = true;
    el.setAttribute('playsinline', 'true');
    el.muted = false;
    el.volume = 1;
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none';
    document.body.appendChild(el);
    return el;
  });

  let actx: AudioContext | null = null;
  let elementCleanupDone = false;
  const cleanup = () => {
    if (elementCleanupDone) return;
    elementCleanupDone = true;
    elements.forEach((el) => {
      try {
        el.pause();
      } catch {
        /* ignore */
      }
      el.removeAttribute('src');
      try {
        el.load();
      } catch {
        /* ignore */
      }
      el.remove();
    });
    if (actx) {
      const closing = actx;
      actx = null;
      try {
        void closing.close().catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
  };

  try {
    await Promise.all(elements.map((el) => waitReady(el)));

    // 스티커 이미지가 디코딩되기 전에 녹화가 시작되면 빈 프레임이 찍히므로 먼저 불러온다.
    await preloadStickerImages(spec.stickers ?? []);

    // ---- 오디오(Web Audio): 각 클립의 원본 소리 + 추가 오디오 레이어를 하나의 스트림으로 믹싱 ----
    const audioLayers = (params.audioLayers ?? []).filter((l) => l.enabled);
    const videoVolume = clamp(params.videoVolume ?? 1, 0, 1);
    const silentClips = clips.every((c) => !c.hasAudio);
    const wantAudio = (!silentClips && videoVolume > 0) || audioLayers.length > 0;
    let dest: MediaStreamAudioDestinationNode | null = null;
    const buffers = new Map<string, AudioBuffer>();
    const layerNodes: AudioBufferSourceNode[] = [];

    if (wantAudio) {
      const Ctor = audioContextCtor();
      if (Ctor) {
        actx = new Ctor();
        try {
          await actx.resume();
        } catch {
          /* 사용자 조작 후 다시 시도된다 */
        }
        dest = actx.createMediaStreamDestination();
        // 클립마다 오디오 소스를 하나씩 만들어 같은 목적지로 보낸다(재생 중인 클립 소리만 들린다).
        elements.forEach((el, i) => {
          if (!clips[i].hasAudio) return;
          try {
            const source = actx!.createMediaElementSource(el);
            const gain = actx!.createGain();
            gain.gain.value = videoVolume;
            source.connect(gain);
            gain.connect(dest!);
          } catch {
            /* 이 클립만 소리 없이 나간다 */
          }
        });
        for (const layer of audioLayers) {
          try {
            const res = await fetch(layer.src);
            const data = await res.arrayBuffer();
            buffers.set(layer.id, await decodeAudio(actx, data));
          } catch {
            /* 해석하지 못한 레이어는 내보내기에서 빠진다 */
          }
        }
      }
    }

    /** 클립 현재 시각(clipNow)을 기준으로 각 레이어를 AudioContext 시간에 맞춰 예약 재생한다. */
    const startLayerAudio = (clipNow: number) => {
      if (!actx || !dest) return;
      const lead = 0.03;
      const base = actx.currentTime + lead;
      // 예약 시각(base)에 클립이 어디까지 갔는지로 오프셋을 계산해야 소리가 밀리지 않는다.
      const clipAtBase = clipNow + lead;
      for (const layer of audioLayers) {
        const buf = buffers.get(layer.id);
        if (!buf) continue;
        const rel = clipAtBase - layer.start;
        if (rel >= layer.length) continue;
        const when = base + Math.max(0, layer.start - clipAtBase);
        const offset = layer.offset + Math.max(0, rel);
        if (offset >= buf.duration) continue;
        const dur = Math.min(layer.length - Math.max(0, rel), buf.duration - offset);
        if (dur <= 0.01) continue;
        const gain = actx.createGain();
        gain.gain.value = layer.muted ? 0 : clamp(layer.volume, 0, 1);
        const node = actx.createBufferSource();
        node.buffer = buf;
        node.connect(gain);
        gain.connect(dest);
        try {
          node.start(when, offset, dur);
          layerNodes.push(node);
        } catch {
          /* ignore */
        }
      }
    };

    // ---- 캔버스 + 오디오 → 하나의 MediaStream ----
    const canvasEl = canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream };
    if (typeof canvasEl.captureStream !== 'function') {
      throw new Error('이 브라우저는 캔버스 녹화(captureStream)를 지원하지 않습니다. Chrome·Edge 최신 버전에서 시도해 주세요.');
    }
    const canvasStream = canvasEl.captureStream(outFps);

    const stream = new MediaStream();
    canvasStream.getVideoTracks().forEach((t) => stream.addTrack(t));
    const audioTrack = dest?.stream.getAudioTracks()[0] ?? null;
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
    let idx = 0;

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

    /** 편집본 시간(합산 시간축, 0초~) */
    const timelineNow = () => {
      const el = elements[idx];
      const slot = offsets[idx];
      if (!el || !slot) return duration;
      return slot.start + Math.max(0, el.currentTime - slot.clip.trimStart);
    };

    const draw = () => {
      const el = elements[idx];
      if (!el) return;
      const t = timelineNow();
      drawPreview({
        canvas,
        video: el,
        projectWidth,
        projectHeight,
        spec,
        tracks,
        t: Math.max(0, t),
        tSource: el.currentTime,
      });
    };

    const stopRecorder = () => {
      if (stopped) return;
      stopped = true;
      window.clearTimeout(watchdog);
      if (rafId) window.cancelAnimationFrame(rafId);
      layerNodes.forEach((node) => {
        try {
          node.stop();
        } catch {
          /* ignore */
        }
      });
      elements.forEach((el) => {
        try {
          el.pause();
        } catch {
          /* ignore */
        }
      });
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

    const tick = () => {
      rafId = 0;
      if (stopped) return;
      draw();
      const t = timelineNow();
      const ratio = clamp(t / duration, 0, 1);
      params.onProgress?.(ratio, ratio >= 1 ? '마무리 중…' : `내보내는 중… ${Math.round(ratio * 100)}%`);

      const el = elements[idx];
      const slot = offsets[idx];
      if (!el || !slot) {
        stopRecorder();
        return;
      }
      // 이 클립의 트림 끝에 닿으면 다음 클립으로 넘어간다.
      if (el.currentTime >= slot.clip.trimEnd - 0.015 || el.ended) {
        try {
          el.pause();
        } catch {
          /* ignore */
        }
        if (idx + 1 < elements.length) {
          idx += 1;
          const next = elements[idx];
          const nextSlot = offsets[idx];
          if (Math.abs(next.currentTime - nextSlot.clip.trimStart) > 0.02) {
            try {
              next.currentTime = nextSlot.clip.trimStart;
            } catch {
              /* ignore */
            }
          }
          next.muted = false;
          void next.play().catch(() => undefined);
          rafId = window.requestAnimationFrame(tick);
          return;
        }
        stopRecorder();
        return;
      }
      rafId = window.requestAnimationFrame(tick);
    };

    watchdog = window.setTimeout(() => {
      // 프레임 루프가 멈춰도(탭 전환 등) 끝나도록 하는 안전장치
      stopRecorder();
    }, Math.round((duration + 20) * 1000));

    // ---- 녹화 시작 ----
    // 각 클립을 자기 트림 시작점에 맞춘 뒤 첫 클립부터 재생한다.
    await Promise.all(elements.map((el, i) => seekTo(el, offsets[i].clip.trimStart)));
    draw();
    params.onProgress?.(0, '내보내는 중… 0%');

    try {
      elements.forEach((el, i) => {
        el.playbackRate = 1;
        el.muted = false;
        el.volume = 1;
        if (i !== 0) el.pause();
      });
      await elements[0].play();
    } catch {
      canvasStream.getVideoTracks().forEach((t) => t.stop());
      throw new Error('브라우저가 영상 재생을 막았습니다. 화면을 한 번 누른 뒤 다시 내보내 주세요.');
    }

    if (actx) {
      try {
        await actx.resume();
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
      const anyEl = elements[0] as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: (now: number, meta: unknown) => void) => number;
      };
      if (typeof anyEl.requestVideoFrameCallback === 'function') {
        anyEl.requestVideoFrameCallback(() => done());
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

    rafId = window.requestAnimationFrame(tick);
    // 레이어는 녹화 시작 순간의 클립 시각을 기준으로 예약한다(앞부분이 이미 지나갔으면 그만큼 건너뛴다).
    startLayerAudio(timelineNow());

    let blob: Blob | null = null;
    try {
      blob = await blobPromise;
    } finally {
      window.clearTimeout(watchdog);
      if (rafId) window.cancelAnimationFrame(rafId);
      canvasStream.getVideoTracks().forEach((t) => t.stop());
      elements.forEach((el) => {
        try {
          el.pause();
        } catch {
          /* ignore */
        }
      });
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
  } finally {
    cleanup();
  }
}
