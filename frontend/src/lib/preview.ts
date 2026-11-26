/**
 * Canvas 실시간 미리보기 — backend/app/subtitle_draw.py, renderer.py 와 같은 계산.
 */
import type { Cue, EditSpec, PersonTrack, SubtitleStyle } from '../types';
import { fontFamilyName } from './fonts';
import {
  boxAtFrames,
  blurSigma,
  charTransform,
  computeLayout,
  fnv1a,
  bounceScale,
  outputGeometry,
  pixelBlock,
  pyRound,
  rgba,
  splitWords,
  wordsFallback,
  type CueLayout,
  type Measure,
} from './layout';

export function fontFamilyOf(fontId: string, weight: string): string {
  return fontFamilyName(fontId, weight);
}

function ctxFont(style: SubtitleStyle, sizePx: number): string {
  // 굵기는 이미 패밀리 이름에 들어 있으므로(VE_<font>_<weight>) 400 으로 고정한다.
  // 숫자 굵기를 주면 브라우저가 합성 볼드를 적용해 Pillow 결과와 달라진다.
  return `400 ${Math.max(1, sizePx)}px "${fontFamilyOf(style.font, style.weight)}", "Malgun Gothic", sans-serif`;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clipRegion(r: Region, W: number, H: number): Region | null {
  const x = Math.max(0, Math.min(W - 1, r.x));
  const y = Math.max(0, Math.min(H - 1, r.y));
  const w = Math.max(2, Math.min(W - x, r.w));
  const h = Math.max(2, Math.min(H - y, r.h));
  if (w < 2 || h < 2) return null;
  return { x, y, w, h };
}

function applyEffect(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  box: Region,
  mode: 'blur' | 'pixelate',
  strength: number,
  shape: 'rect' | 'ellipse' | 'circle',
): void {
  const r = clipRegion(box, W, H);
  if (!r) return;
  const w = Math.round(r.w);
  const h = Math.round(r.h);
  const processed = makeCanvas(w, h);
  const pctx = processed.getContext('2d');
  if (!pctx) return;

  if (mode === 'pixelate') {
    const block = pixelBlock(strength, w, h);
    const sw = Math.max(1, Math.floor(w / block));
    const sh = Math.max(1, Math.floor(h / block));
    const small = makeCanvas(sw, sh);
    const sctx = small.getContext('2d');
    if (!sctx) return;
    sctx.drawImage(ctx.canvas, r.x, r.y, w, h, 0, 0, sw, sh);
    pctx.imageSmoothingEnabled = false;
    pctx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);
  } else {
    const sigma = blurSigma(strength, w, h);
    pctx.filter = `blur(${sigma}px)`;
    // 블러는 가장자리 투명 픽셀이 섞이지 않도록 여유 있게 그린다.
    pctx.drawImage(ctx.canvas, r.x, r.y, w, h, 0, 0, w, h);
    pctx.filter = 'none';
  }

  if (shape !== 'rect') {
    pctx.globalCompositeOperation = 'destination-in';
    const feather = Math.max(1, Math.min(w, h) * 0.04);
    pctx.filter = `blur(${feather}px)`;
    pctx.fillStyle = '#ffffff';
    pctx.beginPath();
    if (shape === 'circle') {
      const d = Math.min(w, h);
      pctx.ellipse(w / 2, h / 2, d / 2, d / 2, 0, 0, Math.PI * 2);
    } else {
      pctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    }
    pctx.fill();
    pctx.filter = 'none';
    pctx.globalCompositeOperation = 'source-over';
  }

  ctx.drawImage(processed, r.x, r.y);
}

export interface DrawOptions {
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement | null;
  projectWidth: number;
  projectHeight: number;
  spec: EditSpec;
  tracks: PersonTrack[];
  /** 자막 타임라인(트림 시작 = 0) */
  t: number;
  /** 모자이크용 원본 영상 시간(초) */
  tSource: number;
  /** 영상 프레임 대신 정지 이미지를 그릴 때(썸네일) */
  image?: HTMLImageElement | null;
  dragBox?: Region | null;
}

