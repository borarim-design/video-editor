/**
 * 여러 영상 클립을 하나의 편집 타임라인으로 다루는 계산.
 *
 * 편집본 시간(0초~)은 클립을 올린 순서대로 이어 붙인 합산 시간축이다.
 *   예) 클립1 0~5초 + 클립2 5~12초
 * 자막·오디오·모자이크의 시각은 모두 이 편집본 시간(0부터)을 쓴다.
 */
import type { ProjectMeta, VideoClip } from '../types';

export function clipLength(clip: VideoClip): number {
  const end = Number.isFinite(clip.trimEnd) ? clip.trimEnd : clip.duration;
  return Math.max(0, end - Math.max(0, clip.trimStart));
}

export interface ClipSlot {
  clip: VideoClip;
  index: number;
  /** 편집본 타임라인에서 이 클립이 시작하는 초 */ offset: number;
  /** 이 클립의 길이(초) */ length: number;
  /** 편집본 타임라인에서 이 클립이 끝나는 초 */ end: number;
}

export function clipSlots(clips: VideoClip[]): ClipSlot[] {
  let acc = 0;
  return clips.map((clip, index) => {
    const length = clipLength(clip);
    const slot: ClipSlot = { clip, index, offset: acc, length, end: acc + length };
    acc += length;
    return slot;
  });
}

export function totalDuration(clips: VideoClip[]): number {
  return clips.reduce((sum, clip) => sum + clipLength(clip), 0);
}

/** 편집본 시간 → 어느 클립의 어느 원본 지점인지 */
export function locateClip(clips: VideoClip[], t: number): { index: number; local: number; source: number } {
  if (!clips.length) return { index: 0, local: 0, source: 0 };
  const slots = clipSlots(clips);
  const time = Math.max(0, t);
  for (const slot of slots) {
    if (time < slot.end - 1e-6) {
      const local = Math.max(0, Math.min(slot.length, time - slot.offset));
      return { index: slot.index, local, source: slot.clip.trimStart + local };
    }
  }
  const last = slots[slots.length - 1];
  return {
    index: last.index,
    local: last.length,
    source: last.clip.trimStart + last.length,
  };
}

/** 편집본에서 한 클립의 시작 시각(초) */
export function clipStartTime(clips: VideoClip[], index: number): number {
  const slots = clipSlots(clips);
  return slots[Math.max(0, Math.min(slots.length - 1, index))]?.offset ?? 0;
}

/** 클립 목록에서 화면·내보내기 공통 메타(해상도·길이·이름)를 만든다. */
export function projectFromClips(clips: VideoClip[]): ProjectMeta | null {
  if (!clips.length) return null;
  const first = clips[0];
  const duration = totalDuration(clips);
  const sizeBytes = clips.reduce((sum, c) => sum + (c.sizeBytes ?? 0), 0);
  return {
    id: `${first.id}:${clips.length}`,
    filename: clips.length > 1 ? `${first.name} 외 ${clips.length - 1}개` : first.name,
    width: first.width,
    height: first.height,
    fps: first.fps || 30,
    duration,
    hasAudio: clips.some((c) => c.hasAudio),
    frames: Math.max(1, Math.round(duration * (first.fps || 30))),
    sizeBytes: sizeBytes || undefined,
    srcUrl: first.url,
  };
}
