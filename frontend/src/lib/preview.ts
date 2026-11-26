/**
 * Canvas 실시간 미리보기 — backend/app/subtitle_draw.py, renderer.py 와 같은 계산.
 */
import type { Cue, EditSpec, HookTitle, PersonTrack, SpeedLines, SubtitleStyle } from '../types';
import { fontFamilyName } from './fonts';
import {
  SPACE_ADVANCE,
  boxAtFrames,
  blurSigma,
  charTransform,
  computeHookLayout,
  computeLayout,
  fnv1a,
  hash32,
  bounceScale,
  outputGeometry,
  pixelBlock,
  pyRound,
  rgba,
  speedLinePolys,
  splitWords,
  wordsFallback,
  type CueLayout,
  type HookLine,
  type Measure,
} from './layout';
import { hookDecorOf } from './presets';
import { drawStickers, type StickerDrawOptions } from './stickers';
import { drawOverlays } from './widgets';

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
  /** 미리보기에서 선택된 스티커 강조 */
  selectedStickerId?: string | null;
}

/** 미리보기 한 프레임을 그린다. t 는 트림 시작 기준(초).
 *  반환값: 영상 프레임을 실제로 그렸으면 true (iOS 첫 프레임 폴백 판단용). */
export function drawPreview(opts: DrawOptions): boolean {
  const { canvas, video, projectWidth, projectHeight, spec, tracks } = opts;
  const geo = outputGeometry(projectWidth, projectHeight, spec.aspect);
  if (canvas.width !== geo.outW || canvas.height !== geo.outH) {
    canvas.width = geo.outW;
    canvas.height = geo.outH;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const src: HTMLVideoElement | HTMLImageElement | null = opts.image ?? video;
  if (!src) return false;
  try {
    ctx.drawImage(src, geo.cropX, geo.cropY, geo.outW, geo.outH, 0, 0, geo.outW, geo.outH);
  } catch {
    return false;
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

  // 사진 스티커 → 위젯 → 후킹 타이틀 → 자막 순서로 얹는다(글자가 항상 맨 위).
  if (spec.stickers?.length) {
    const stickerOpts: StickerDrawOptions = { t: opts.t, selectedId: opts.selectedStickerId ?? null };
    drawStickers(ctx, spec.stickers, geo.outW, geo.outH, stickerOpts);
  }

  if (spec.overlays) {
    drawOverlays(ctx, spec.overlays, geo.outW, geo.outH);
  }

  if (spec.hook.enabled) {
    drawHook(ctx, spec.hook, geo.outW, geo.outH, opts.t);
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
  return true;
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


// ------------------------------------------------------------------ 후킹 타이틀
export function drawSpeedLines(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  cfg: SpeedLines,
): void {
  ctx.save();
  ctx.fillStyle = rgba(cfg.color, cfg.opacity);
  speedLinePolys(W, H, cfg).forEach((tri) => {
    ctx.beginPath();
    ctx.moveTo(tri[0].x, tri[0].y);
    ctx.lineTo(tri[1].x, tri[1].y);
    ctx.lineTo(tri[2].x, tri[2].y);
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();
}

function colorLuminance(hex: string): number {
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  const n = parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return 0;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function tornJitter(seed: number, i: number): number {
  return (hash32(seed, i + 1, 11, 5) / 4294967295) * 2 - 1;
}

/** 찢어진 종이 조각 모양의 사각형 패스 (결정적 난수) */
function tornPaperPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
): void {
  const amp = Math.min(w, h) * 0.05;
  const nx = 7;
  const ny = 4;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < nx; i += 1) {
    pts.push({ x: x + (w * i) / (nx - 1), y: y + tornJitter(seed, i) * amp });
  }
  for (let i = 1; i < ny; i += 1) {
    pts.push({ x: x + w + tornJitter(seed, 20 + i) * amp, y: y + (h * i) / (ny - 1) });
  }
  for (let i = nx - 2; i >= 0; i -= 1) {
    pts.push({ x: x + (w * i) / (nx - 1), y: y + h + tornJitter(seed, 40 + i) * amp });
  }
  for (let i = ny - 2; i >= 1; i -= 1) {
    pts.push({ x: x + tornJitter(seed, 60 + i) * amp, y: y + (h * i) / (ny - 1) });
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

export function drawHook(
  ctx: CanvasRenderingContext2D,
  hook: HookTitle,
  W: number,
  H: number,
  t: number,
): void {
  const start = hook.start ?? 0;
  const end = hook.end;
  if (t < start - 1e-6) return;
  if (end != null && t > end + 1e-6) return;
  if (!hook.title.trim() && !hook.subtext.trim() && !hook.speedLines.enabled) return;

  if (hook.speedLines.enabled) drawSpeedLines(ctx, W, H, hook.speedLines);

  const fontPx = Math.max(6, (hook.fontSize / 100) * H);
  const subPx = Math.max(4, (hook.subSize / 100) * H);
  const family = fontFamilyName(hook.font, hook.weight);
  const decor = hookDecorOf(hook);

  ctx.save();
  // 주의: measureMain/measureSub 는 호출 시점의 ctx.font 를 쓰므로
  // 각 함수 안에서 폰트를 다시 지정한다(예전엔 서브 폰트로 본문을 재던 버그가 있었다).
  const mainFont = `400 ${fontPx}px "${family}", "Malgun Gothic", sans-serif`;
  const subFont = `400 ${subPx}px "${family}", "Malgun Gothic", sans-serif`;
  const measureMain = (text: string) => {
    if (!text) return 0;
    ctx.font = mainFont;
    return ctx.measureText(text).width;
  };
  const measureSub = (text: string) => {
    if (!text) return 0;
    ctx.font = subFont;
    return ctx.measureText(text).width;
  };

  const lay = computeHookLayout(hook, W, H, measureMain, measureSub);
  ctx.font = mainFont;

  if (lay.box) {
    ctx.fillStyle = rgba(hook.boxColor, hook.boxOpacity);
    ctx.beginPath();
    const radius = Math.min(hook.boxRadius * lay.fontPx, lay.box.w / 2, lay.box.h / 2);
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(lay.box.x, lay.box.y, lay.box.w, lay.box.h, radius);
    } else {
      ctx.rect(lay.box.x, lay.box.y, lay.box.w, lay.box.h);
    }
    ctx.fill();
  }

  // 서브 문구 알약(최대 2개 — 반투명 흰 라벨 2개 레퍼런스)
  lay.pills.forEach((pill) => {
    ctx.fillStyle = rgba(hook.pillColor, hook.pillOpacity);
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(pill.x, pill.y, pill.w, pill.h, pill.h / 2);
    } else {
      ctx.rect(pill.x, pill.y, pill.w, pill.h);
    }
    ctx.fill();
    drawWordsCentered(ctx, pill.text, pill.x + pill.w / 2, pill.y + pill.h / 2 + subPx * 0.35,
      subPx, hook.subColor, 0, hook.strokeColor, family);
  });

  const strokeW = hook.strokeWidth * lay.fontPx;
  const barH = lay.fontPx * (decor.barShape === 'torn' ? 1.68 : 1.42);
  const barPadX = lay.fontPx * decor.barPadX;
  const labelPad = lay.fontPx * 0.22;
  const bracketAccent = { color: hook.accent, extraStroke: lay.fontPx * 0.035 };

  (lay.lines as HookLine[]).forEach((line, i) => {
    const isLast = i === lay.lines.length - 1;
    const barColor = decor.bars && decor.barColors.length
      ? decor.barColors[i % decor.barColors.length]
      : null;
    const lightBar = barColor ? colorLuminance(barColor) > 0.62 : false;

    let color = line.isAccent ? hook.accent : hook.color;
    if (barColor && lightBar) color = '#141414';
    if (decor.labelBox && isLast) color = decor.labelBoxTextColor;

    ctx.save();
    ctx.translate(W / 2, line.baseline - lay.fontPx * 0.35);
    if (Math.abs(hook.skew) > 0.01) ctx.rotate((hook.skew * Math.PI) / 180);

    if (barColor) {
      const x0 = -line.width / 2 - barPadX;
      const w0 = line.width + barPadX * 2;
      const y0 = -barH / 2;
      const seed = fnv1a(`${line.text}#${i}`);

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, decor.barOpacity));
      if (decor.paperShadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.28)';
        ctx.shadowBlur = lay.fontPx * 0.14;
        ctx.shadowOffsetY = lay.fontPx * 0.06;
      }
      ctx.fillStyle = barColor;
      if (decor.barShape === 'torn') tornPaperPath(ctx, x0, y0, w0, barH, seed);
      else {
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x0, y0, w0, barH, lay.fontPx * decor.barRadius);
        } else {
          ctx.rect(x0, y0, w0, barH);
        }
      }
      ctx.fill();
      ctx.restore();

      // 흰 바는 얇은 먹선을 넣어 종이/박스처럼 보이게 한다.
      if (lightBar) {
        ctx.save();
        ctx.strokeStyle = 'rgba(20,20,20,0.7)';
        ctx.lineWidth = Math.max(1, lay.fontPx * 0.016);
        if (decor.barShape === 'torn') tornPaperPath(ctx, x0, y0, w0, barH, seed);
        else {
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(x0, y0, w0, barH, lay.fontPx * decor.barRadius);
          } else {
            ctx.rect(x0, y0, w0, barH);
          }
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    if (decor.labelBox && isLast) {
      ctx.fillStyle = decor.labelBoxColor;
      const bh = lay.fontPx * 1.06;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(-line.width / 2 - labelPad, -bh / 2, line.width + labelPad * 2, bh, lay.fontPx * 0.1);
      } else {
        ctx.rect(-line.width / 2 - labelPad, -bh / 2, line.width + labelPad * 2, bh);
      }
      ctx.fill();
    }

    drawWordsCentered(ctx, line.text, 0, lay.fontPx * 0.35, lay.fontPx,
      color, strokeW, hook.strokeColor, family, bracketAccent);
    ctx.restore();
  });
  ctx.restore();
}

function drawWordsCentered(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  baseline: number,
  sizePx: number,
  color: string,
  strokeW: number,
  strokeColor: string,
  family: string,
  accent?: { color: string; extraStroke: number },
): void {
  const words = splitWords(text);
  if (!words.length) return;
  ctx.font = `400 ${sizePx}px "${family}", "Malgun Gothic", sans-serif`;
  const widths = words.map((w) => ctx.measureText(w).width);
  const space = sizePx * SPACE_ADVANCE;
  const total = widths.reduce((a, b) => a + b, 0) + space * Math.max(0, words.length - 1);
  let x = centerX - total / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  words.forEach((w, i) => {
    const isBracket = Boolean(accent) && /^\[.*\]$/.test(w);
    const fill = isBracket && accent ? accent.color : color;
    const sw = isBracket && accent ? strokeW + accent.extraStroke : strokeW;
    if (sw > 0.2) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = sw * 2;
      ctx.strokeStyle = strokeColor;
      ctx.strokeText(w, x, baseline);
    }
    ctx.fillStyle = fill;
    ctx.fillText(w, x, baseline);
    x += widths[i] + space;
  });
}
