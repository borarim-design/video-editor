export function formatTime(sec: number, withTenths = true): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const whole = Math.floor(rest);
  const tenths = Math.floor((rest - whole) * 10);
  const mm = String(m).padStart(2, '0');
  const ss = String(whole).padStart(2, '0');
  return withTenths ? `${mm}:${ss}.${tenths}` : `${mm}:${ss}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function uid(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function timecodeInput(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(1);
  return `${String(m).padStart(2, '0')}:${rest.padStart(4, '0')}`;
}

export function parseTimecode(value: string): number | null {
  const trimmed = value.trim();
  const m = trimmed.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}
