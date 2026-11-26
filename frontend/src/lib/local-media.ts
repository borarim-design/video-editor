/**
 * 로컬 파일을 서버 없이 바로 편집 대상으로 읽는다.
 *
 * 업로드(/api/projects) 대신 `URL.createObjectURL(file)` 로 만든 blob URL 을
 * <video> 에 물리고, 해상도·길이·오디오 유무를 브라우저에서 직접 확인한다.
 * 파일은 사용자의 컴퓨터를 벗어나지 않는다.
 */
import type { ProjectMeta, VideoClip } from '../types';
import { uid } from './format';

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|ogv|ogg|mkv)$/i;

function once(target: HTMLVideoElement, event: 'loadedmetadata' | 'loadeddata', message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error(message));
    };
    const cleanup = () => {
      target.removeEventListener(event, ok);
      target.removeEventListener('error', fail);
    };
    target.addEventListener(event, ok, { once: true });
    target.addEventListener('error', fail, { once: true });
  });
}

/** 오디오 트랙 유무(가능한 경우에만 판별, 모르면 있는 것으로 본다) */
function detectAudio(el: HTMLVideoElement): boolean {
  try {
    const anyEl = el as HTMLVideoElement & {
      mozHasAudio?: boolean;
      captureStream?: () => MediaStream;
    };
    if (typeof anyEl.mozHasAudio === 'boolean') return anyEl.mozHasAudio;
    if (typeof anyEl.captureStream === 'function') {
      const stream = anyEl.captureStream();
      const has = stream.getAudioTracks().length > 0;
      stream.getTracks().forEach((t) => t.stop());
      return has;
    }
  } catch {
    /* 판별 실패 → 있는 것으로 가정 */
  }
  return true;
}

/** 재생 한 번으로 대략적인 프레임레이트를 잰다(실패하면 30으로 둔다). */
async function probeFps(el: HTMLVideoElement): Promise<number> {
  const anyEl = el as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  };
  if (typeof anyEl.requestVideoFrameCallback !== 'function') return 30;
  const wasMuted = el.muted;
  const prevTime = el.currentTime;
  try {
    el.muted = true;
    await el.play();
    const stamps: number[] = [];
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const started = performance.now();
      const onFrame = (_now: number, meta: { mediaTime: number }) => {
        stamps.push(meta.mediaTime);
        if (performance.now() - started > 600) done();
        else anyEl.requestVideoFrameCallback?.(onFrame);
      };
      anyEl.requestVideoFrameCallback?.(onFrame);
      window.setTimeout(done, 1000);
    });
    el.pause();
    const deltas = stamps
      .slice(1)
      .map((t, i) => t - stamps[i])
      .filter((d) => d > 0.0005 && d < 0.2)
      .sort((a, b) => a - b);
    if (deltas.length < 4) return 30;
    const median = deltas[Math.floor(deltas.length / 2)];
    const fps = 1 / median;
    if (!Number.isFinite(fps) || fps < 5 || fps > 130) return 30;
    return Math.round(fps * 100) / 100;
  } catch {
    return 30;
  } finally {
    try {
      el.pause();
      el.currentTime = prevTime;
      el.muted = wasMuted;
    } catch {
      /* ignore */
    }
  }
}

/** 길이가 Infinity/NaN 으로 나오는 컨테이너(일부 WebM)의 길이를 강제로 읽는다. */
async function resolveDuration(el: HTMLVideoElement, fallback: number): Promise<number> {
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  try {
    await new Promise<void>((resolve) => {
      const done = () => {
        el.removeEventListener('durationchange', done);
        resolve();
      };
      el.addEventListener('durationchange', done);
      el.currentTime = 1e7;
      window.setTimeout(done, 1200);
    });
    el.currentTime = 0;
    const d = el.duration;
    return Number.isFinite(d) && d > 0 ? d : 0;
  } catch {
    return 0;
  }
}

export async function loadLocalVideo(file: File): Promise<ProjectMeta> {
  if (!file.type.startsWith('video/') && !VIDEO_EXT.test(file.name)) {
    throw new Error('영상 파일이 아닙니다. MP4 · MOV · WebM 파일을 선택해 주세요.');
  }

  const srcUrl = URL.createObjectURL(file);
  const probe = document.createElement('video');
  probe.preload = 'metadata';
  probe.muted = true;
  probe.playsInline = true;
  probe.src = srcUrl;

  try {
    await once(
      probe,
      'loadedmetadata',
      '이 영상 형식을 브라우저가 읽을 수 없습니다. MP4(H.264)·MOV·WebM 파일을 사용해 주세요.',
    );
    const width = probe.videoWidth;
    const height = probe.videoHeight;
    if (!width || !height) {
      throw new Error('영상 해상도를 읽지 못했습니다. 다른 파일로 시도해 주세요.');
    }
    const duration = await resolveDuration(probe, probe.duration);
    if (!duration || !Number.isFinite(duration)) {
      throw new Error('영상 길이를 읽지 못했습니다. 다른 파일로 시도해 주세요.');
    }
    const hasAudio = detectAudio(probe);
    const fps = await probeFps(probe);
    const frames = Math.max(1, Math.round(duration * fps));

    return {
      id: uid('local'),
      filename: file.name,
      width,
      height,
      fps,
      duration,
      hasAudio,
      frames,
      sizeBytes: file.size,
      srcUrl,
    };
  } catch (err) {
    URL.revokeObjectURL(srcUrl);
    throw err;
  } finally {
    probe.removeAttribute('src');
    try {
      probe.load();
    } catch {
      /* ignore */
    }
  }
}

/**
 * 영상 파일 여러 개를 타임라인 클립으로 읽는다.
 * (loadLocalVideo 로 해상도·길이·오디오 유무를 확인한 뒤 클립 구조로 바꾼다)
 */
export async function loadVideoClip(file: File): Promise<VideoClip> {
  const meta = await loadLocalVideo(file);
  return {
    id: uid('clip'),
    url: meta.srcUrl,
    name: meta.filename,
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    trimStart: 0,
    trimEnd: meta.duration,
    hasAudio: meta.hasAudio,
    fps: meta.fps || 30,
    sizeBytes: meta.sizeBytes,
  };
}