/** 미리보기 한 프레임을 그린다. t 는 트림 시작 기준(초). */
export function drawPreview(opts: DrawOptions): void {
  const { canvas, video, projectWidth, projectHeight, spec, tracks } = opts;
  const geo = outputGeometry(projectWidth, projectHeight, spec.aspect);
  if (canvas.width !== geo.outW || canvas.height !== geo.outH) {
    canvas.width = geo.outW;
    canvas.height = geo.outH;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const src: HTMLVideoElement | HTMLImageElement | null = opts.image ?? video;
  if (!src) return;
  try {
    ctx.drawImage(src, geo.cropX, geo.cropY, geo.outW, geo.outH, 0, 0, geo.outW, geo.outH);
  } catch {
    return;
  }

  const tSrc = opts.tSource; // 얼굴 트랙·수동 영역은 원본 영상 시간 기준

  if (spec.masks.enabled) {
    const enabled = new Map(spec.masks.tracks.map((tr) => [tr.id, tr.enabled]));
    for (const track of tracks) {
      if (!enabled.get(track.id)) continue;
      const box = boxAtFrames(track.keyframes, tSrc);
      if (!box) continue;
      const fx = box.x * projectWidth - geo.cropX;
      const fy = box.y * projectHeight - geo.cropY;
      const fw = box.w * projectWidth;
      const fh = box.h * projectHeight;
      const ex = fw * spec.masks.pad;
      const ey = fh * spec.masks.pad;
      applyEffect(ctx, geo.outW, geo.outH,
        { x: fx - ex, y: fy - ey, w: fw + ex * 2, h: fh + ey * 2 },
        spec.masks.mode, spec.masks.strength, spec.masks.shape);
    }
    for (const m of spec.masks.manual) {
      if (tSrc < m.start - 1e-6 || tSrc > m.end + 1e-6) continue;
      applyEffect(ctx, geo.outW, geo.outH,
        {
          x: m.x * projectWidth - geo.cropX,
          y: m.y * projectHeight - geo.cropY,
          w: m.w * projectWidth,
          h: m.h * projectHeight,
        },
        m.mode ?? spec.masks.mode,
        m.strength ?? spec.masks.strength,
        m.shape ?? spec.masks.shape);
    }
  }

  if (spec.subtitles.enabled) {
    drawSubtitles(ctx, spec.subtitles.cues, spec.subtitles.style, opts.t, geo.outW, geo.outH);
  }

  if (opts.dragBox) {
    const d = opts.dragBox;
    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = Math.max(2, geo.outW / 300);
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(d.x, d.y, d.w, d.h);
    ctx.fillStyle = 'rgba(56,189,248,0.18)';
    ctx.fillRect(d.x, d.y, d.w, d.h);
    ctx.restore();
  }
}

export function drawSubtitles(
  ctx: CanvasRenderingContext2D,
  cues: Cue[],
  style: SubtitleStyle,
  t: number,
  W: number,
  H: number,
): void {
  const active = cues.filter((c) => c.start - 0.001 <= t && t <= c.end + 0.15);
  if (!active.length) return;

  const baseFontPx = Math.max(6, (style.fontSize / 100) * H);
  ctx.save();
  ctx.font = ctxFont(style, baseFontPx);
  const measure: Measure = (text: string) => (text ? ctx.measureText(text).width : 0);

  active.forEach((cue, cueIdx) => {
    const lay = computeLayout(cue, style, W, H, measure);
    drawCue(ctx, lay, cue, style, t - cue.start, t, cueIdx);
  });
  ctx.restore();
}

function activeWordIndex(cue: Cue, tRel: number): number | null {
  const words = cue.words?.length
    ? cue.words.map((w) => ({ start: w.start - cue.start, end: w.end - cue.start }))
    : wordsFallback({ ...cue, start: 0, end: cue.end - cue.start }).map((w) => ({
        start: w.start,
        end: w.end,
      }));
  if (!words.length) return null;
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].start <= tRel && tRel < words[i].end) return i;
  }
  if (tRel >= words[words.length - 1].end) return words.length - 1;
  return null;
}

