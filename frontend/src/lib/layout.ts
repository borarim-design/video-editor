/**
 * 자막 레이아웃·애니메이션 — backend/app/layout.py 와 1:1 대응.
 * 미리보기와 최종 MP4가 같은 좌표/같은 흔들림을 쓰도록 규칙을 그대로 옮겼다.
 */
import type { Aspect, Cue, SubtitleStyle } from '../types';

export const ASCENT_RATIO = 0.84;
export const SPACE_EM = 0.32;

export function isWide(ch: string): boolean {
  const o = ch.codePointAt(0) ?? 0;
  return (
    (o >= 0xac00 && o <= 0xd7a3) ||
    (o >= 0x3131 && o <= 0x318e) ||
    (o >= 0x4e00 && o <= 0x9fff) ||
    (o >= 0x3000 && o <= 0x303f) ||
    (o >= 0xff01 && o <= 0xff60) ||
    (o >= 0xffe0 && o <= 0xffe6)
  );
}

export function charEm(ch: string): number {
  if (ch === ' ' || ch === '\u00a0') return SPACE_EM;
  if (isWide(ch)) return 1;
  if ('.,:;!?\'"`·'.includes(ch)) return 0.28;
  if ('()[]{}<>'.includes(ch)) return 0.42;
  if ('-–—~|/\\'.includes(ch)) return 0.42;
  if (ch >= '0' && ch <= '9') return 0.56;
  if (ch >= 'A' && ch <= 'Z') return 0.66;
  if (ch >= 'a' && ch <= 'z') return 0.54;
  return 0.6;
}

export function textEm(text: string): number {
  let sum = 0;
  for (const ch of text) sum += charEm(ch);
  return sum;
}

export function pyRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

export function splitWords(text: string): string[] {
  const words: string[] = [];
  let cur = '';
  for (const ch of text.trim()) {
    if (ch === ' ') {
      if (cur) {
        words.push(cur);
        cur = '';
      }
    } else cur += ch;
  }
  if (cur) words.push(cur);
  return words;
}

/** 토큰 인덱스를 줄 단위로 나눈다(폭 추정 기반, 결정적) */
export function wrapTokens(words: string[], maxEm: number): number[][] {
  const lines: number[][] = [];
  let cur: number[] = [];
  let curEm = 0;
  words.forEach((text, idx) => {
    const w = textEm(text);
    if (!cur.length) {
      cur = [idx];
      curEm = w;
      return;
    }
    if (curEm + SPACE_EM + w <= maxEm) {
      cur.push(idx);
      curEm += SPACE_EM + w;
    } else {
      lines.push(cur);
      cur = [idx];
      curEm = w;
    }
  });
  if (cur.length) lines.push(cur);
  return lines.length ? lines : [[]];
}

export interface Token {
  text: string;
  wordIndex: number;
  x: number;
  w: number;
}

export interface Line {
  tokens: Token[];
  baseline: number;
  startX: number;
  width: number;
}

export interface CueLayout {
  cueId: string;
  fontPx: number;
  lineHeight: number;
  lines: Line[];
  blockTop: number;
  blockHeight: number;
  box: { x: number; y: number; w: number; h: number } | null;
}

export type Measure = (text: string) => number;

export function computeLayout(
  cue: Cue,
  style: SubtitleStyle,
  canvasW: number,
  canvasH: number,
  measure: Measure,
): CueLayout {
  const fontPx = Math.max(6, (style.fontSize / 100) * canvasH);
  const lineHeight = fontPx * style.lineHeight;
  const maxEm = Math.max(1, (canvasW * style.maxWidthPct) / 100 / fontPx);

  let words = splitWords(cue.text);
  if (!words.length) words = [''];

  const groups = wrapTokens(words, maxEm);
  const blockHeight = (groups.length - 1) * lineHeight + fontPx;
  const top = (canvasH * style.yPercent) / 100 - blockHeight / 2;

  const lines: Line[] = groups.map((group, li) => {
    const tokens: Token[] = [];
    let width = 0;
    group.forEach((wi, k) => {
      const w = measure(words[wi]);
      if (k > 0) width += measure(' ');
      tokens.push({ text: words[wi], wordIndex: wi, x: 0, w });
      width += w;
    });
    const startX = (canvasW - width) / 2;
    let x = startX;
    tokens.forEach((tok, k) => {
      if (k > 0) x += measure(' ');
      tok.x = x;
      x += tok.w;
      if (style.letterSpacing) x += style.letterSpacing * fontPx;
    });
    return {
      tokens,
      baseline: top + fontPx * ASCENT_RATIO + li * lineHeight,
      startX,
      width,
    };
  });

  let box: CueLayout['box'] = null;
  if (style.boxOpacity > 0.001) {
    const padX = fontPx * style.boxPadX;
    const padY = fontPx * style.boxPadY;
    const widest = lines.reduce((m, ln) => Math.max(m, ln.width), 0);
    box = { x: (canvasW - widest) / 2 - padX, y: top - padY, w: widest + padX * 2, h: blockHeight + padY * 2 };
  }

  return { cueId: cue.id, fontPx, lineHeight, lines, blockTop: top, blockHeight, box };
}

export function bounceScale(tLocal: number): number {
  if (tLocal < 0) return 0;
  if (tLocal < 0.18) {
    const p = tLocal / 0.18;
    const e = 1 - Math.pow(1 - p, 3);
    return 0.55 + (1.08 - 0.55) * e;
  }
  if (tLocal < 0.34) {
    const p = (tLocal - 0.18) / 0.16;
    return 1.08 - 0.08 * p;
  }
  return 1;
}

