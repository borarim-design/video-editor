/**
 * 자막 레이아웃·애니메이션 — backend/app/layout.py 와 1:1 대응.
 * 미리보기와 최종 MP4가 같은 좌표/같은 흔들림을 쓰도록 규칙을 그대로 옮겼다.
 */
import type { Aspect, Cue, HookTitle, SpeedLines, SubtitleStyle } from '../types';

export const ASCENT_RATIO = 0.84;
export const SPACE_EM = 0.32;
/** 단어 사이 공백 폭(em) — 폰트의 U+0020 유무와 무관하게 고정(백엔드와 동일) */
export const SPACE_ADVANCE = 0.3;

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

  const spacePx = fontPx * SPACE_ADVANCE;
  const lines: Line[] = groups.map((group, li) => {
    const tokens: Token[] = [];
    let width = 0;
    group.forEach((wi, k) => {
      const w = measure(words[wi]);
      if (k > 0) width += spacePx;
      tokens.push({ text: words[wi], wordIndex: wi, x: 0, w });
      width += w;
    });
    const startX = (canvasW - width) / 2;
    let x = startX;
    tokens.forEach((tok, k) => {
      if (k > 0) x += spacePx;
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
  '3:4': 3 / 4,
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


// ------------------------------------------------------------------ 후킹 타이틀
export interface HookToken {
  text: string;
  x: number;
  w: number;
}

export interface HookLine {
  text: string;
  width: number;
  baseline: number;
  isAccent: boolean;
  tokens: HookToken[];
}

export interface HookPill {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export interface HookLayout {
  fontPx: number;
  subPx: number;
  lines: HookLine[];
  /** 첫 번째 알약(기존 호환) */
  pill: { x: number; y: number; w: number; h: number } | null;
  /** 서브 문구를 `|` 로 나눈 알약들(최대 2개, 세로로 쌓임) */
  pills: HookPill[];
  subBaseline: number;
  blockTop: number;
  blockHeight: number;
  box: { x: number; y: number; w: number; h: number } | null;
}

/** 서브 문구를 알약 단위로 나눈다 — `|` 또는 줄바꿈, 최대 2개 */
export function splitSubText(subtext: string): string[] {
  return subtext
    .split(/[|\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2);
}

/** backend/app/layout.py compute_hook_layout 와 동일 */
export function computeHookLayout(
  hook: HookTitle,
  canvasW: number,
  canvasH: number,
  measureMain: Measure,
  measureSub: Measure,
): HookLayout {
  const fontPx = Math.max(6, (hook.fontSize / 100) * canvasH);
  const subPx = Math.max(4, (hook.subSize / 100) * canvasH);
  const lineHeight = fontPx * hook.lineHeight;
  const maxW = canvasW * 0.92;

  const texts: string[] = [];
  hook.title.replace(/\r/g, '').split('\n').forEach((rawLine) => {
    const raw = rawLine.trim();
    if (!raw) return;
    let cur = '';
    splitWords(raw).forEach((w) => {
      const cand = cur ? `${cur} ${w}` : w;
      if (cur && measureMain(cand) > maxW) {
        texts.push(cur);
        cur = w;
      } else {
        cur = cand;
      }
    });
    if (cur) texts.push(cur);
  });

  const subs = splitSubText(hook.subtext);
  const hasPill = subs.length > 0;
  const pillH = subPx * 1.55;
  const pillPad = subPx * 0.75;
  const pillGap = subPx * 0.34;
  const widths = subs.map((s) => measureSub(s));
  // 알약은 각자 문구 폭에 맞춘다(1개일 때는 예전과 완전히 같은 값).
  const pillWidths = widths.map((w) => w + pillPad * 2);
  const pillW = pillWidths.length ? Math.max(...pillWidths) : 0;
  const gap = hasPill ? subPx * 0.6 : 0;
  const pillBlockH = hasPill ? subs.length * pillH + (subs.length - 1) * pillGap : 0;

  const titleH = texts.length ? (texts.length - 1) * lineHeight + fontPx : 0;
  const blockH = (hasPill ? pillBlockH + gap : 0) + titleH;
  const top = (canvasH * hook.yPercent) / 100 - blockH / 2;

  const pills: HookPill[] = subs.map((text, i) => ({
    x: (canvasW - pillWidths[i]) / 2,
    y: top + i * (pillH + pillGap),
    w: pillWidths[i],
    h: pillH,
    text,
  }));
  const pill = pills.length ? { x: pills[0].x, y: pills[0].y, w: pills[0].w, h: pills[0].h } : null;
  const subBaseline = top + pillH / 2 + subPx * 0.35;
  const titleTop = top + (hasPill ? pillBlockH + gap : 0);

  const spacePx = fontPx * SPACE_ADVANCE;
  const lines: HookLine[] = texts.map((text, i) => {
    const words = splitWords(text);
    const widths = words.map((w) => measureMain(w));
    const lineW = widths.reduce((a, b) => a + b, 0) + spacePx * Math.max(0, words.length - 1);
    let x = (canvasW - lineW) / 2;
    const tokens: HookToken[] = words.map((w, k) => {
      const tok = { text: w, x, w: widths[k] };
      x += widths[k] + spacePx;
      return tok;
    });
    return {
      text,
      width: lineW,
      baseline: titleTop + fontPx * 0.86 + i * lineHeight,
      isAccent: hook.accentLine > 0 && i + 1 === hook.accentLine,
      tokens,
    };
  });

  let box: HookLayout['box'] = null;
  if (hook.boxOpacity > 0.001) {
    const padX = fontPx * 0.55;
    const padY = fontPx * 0.42;
    const widest = Math.max(...lines.map((l) => l.width), hasPill ? pillW : 0, 0);
    box = { x: (canvasW - widest) / 2 - padX, y: top - padY, w: widest + padX * 2, h: blockH + padY * 2 };
  }

  return { fontPx, subPx, lines, pill, pills, subBaseline, blockTop: top, blockHeight: blockH, box };
}

/** backend/app/layout.py speed_line_polys 와 동일 */
export function speedLinePolys(
  canvasW: number,
  canvasH: number,
  cfg: SpeedLines,
): { x: number; y: number }[][] {
  const cx = canvasW / 2;
  const cy = canvasH / 2;
  const base = Math.min(canvasW, canvasH);
  const count = Math.max(6, Math.min(240, Math.floor(cfg.count)));
  const seed = Math.floor(cfg.seed);
  const out: { x: number; y: number }[][] = [];
  const step = (2 * Math.PI) / count;
  for (let i = 0; i < count; i += 1) {
    const a = step * i + (jiggle(i, seed, 0, 1) * 0.5 + 0.5) * step * 0.6;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const edge = Math.min(
      canvasW / 2 / Math.max(1e-6, Math.abs(ca)),
      canvasH / 2 / Math.max(1e-6, Math.abs(sa)),
    );
    const r0 = edge * cfg.innerRadius * (0.96 + 0.1 * Math.abs(jiggle(i, seed, 0, 2)));
    const w = base * 0.0042 * (0.35 + 1.15 * Math.abs(jiggle(i, seed, 0, 3)));
    const px = -sa * w;
    const py = ca * w;
    out.push([
      { x: cx + r0 * ca + px, y: cy + r0 * sa + py },
      { x: cx + r0 * ca - px, y: cy + r0 * sa - py },
      { x: cx + edge * 1.03 * ca, y: cy + edge * 1.03 * sa },
    ]);
  }
  return out;
}
