import type { ReactNode } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
  hint?: string;
}

export function Slider({ label, value, min, max, step = 1, suffix = '', onChange, hint }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="block select-none">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-studio-300">{label}</span>
        <span className="text-xs font-semibold tabular-nums text-studio-100">
          {Number.isInteger(value) ? value : value.toFixed(2)}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        className="mt-1.5 w-full"
        style={{ ['--fill' as string]: `${pct}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint ? <span className="mt-0.5 block text-[11px] text-studio-400">{hint}</span> : null}
    </label>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}

export function Toggle({ label, checked, onChange, hint }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-left transition hover:bg-studio-800/60"
    >
      <span>
        <span className="block text-xs font-medium text-studio-200">{label}</span>
        {hint ? <span className="block text-[11px] text-studio-400">{hint}</span> : null}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-neon' : 'bg-studio-600'}`}
        aria-hidden
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
            checked ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: SegmentedProps<T>) {
  return (
    <div className="inline-flex w-full rounded-lg border border-studio-600 bg-studio-900/60 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 rounded-[6px] font-medium transition ${
            size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'
          } ${value === opt.value ? 'bg-neon text-white shadow-glow' : 'text-studio-300 hover:text-white'}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Section({
  title,
  right,
  children,
  description,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  description?: string;
}) {
  return (
    <section className="space-y-2.5 border-b border-studio-700/60 px-4 py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-studio-400">{title}</h3>
        {right}
      </div>
      {description ? <p className="text-[11px] leading-relaxed text-studio-400">{description}</p> : null}
      {children}
    </section>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div className="space-y-1.5">
      {label ? (
        <div className="flex items-center justify-between text-[11px] text-studio-300">
          <span>{label}</span>
          <span className="tabular-nums">{Math.round(value * 100)}%</span>
        </div>
      ) : null}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-studio-700">
        <div
          className="h-full rounded-full bg-gradient-to-r from-neon via-neon-soft to-neon-cyan transition-all duration-300"
          style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }}
        />
      </div>
    </div>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'live' | 'warn' }) {
  const tones = {
    default: 'border-studio-600 bg-studio-800 text-studio-300',
    live: 'border-neon/50 bg-neon/15 text-neon-soft',
    warn: 'border-neon-amber/40 bg-neon-amber/10 text-neon-amber',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}
