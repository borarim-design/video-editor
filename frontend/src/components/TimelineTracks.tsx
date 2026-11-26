import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { AudioLayer, Cue, ImageSticker, OverlayState } from '../types';
import { clamp, formatTime } from '../lib/format';

/**
 * 캡컷 스타일 멀티 트랙 타임라인.
 *
 *  🎬 영상      — 트림 구간 바 + 양끝 핸들
 *  💬 자막      — 자막 큐 블록(탭 → 선택·편집·해당 시점 이동)
 *  🖼️ 스티커    — 스티커/위젯 표시 구간 블록
 *  🎵 오디오    — BGM·효과음 레이어 블록
 *
 * 모든 블록은 원본 영상 시간축에 놓고, 자막·오디오는 트림 시작을 0 으로 하는
 * 편집본 시간이라 trim.start 를 더해 그린다. 플레이헤드는 어느 트랙을 눌러도 이동한다.
 */
interface Props {
  duration: number;
  trim: { start: number; end: number };
  time: number;
  cues: Cue[];
  stickers: ImageSticker[];
  overlays: OverlayState;
  audioLayers: AudioLayer[];
  selectedCueId: string | null;
  selectedStickerId: string | null;
  selectedAudioId: string | null;
  onChangeTrim: (t: { start: number; end: number }) => void;
  onSeek: (t: number) => void;
  onSelectCue: (id: string) => void;
  onSelectSticker: (id: string) => void;
  onSelectAudio: (id: string) => void;
  onAddCue: () => void;
  onAddAudio: () => void;
}

type DragKind = 'trim-start' | 'trim-end' | 'playhead' | null;

const ROW = 'relative h-8 overflow-hidden rounded-md bg-studio-800/60';

export default function TimelineTracks({
  duration,
  trim,
  time,
  cues,
  stickers,
  overlays,
  audioLayers,
  selectedCueId,
  selectedStickerId,
  selectedAudioId,
  onChangeTrim,
  onSeek,
  onSelectCue,
  onSelectSticker,
  onSelectAudio,
  onAddCue,
  onAddAudio,
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
      const t = timeFromClientX(e.clientX);
      if (drag === 'trim-start') onChangeTrim({ start: Math.min(t, trim.end - 0.2), end: trim.end });
      else if (drag === 'trim-end') onChangeTrim({ start: trim.start, end: Math.max(t, trim.start + 0.2) });
      else onSeek(t);
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
  }, [drag, timeFromClientX, onChangeTrim, onSeek, trim.start, trim.end]);

  const startSeek = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    onSeek(timeFromClientX(e.clientX));
    setDrag('playhead');
  };

  const trimmed = Math.max(0, trim.end - trim.start);
  const widgetCount = [overlays.viewfinder.enabled, overlays.dateCard.enabled, overlays.placeCard.enabled].filter(Boolean).length;

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
      {/* 퀵 추가 + 시간 */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <button
          type="button"
          className="btn-primary min-h-[36px] !px-2.5 !py-1 text-[11px]"
          onClick={onAddCue}
        >
          ➕ 자막
        </button>
        <button
          type="button"
          className="btn-ghost min-h-[36px] !px-2.5 !py-1 text-[11px]"
          onClick={onAddAudio}
        >
          🎵 오디오
        </button>
        <span className="ml-auto whitespace-nowrap font-mono text-[10px] tabular-nums text-studio-400">
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
            {/* 🎬 영상 트랙 — 트림 구간 */}
            <div className={ROW} onPointerDown={startSeek}>
              <div
                className="absolute inset-y-0 border-y border-neon/50 bg-neon/15"
                style={{ left: `${pct(trim.start)}%`, width: `${Math.max(1, pct(trim.end) - pct(trim.start))}%` }}
              />
              <span
                className="pointer-events-none absolute inset-y-0 flex items-center justify-center text-[9px] font-semibold text-studio-200"
                style={{ left: `${pct(trim.start)}%`, width: `${Math.max(1, pct(trim.end) - pct(trim.start))}%` }}
              >
                영상 · {trimmed.toFixed(1)}초
              </span>
              {/* 트림 핸들 */}
              <button
                type="button"
                aria-label="시작 지점"
                className="absolute inset-y-0 w-5 -translate-x-1/2 cursor-ew-resize touch-none"
                style={{ left: `${pct(trim.start)}%` }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setDrag('trim-start');
                }}
              >
                <span className="absolute inset-y-1 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-neon" />
              </button>
              <button
                type="button"
                aria-label="끝 지점"
                className="absolute inset-y-0 w-5 -translate-x-1/2 cursor-ew-resize touch-none"
                style={{ left: `${pct(trim.end)}%` }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setDrag('trim-end');
                }}
              >
                <span className="absolute inset-y-1 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-neon" />
              </button>
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

      <p className="mt-1.5 text-[10px] leading-relaxed text-studio-500">
        시간축을 누르거나 끌면 그 시점으로 이동해요. 자막·스티커·오디오 블록을 누르면 바로 편집할 수 있어요.
      </p>
    </div>
  );
}
