import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { AudioLayer, Cue, ImageSticker, OverlayState, VideoClip } from '../types';
import { clamp, formatTime } from '../lib/format';
import { clipStartTime } from '../lib/clips';

/**
 * 캡컷 스타일 멀티 트랙 타임라인.
 *
 *  🎬 영상      — 클립 블록이 올린 순서대로 이어짐 (탭 → 선택·순서·트림·삭제)
 *  💬 자막      — 자막 큐 블록(탭 → 선택·편집·해당 시점 이동)
 *  🖼️ 스티커    — 스티커/위젯 표시 구간 블록
 *  🎵 오디오    — BGM·효과음 레이어 블록
 *
 * 모든 블록은 편집본(클립 합산) 시간축에 놓는다(0초 = 첫 클립 시작).
 */
interface Props {
  /** 편집본 전체 길이(초) */
  duration: number;
  trim: { start: number; end: number };
  /** 편집본 시간(초) */
  time: number;
  clips: VideoClip[];
  activeIndex: number;
  selectedClipId: string | null;
  cues: Cue[];
  stickers: ImageSticker[];
  overlays: OverlayState;
  audioLayers: AudioLayer[];
  selectedCueId: string | null;
  selectedStickerId: string | null;
  selectedAudioId: string | null;
  onSeek: (t: number) => void;
  onSelectCue: (id: string) => void;
  onSelectSticker: (id: string) => void;
  onSelectAudio: (id: string) => void;
  onAddCue: () => void;
  onAddMosaic: () => void;
  onAddAudio: () => void;
  onAddVideo: () => void;
  onSelectClip: (id: string) => void;
  onMoveClip: (id: string, dir: -1 | 1) => void;
  onTrimClip: (id: string, patch: { trimStart?: number; trimEnd?: number }) => void;
  onDeleteClip: (id: string) => void;
}

type DragKind = 'playhead' | null;

const ROW = 'relative h-8 overflow-hidden rounded-md bg-studio-800/60';
const QUICK = 'btn min-h-[34px] shrink-0 whitespace-nowrap !px-2 !py-1 text-[11px] sm:!px-2.5';