function drawCue(
  ctx: CanvasRenderingContext2D,
  lay: CueLayout,
  cue: Cue,
  style: SubtitleStyle,
  tRel: number,
  tAbs: number,
  cueIdx: number,
): void {
  const seed = fnv1a(cue.id);

  if (lay.box) {
    const r = style.boxRadius * lay.fontPx;
    ctx.save();
    ctx.fillStyle = rgba(style.boxColor, style.boxOpacity);
    ctx.beginPath();
    const { x, y, w, h } = lay.box;
    const radius = Math.min(r, w / 2, h / 2);
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, radius);
    } else {
      ctx.rect(x, y, w, h);
    }
    ctx.fill();
    ctx.restore();
  }

  const activeIdx = style.preset === 'highlight' ? activeWordIndex(cue, tRel) : null;

  const intensity = Math.max(0, Math.min(100, style.wobble)) / 100;
  lay.lines.forEach((line, li) => {
    let scale = 1;
    if (style.preset === 'bounce') {
      scale = bounceScale(tRel - li * 0.045);
      if (scale <= 0.01) return;
    }
    const lineCenter = line.startX + line.width / 2;
    line.tokens.forEach((tok) => {
      const isActive = activeIdx !== null && tok.wordIndex === activeIdx;
      const color = isActive ? style.accent : style.color;
      // 지글지글일 때는 단어 확대를 끄고 흔들림만 적용한다(백엔드와 동일).
      const extra = intensity > 0.001 ? 1 : isActive ? style.highlightScale : 1;
      const tokScale = scale * extra;
      const anchor = isActive ? tok.x + tok.w / 2 : lineCenter;
      const x = anchor + (tok.x - anchor) * tokScale;
      drawToken(ctx, tok.text, x, line.baseline, lay.fontPx, tokScale, color, style,
        seed, tAbs, cueIdx * 100000 + tok.wordIndex * 1000);
    });
  });
}

function drawToken(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  fontPx: number,
  scale: number,
  color: string,
  style: SubtitleStyle,
  seed: number,
  tAbs: number,
  charBase: number,
): void {
  const intensity = Math.max(0, Math.min(100, style.wobble)) / 100;
  const size = fontPx * scale;
  const strokeW = style.strokeWidth * size;

  if (intensity > 0.001) {
    let cx0 = x;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      ctx.save();
      ctx.font = ctxFont(style, size);
      const w = measureChar(ctx, ch, size, style);
      const tr = charTransform(charBase + i, seed, tAbs, intensity, fontPx);
      const cx = cx0 + w / 2 + tr.dx;
      const cy = baseline - fontPx * 0.4 + tr.dy;
      ctx.translate(cx, cy);
      ctx.rotate(tr.rot);
      ctx.scale(tr.scale, tr.scale);
      drawText(ctx, ch, -w / 2, fontPx * 0.4, color, style, strokeW);
      ctx.restore();
      cx0 += w;
    }
    return;
  }

  ctx.save();
  ctx.font = ctxFont(style, size);
  if (style.shadow > 0.01) {
    drawText(ctx, text, x, baseline + style.shadow * fontPx, 'rgba(0,0,0,0.47)', style, strokeW, true);
  }
  drawText(ctx, text, x, baseline, color, style, strokeW);
  ctx.restore();
}

function measureChar(ctx: CanvasRenderingContext2D, ch: string, size: number, style: SubtitleStyle): number {
  ctx.font = ctxFont(style, size);
  return ctx.measureText(ch).width;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  style: SubtitleStyle,
  strokeW: number,
  isShadow = false,
): void {
  if (strokeW > 0.2) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = strokeW * 2;
    ctx.strokeStyle = isShadow ? color : style.strokeColor;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** 마우스 좌표 → 원본 프레임 정규화 좌표 */
export function toSourceNorm(
  canvas: HTMLCanvasElement,
  projectWidth: number,
  projectHeight: number,
  spec: EditSpec,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const geo = outputGeometry(projectWidth, projectHeight, spec.aspect);
  const sx = ((clientX - rect.left) / rect.width) * geo.outW + geo.cropX;
  const sy = ((clientY - rect.top) / rect.height) * geo.outH + geo.cropY;
  return {
    x: Math.max(0, Math.min(1, sx / projectWidth)),
    y: Math.max(0, Math.min(1, sy / projectHeight)),
  };
}

export { splitWords, pyRound };