export function fnv1a(text: string): number {
  let h = 2166136261;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= byte;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function hash32(a: number, b: number, c: number, d: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1274126177) + Math.imul(d, 2654435761)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function jiggle(charIndex: number, cueSeed: number, step: number, channel: number): number {
  const h = hash32(charIndex + 1, cueSeed, step, channel);
  return (h / 4294967295) * 2 - 1;
}

export interface CharTransform {
  dx: number;
  dy: number;
  rot: number;
  scale: number;
}

export function charTransform(
  charIndex: number,
  cueSeed: number,
  tAbs: number,
  intensity: number,
  fontPx: number,
): CharTransform {
  if (intensity <= 0.001) return { dx: 0, dy: 0, rot: 0, scale: 1 };
  const step = Math.floor(tAbs * 12);
  return {
    dx: jiggle(charIndex, cueSeed, step, 1) * 0.035 * fontPx * intensity,
    dy: jiggle(charIndex, cueSeed, step, 2) * 0.03 * fontPx * intensity,
    rot: ((jiggle(charIndex, cueSeed, step, 3) * 9 * intensity) * Math.PI) / 180,
    scale: 1 + jiggle(charIndex, cueSeed, step, 4) * 0.05 * intensity,
  };
}

export function wordAt(cue: Cue, tRel: number): number | null {
  if (cue.words?.length) {
    for (let i = 0; i < cue.words.length; i += 1) {
      const w = cue.words[i];
      if (w.start <= tRel && tRel < w.end) return i;
    }
    if (tRel >= cue.words[cue.words.length - 1].end) return cue.words.length - 1;
    return null;
  }
  return null;
}

/** 단어 타임스탬프가 없을 때 글자 수 비례 배분 (python words_fallback 과 동일) */
export function wordsFallback(cue: Cue): { text: string; start: number; end: number }[] {
  const words = splitWords(cue.text);
  if (!words.length) return [];
  const total = words.reduce((s, w) => s + w.length, 0) || 1;
  const dur = Math.max(0.01, cue.end - cue.start);
  let acc = 0;
  return words.map((w) => {
    const s = cue.start + (dur * acc) / total;
    acc += w.length;
    const e = cue.start + (dur * acc) / total;
    return { text: w, start: s, end: e };
  });
}

// ------------------------------------------------------------------ 기하
export const MAX_RENDER_WIDTH = 1920;
const ASPECT_RATIO: Record<Aspect, number | null> = {
  original: null,
  '9:16': 9 / 16,
  '1:1': 1,
  '16:9': 16 / 9,
  '4:5': 4 / 5,
};

const even = (v: number) => {
  const r = pyRound(v);
  return r % 2 === 0 ? r : r + 1;
};

export interface Geometry {
  outW: number;
  outH: number;
  cropX: number;
  cropY: number;
}

/** backend/app/media.py output_geometry 와 동일 */
export function outputGeometry(width: number, height: number, aspect: Aspect): Geometry {
  const ratio = ASPECT_RATIO[aspect];
  if (ratio == null) return { outW: width, outH: height, cropX: 0, cropY: 0 };
  const srcRatio = width / height;
  let cropW: number;
  let cropH: number;
  if (ratio < srcRatio) {
    cropW = height * ratio;
    cropH = height;
  } else {
    cropW = width;
    cropH = width / ratio;
  }
  const longest = Math.max(cropW, cropH);
  if (longest > MAX_RENDER_WIDTH) {
    const s = MAX_RENDER_WIDTH / longest;
    cropW *= s;
    cropH *= s;
  }
  const outW = even(cropW);
  const outH = even(cropH);
  let cropX = pyRound((width - outW) / 2);
  let cropY = pyRound((height - outH) / 2);
  cropX = Math.max(0, Math.min(width - outW, cropX));
  cropY = Math.max(0, Math.min(height - outH, cropY));
  return { outW, outH, cropX, cropY };
}

/** backend/app/renderer.py blur_sigma */
export function blurSigma(strength: number, w: number, h: number): number {
  const s = Math.max(1, Math.min(100, strength)) / 100;
  const base = Math.max(1, Math.min(w, h));
  return (0.5 + 20 * s) * Math.max(1, base / 120);
}

/** backend/app/renderer.py pixel_block */
export function pixelBlock(strength: number, w: number, h: number): number {
  const s = Math.max(1, Math.min(100, strength)) / 100;
  const base = Math.max(1, Math.min(w, h));
  return Math.max(2, pyRound((0.01 + 0.1 * s) * base));
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** keyframes 사이를 선형 보간 (backend/tracking.box_at_frames 와 동일) */
export function boxAtFrames(
  frames: { t: number; x: number; y: number; w: number; h: number }[],
  t: number,
): Box | null {
  if (!frames.length) return null;
  if (t <= frames[0].t) return { ...frames[0] };
  if (t >= frames[frames.length - 1].t) return { ...frames[frames.length - 1] };
  for (let i = 1; i < frames.length; i += 1) {
    if (t <= frames[i].t) {
      const a = frames[i - 1];
      const b = frames[i];
      const p = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return {
        x: a.x + (b.x - a.x) * p,
        y: a.y + (b.y - a.y) * p,
        w: a.w + (b.w - a.w) * p,
        h: a.h + (b.h - a.h) * p,
      };
    }
  }
  return { ...frames[frames.length - 1] };
}

export function hexToRgb(hex: string): [number, number, number] {
  let c = hex.replace('#', '').trim();
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  if (c.length !== 6) return [255, 255, 255];
  const n = parseInt(c, 16);
  if (Number.isNaN(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}