export default function TimelineTracks({
  duration,
  trim,
  time,
  clips,
  activeIndex,
  selectedClipId,
  cues,
  stickers,
  overlays,
  audioLayers,
  selectedCueId,
  selectedStickerId,
  selectedAudioId,
  onSeek,
  onSelectCue,
  onSelectSticker,
  onSelectAudio,
  onAddCue,
  onAddMosaic,
  onAddAudio,
  onAddVideo,
  onSelectClip,
  onMoveClip,
  onTrimClip,
  onDeleteClip,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragKind>(null);

  const total = Math.max(0.01, duration);
  const pct = useCallback((t: number) => clamp(t / total, 0, 1) * 100, [total]);

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      return clamp((clientX - rect.left) / rect.width, 0, 1) * duration;
    },
    [duration],
  );

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      onSeek(timeFromClientX(e.clientX));
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [drag, timeFromClientX, onSeek]);

  const startSeek = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    onSeek(timeFromClientX(e.clientX));
    setDrag('playhead');
  };

  const trimmed = Math.max(0, trim.end - trim.start);
  const widgetCount = [overlays.viewfinder.enabled, overlays.dateCard.enabled, overlays.placeCard.enabled].filter(Boolean).length;
  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;
  const selectedIndex = selectedClip ? clips.findIndex((c) => c.id === selectedClip.id) : -1;

  // 눈금: 길이에 따라 1·5·10초 간격
  const step = duration > 120 ? 20 : duration > 60 ? 10 : duration > 20 ? 5 : 1;
  const ticks: number[] = [];
  for (let s = 0; s <= duration + 1e-6; s += step) ticks.push(s);

  const block = (
    id: string,
    startSec: number,
    endSec: number,
    label: string,
    selected: boolean,
    onDown: () => void,
    tone: 'sub' | 'sticker' | 'audio',
  ) => {
    const left = pct(startSec);
    const width = Math.max(0.6, pct(endSec) - left);
    const tones = {
      sub: selected
        ? 'border-neon bg-neon/70 text-white'
        : 'border-neon/45 bg-neon/25 text-studio-100',
      sticker: selected
        ? 'border-neon-cyan bg-neon-cyan/60 text-studio-900'
        : 'border-neon-cyan/40 bg-neon-cyan/20 text-studio-100',
      audio: selected
        ? 'border-neon-amber bg-neon-amber/70 text-studio-900'
        : 'border-neon-amber/40 bg-neon-amber/20 text-studio-100',
    } as const;
    return (
      <button
        key={id}
        type="button"
        className={`absolute bottom-0.5 top-0.5 min-w-[6px] overflow-hidden rounded-[4px] border px-1 text-left text-[9px] font-semibold leading-none transition ${tones[tone]}`}
        style={{ left: `${left}%`, width: `${width}%` }}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onDown();
        }}
        title={`${label} · ${formatTime(startSec, false)}`}
      >
        <span className="pointer-events-none block truncate leading-[20px]">{label}</span>
      </button>
    );
  };

  return (
    <div className="rounded-xl border border-studio-700/70 bg-studio-850/70 p-2">
      {/* 퀵 추가 툴바 — 자막 · 모자이크 · 오디오 · 영상 */}
      <div className="mb-1.5 flex items-center gap-1 overflow-x-auto pb-0.5">
        <button type="button" className={`${QUICK} !bg-neon !text-white hover:!bg-neon-soft hover:!text-studio-900`} onClick={onAddCue}>
          ＋ 자막
        </button>
        <button type="button" className={`${QUICK} !border-neon-cyan/60 !bg-neon-cyan/15 !text-neon-cyan`} onClick={onAddMosaic}>
          ＋ 모자이크
        </button>
        <button type="button" className={`${QUICK} !border-neon-amber/50 !bg-neon-amber/10 !text-neon-amber`} onClick={onAddAudio}>
          ＋ 오디오
        </button>
        <button type="button" className={QUICK} onClick={onAddVideo}>
          ＋ 영상
        </button>
        <span className="ml-auto hidden whitespace-nowrap pl-1 font-mono text-[10px] tabular-nums text-studio-400 sm:inline">
          {formatTime(Math.max(0, time - trim.start), false)} / {formatTime(trimmed, false)}
        </span>
      </div>

      <div className="flex gap-1">
        {/* 고정 트랙 라벨 */}
        <div className="flex w-11 shrink-0 flex-col gap-1">
          <div className="h-3.5" />
          {[
            ['🎬', '영상'],
            ['💬', '자막'],
            ['🖼️', '스티커'],
            ['🎵', '오디오'],
          ].map(([icon, name]) => (
            <div key={name} className="flex h-8 flex-col items-center justify-center rounded-md bg-studio-800/40 leading-none">
              <span className="text-[11px]">{icon}</span>
              <span className="mt-0.5 text-[9px] font-semibold text-studio-400">{name}</span>
            </div>
          ))}
        </div>

        {/* 시간축 + 트랙 */}
        <div className="relative min-w-0 flex-1" ref={trackRef}>
          {/* 눈금 */}
          <div className="relative h-3.5" onPointerDown={startSeek}>
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute top-0 -translate-x-1/2 font-mono text-[8px] tabular-nums text-studio-500"
                style={{ left: `${pct(t)}%` }}
              >
                {Math.round(t)}
              </span>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            {/* 🎬 영상 트랙 — 클립 블록이 순서대로 이어짐 */}
            <div className={ROW} onPointerDown={startSeek}>
              {clips.length === 0 ? (
                <button
                  type="button"
                  className="absolute inset-1 rounded border border-dashed border-studio-600 text-[9px] text-studio-400"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddVideo();
                  }}
                >
                  + 영상 추가
                </button>
              ) : null}
              {clips.map((clip, i) => {
                const start = clipStartTime(clips, i);
                const end = start + Math.max(0.01, clip.trimEnd - clip.trimStart);
                const selected = selectedClipId === clip.id;
                const isActive = activeIndex === i;
                return (
                  <button
                    key={clip.id}
                    type="button"
                    className={`absolute bottom-0.5 top-0.5 min-w-[8px] overflow-hidden rounded-[4px] border px-1 text-left text-[9px] font-semibold leading-none transition ${
                      selected
                        ? 'border-white bg-neon/80 text-white'
                        : isActive
                          ? 'border-neon/80 bg-neon/35 text-white'
                          : 'border-neon/40 bg-neon/20 text-studio-100'
                    }`}
                    style={{ left: `${pct(start)}%`, width: `${Math.max(0.8, pct(end) - pct(start))}%` }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectClip(clip.id);
                    }}
                    title={`${i + 1}. ${clip.name} · ${formatTime(start, false)} ~ ${formatTime(end, false)}`}
                  >
                    <span className="pointer-events-none block truncate leading-[20px]">
                      {i + 1}. {clip.name}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 💬 자막 트랙 */}
            <div className={ROW} onPointerDown={startSeek}>
              {cues.length === 0 ? (
                <button
                  type="button"
                  className="absolute inset-1 rounded border border-dashed border-studio-600 text-[9px] text-studio-400"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddCue();
                  }}
                >
                  + 자막 추가
                </button>
              ) : null}
              {cues.map((cue) =>
                block(cue.id, trim.start + cue.start, trim.start + cue.end, cue.text || '자막', selectedCueId === cue.id, () => onSelectCue(cue.id), 'sub'),
              )}
            </div>

            {/* 🖼️ 스티커·위젯 트랙 */}
            <div className={ROW} onPointerDown={startSeek}>
              {widgetCount > 0 ? (
                <span className="pointer-events-none absolute inset-y-0.5 left-0.5 flex items-center rounded bg-studio-700/60 px-1 text-[8px] font-semibold text-studio-300">
                  위젯 {widgetCount}
                </span>
              ) : null}
              {stickers.length === 0 && widgetCount === 0 ? (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[9px] text-studio-500">
                  오버레이 탭에서 스티커를 올려 보세요
                </span>
              ) : null}
              {stickers.map((s) =>
                block(
                  s.id,
                  trim.start + (s.start ?? 0),
                  trim.start + (s.end ?? trimmed),
                  s.name || '스티커',
                  selectedStickerId === s.id,
                  () => onSelectSticker(s.id),
                  'sticker',
                ),
              )}
            </div>

            {/* 🎵 오디오 트랙 */}
            <div className={ROW} onPointerDown={startSeek}>
              {audioLayers.length === 0 ? (
                <button
                  type="button"
                  className="absolute inset-1 rounded border border-dashed border-studio-600 text-[9px] text-studio-400"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddAudio();
                  }}
                >
                  + 배경음악·효과음
                </button>
              ) : null}
              {audioLayers.map((a) =>
                block(
                  a.id,
                  trim.start + a.start,
                  trim.start + a.start + a.length,
                  `${a.muted ? '🔇 ' : ''}${a.name}`,
                  selectedAudioId === a.id,
                  () => onSelectAudio(a.id),
                  'audio',
                ),
              )}
            </div>
          </div>

          {/* 플레이헤드 */}
          <div
            className="pointer-events-none absolute bottom-0 top-2 z-10 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]"
            style={{ left: `${pct(time)}%` }}
          >
            <span className="absolute -left-[5px] -top-1.5 h-3 w-3 rounded-full border border-studio-900 bg-white" />
          </div>
        </div>
      </div>

      {/* 선택한 클립 편집(순서·트림·삭제) */}
      {selectedClip ? (
        <div className="mt-1.5 rounded-lg border border-studio-700/70 bg-studio-900/50 px-2 py-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="min-w-0 max-w-[9rem] truncate text-[11px] font-semibold text-studio-100">
              {selectedIndex + 1}. {selectedClip.name}
            </span>
            <button
              type="button"
              className="chip !min-h-[32px] !px-2 !py-0.5 !text-[10px] disabled:opacity-40"
              disabled={selectedIndex <= 0}
              onClick={() => onMoveClip(selectedClip.id, -1)}
              aria-label="앞 클립과 순서 바꾸기"
            >
              ◀ 앞으로
            </button>
            <button
              type="button"
              className="chip !min-h-[32px] !px-2 !py-0.5 !text-[10px] disabled:opacity-40"
              disabled={selectedIndex < 0 || selectedIndex >= clips.length - 1}
              onClick={() => onMoveClip(selectedClip.id, 1)}
              aria-label="뒤 클립과 순서 바꾸기"
            >
              뒤로 ▶
            </button>
            <button
              type="button"
              className="chip !min-h-[32px] !px-2 !py-0.5 !text-[10px] !border-neon-rose/40 !text-neon-rose disabled:opacity-40"
              disabled={clips.length <= 1}
              onClick={() => onDeleteClip(selectedClip.id)}
              aria-label="클립 삭제"
            >
              삭제
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-studio-400">
            <span className="shrink-0">트림</span>
            <label className="flex items-center gap-1">
              <span className="sr-only">클립 시작</span>
              <input
                type="number"
                step={0.1}
                min={0}
                max={Math.max(0, selectedClip.trimEnd - 0.2)}
                value={Number(selectedClip.trimStart.toFixed(1))}
                onChange={(e) =>
                  onTrimClip(selectedClip.id, {
                    trimStart: clamp(Number(e.target.value), 0, Math.max(0, selectedClip.trimEnd - 0.2)),
                  })
                }
                className="w-16 rounded bg-studio-900/80 px-1 py-0.5 tabular-nums text-studio-100"
              />
            </label>
            <span>–</span>
            <label className="flex items-center gap-1">
              <span className="sr-only">클립 끝</span>
              <input
                type="number"
                step={0.1}
                min={Math.min(selectedClip.duration, selectedClip.trimStart + 0.2)}
                max={selectedClip.duration}
                value={Number(selectedClip.trimEnd.toFixed(1))}
                onChange={(e) =>
                  onTrimClip(selectedClip.id, {
                    trimEnd: clamp(Number(e.target.value), selectedClip.trimStart + 0.2, selectedClip.duration),
                  })
                }
                className="w-16 rounded bg-studio-900/80 px-1 py-0.5 tabular-nums text-studio-100"
              />
            </label>
            <span className="text-studio-500">/ 원본 {selectedClip.duration.toFixed(1)}초</span>
            <button
              type="button"
              className="ml-auto chip !min-h-[28px] !px-2 !py-0 !text-[10px]"
              onClick={() => onTrimClip(selectedClip.id, { trimStart: 0, trimEnd: selectedClip.duration })}
            >
              트림 초기화
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 text-[10px] leading-relaxed text-studio-500">
          영상 블록을 누르면 그 클립을 선택해 순서·트림·삭제를 바꿀 수 있어요.
        </p>
      )}
    </div>
  );
}
