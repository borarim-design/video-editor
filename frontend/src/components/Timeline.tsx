import { useCallback, useEffect, useRef, useState } from 'react';
import { clamp, formatTime } from '../lib/format';

interface Props {
  duration: number;
  trim: { start: number; end: number };
  time: number;
  onChangeTrim: (trim: { start: number; end: number }) => void;
  onSeek: (t: number) => void;
}

type DragKind = 'start' | 'end' | 'playhead' | null;

export default function Timeline({ duration, trim, time, onChangeTrim, onSeek }: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragKind>(null);

  const posFromEvent = useCallback(
    (clientX: number) => {
      const el = barRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      return clamp((clientX - rect.left) / rect.width, 0, 1) * duration;
    },
    [duration],
  );

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const t = posFromEvent(e.clientX);
      if (drag === 'start') onChangeTrim({ start: Math.min(t, trim.end - 0.2), end: trim.end });
      else if (drag === 'end') onChangeTrim({ start: trim.start, end: Math.max(t, trim.start + 0.2) });
      else onSeek(t);
    };
    const onUp = () => setDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, posFromEvent, onChangeTrim, onSeek, trim]);

  const pct = (v: number) => `${(v / Math.max(0.01, duration)) * 100}%`;
  const ticks: number[] = [];
  const step = duration > 60 ? 10 : duration > 20 ? 5 : 1;
  for (let s = 0; s <= duration; s += step) ticks.push(s);

  const trimmed = Math.max(0, trim.end - trim.start);

  return (
    <div className="rounded-xl border border-studio-700/70 bg-studio-850/70 p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] text-studio-400">
        <span>
          구간 <span className="font-semibold tabular-nums text-studio-200">{formatTime(trim.start)} – {formatTime(trim.end)}</span>
          <span className="ml-2 text-studio-400">({trimmed.toFixed(1)}초)</span>
        </span>
        <span className="tabular-nums text-studio-300">
          {formatTime(time)} / {formatTime(duration)}
        </span>
      </div>

      <div
        ref={barRef}
        className="relative h-14 select-none rounded-lg bg-studio-900"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).dataset.handle) return;
          onSeek(posFromEvent(e.clientX));
          setDrag('playhead');
        }}
      >
        {/* 전체 트랙 */}
        <div className="absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 overflow-hidden rounded-md bg-gradient-to-r from-studio-750 via-studio-700 to-studio-750">
          <div
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                'repeating-linear-gradient(90deg, rgba(255,255,255,0.14) 0 1px, transparent 1px 22px)',
            }}
          />
        </div>

        {/* 선택 구간 */}
        <div
          className="absolute top-1/2 h-8 -translate-y-1/2 rounded-md border-y-2 border-neon/70 bg-neon/15"
          style={{ left: pct(trim.start), width: pct(Math.max(0.05, trim.end - trim.start)) }}
        />

        {/* 자르기 밖 영역 */}
        <div className="absolute left-0 top-1/2 h-8 -translate-y-1/2 rounded-l-md bg-studio-950/70" style={{ width: pct(trim.start) }} />
        <div
          className="absolute right-0 top-1/2 h-8 -translate-y-1/2 rounded-r-md bg-studio-950/70"
          style={{ width: `${Math.max(0, 100 - (trim.end / Math.max(0.01, duration)) * 100)}%` }}
        />

        {/* 눈금 */}
        {ticks.map((s) => (
          <div key={s} className="absolute bottom-0 top-auto h-1.5 w-px bg-studio-500/60" style={{ left: pct(s) }}>
            <span className="absolute -top-4 -translate-x-1/2 text-[9px] tabular-nums text-studio-500">
              {s % (step * 2) === 0 ? s : ''}
            </span>
          </div>
        ))}

        {/* 트림 핸들 */}
        {(['start', 'end'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            data-handle={kind}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDrag(kind);
            }}
            className="absolute top-1/2 z-20 flex h-10 w-4 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-md border border-neon/80 bg-gradient-to-b from-neon to-neon/70 shadow-glow"
            style={{ left: kind === 'start' ? `calc(${pct(trim.start)} - 8px)` : `calc(${pct(trim.end)} - 8px)` }}
            aria-label={kind === 'start' ? '시작 지점' : '끝 지점'}
          >
            <span className="h-4 w-0.5 rounded-full bg-white/80" />
          </button>
        ))}

        {/* 재생 헤드 */}
        <div className="pointer-events-none absolute top-0 z-30 h-full w-px bg-white" style={{ left: pct(time) }}>
          <span className="absolute -top-0.5 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-white shadow" />
        </div>
      </div>
    </div>
  );
}
