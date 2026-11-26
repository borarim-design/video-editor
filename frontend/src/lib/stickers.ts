/**
 * 사진 스티커(PiP) 오버레이.
 *
 * 사용자가 올린 이미지(최대 3장)를 출력 캔버스 좌표(0~1)로 배치하고,
 * 프레임 스타일(점선 흰 테두리 / 폴라로이드 / 둥근 모서리 / 없음)을 입혀 그린다.
 * 미리보기와 MediaRecorder 내보내기가 **같은 함수**를 쓰므로 결과가 일치한다.
 */
import type { ImageSticker, StickerFrame } from '../types';

// ---------------------------------------------------------------- 이미지 캐시
const loaded = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();
let loadListener: (() => void) | null = null;

/** 이미지 로딩이 끝나면 미리보기를 다시 그리도록 알린다. */
export function onStickerImageLoaded(fn: (() => void) | null): void {
  loadListener = fn;
}

function ensureImage(src: string): Promise<HTMLImageElement> {
  const hit = loaded.get(src);
  if (hit && hit.complete && hit.naturalWidth > 0) return Promise.resolve(hit);
  const inflight = pending.get(src);
  if (inflight) return inflight;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      loaded.set(src, img);
      pending.delete(src);
      loadListener?.();
      resolve(img);
    };
    img.onerror = () => {
      pending.delete(src);
      reject(new Error('스티커 이미지를 불러오지 못했습니다.'));
    };
    img.src = src;
  });
  pending.set(src, p);
  p.catch(() => undefined);
  return p;
}

/** 내보내기 전에 모든 스티커 이미지를 미리 디코딩한다. */
export async function preloadStickerImages(stickers: ImageSticker[]): Promise<void> {
  await Promise.all(
    stickers
      .filter((s) => s.enabled && s.src)
      .map((s) => ensureImage(s.src).catch(() => undefined)),
  );
}

export function forgetStickerImage(src: string): void {
  loaded.delete(src);
  pending.delete(src);
}

// ---------------------------------------------------------------- 기하
export interface StickerBox {
  /** 중심 좌표(출력 픽셀) */
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

export function stickerBox(st: ImageSticker, img: HTMLImageElement, W: number, H: number): StickerBox {
  const ratio = img.naturalHeight / Math.max(1, img.naturalWidth);
  let w = Math.max(12, st.width * W);
  let h = w * ratio;
  const maxH = H * 0.82;
  if (h > maxH) {
    const k = maxH / h;
    w *= k;
    h *= k;
  }
  return { cx: st.x * W, cy: st.y * H, w, h, rotation: st.rotation };
}

function framePad(frame: StickerFrame, w: number): number {
  if (frame === 'dashed') return Math.max(3, w * 0.035);
  if (frame === 'polaroid') return Math.max(4, w * 0.055);
  return 0;
}

/** 점(출력 픽셀)이 스티커 안인지 — 회전 고려 */
export function stickerHitTest(
  stickers: ImageSticker[],
  W: number,
  H: number,
  px: number,
  py: number,
): string | null {
  for (let i = stickers.length - 1; i >= 0; i -= 1) {
    const st = stickers[i];
    if (!st.enabled) continue;
    const img = loaded.get(st.src);
    if (!img) continue;
    const box = stickerBox(st, img, W, H);
    const pad = framePad(st.frame, box.w) + Math.max(4, box.w * 0.02);
    const dx = px - box.cx;
    const dy = py - box.cy;
    const a = (-box.rotation * Math.PI) / 180;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    const bottom = st.frame === 'polaroid' ? pad + box.w * 0.12 : pad;
    if (Math.abs(lx) <= box.w / 2 + pad && Math.abs(ly) <= box.h / 2 + Math.max(pad, bottom)) {
      return st.id;
    }
  }
  return null;
}

// ---------------------------------------------------------------- 그리기
export interface StickerDrawOptions {
  /** 편집본 기준 시간(초) — 표시 구간 판정 */
  t: number;
  /** 미리보기에서 선택된 스티커 강조 */
  selectedId?: string | null;
}

export function drawStickers(
  ctx: CanvasRenderingContext2D,
  stickers: ImageSticker[],
  W: number,
  H: number,
  opts: StickerDrawOptions,
): void {
  for (const st of stickers) {
    if (!st.enabled) continue;
    if (st.start != null && opts.t < st.start - 1e-6) continue;
    if (st.end != null && opts.t > st.end + 1e-6) continue;
    const img = loaded.get(st.src);
    if (!img || !img.complete || !img.naturalWidth) {
      // 아직 안 불러왔으면 로딩만 걸어 두고 다음 프레임에 그린다.
      void ensureImage(st.src);
      continue;
    }
    drawOne(ctx, st, img, W, H);
    if (opts.selectedId === st.id) drawSelection(ctx, st, img, W, H);
  }
}

function drawOne(
  ctx: CanvasRenderingContext2D,
  st: ImageSticker,
  img: HTMLImageElement,
  W: number,
  H: number,
): void {
  const box = stickerBox(st, img, W, H);
  const { w, h } = box;
  const pad = framePad(st.frame, w);

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, st.opacity));
  ctx.translate(box.cx, box.cy);
  ctx.rotate((box.rotation * Math.PI) / 180);

  if (st.frame === 'polaroid') {
    const bottom = Math.max(6, w * 0.12);
    const totalH = h + pad * 2 + bottom;
    const boxX = -w / 2 - pad;
    const boxY = -totalH / 2;
    // 종이 프레임 + 옅은 그림자
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.32)';
    ctx.shadowBlur = Math.max(6, w * 0.05);
    ctx.shadowOffsetY = Math.max(3, w * 0.015);
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, boxX, boxY, w + pad * 2, totalH, Math.max(2, w * 0.012));
    ctx.fill();
    ctx.restore();
    drawImageRound(ctx, img, -w / 2, boxY + pad, w, h, Math.max(1, w * 0.006));
  } else if (st.frame === 'rounded') {
    const radius = Math.max(4, w * 0.07);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = Math.max(5, w * 0.045);
    ctx.shadowOffsetY = Math.max(2, w * 0.012);
    drawImageRound(ctx, img, -w / 2, -h / 2, w, h, radius);
    ctx.restore();
    ctx.strokeStyle = rgbaFromHex(st.frameColor, 0.55);
    ctx.lineWidth = Math.max(1, w * 0.006);
    roundRect(ctx, -w / 2, -h / 2, w, h, radius);
    ctx.stroke();
  } else {
    // none / dashed: 사진만 또렷하게
    ctx.save();
    if (st.frame === 'dashed') {
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = Math.max(4, w * 0.03);
      ctx.shadowOffsetY = Math.max(2, w * 0.01);
    }
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
    if (st.frame === 'dashed') {
      const gap = Math.max(3, w * 0.035);
      const lw = Math.max(1.5, w * 0.009);
      ctx.save();
      ctx.strokeStyle = st.frameColor || '#FFFFFF';
      ctx.lineWidth = lw;
      ctx.setLineDash([lw * 3.2, lw * 3]);
      ctx.strokeRect(-w / 2 - gap, -h / 2 - gap, w + gap * 2, h + gap * 2);
      ctx.restore();
    }
  }

  ctx.restore();
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  st: ImageSticker,
  img: HTMLImageElement,
  W: number,
  H: number,
): void {
  const box = stickerBox(st, img, W, H);
  const pad = framePad(st.frame, box.w) + Math.max(6, box.w * 0.03);
  ctx.save();
  ctx.translate(box.cx, box.cy);
  ctx.rotate((box.rotation * Math.PI) / 180);
  ctx.strokeStyle = '#38BDF8';
  ctx.lineWidth = Math.max(2, box.w * 0.012);
  ctx.setLineDash([9, 6]);
  ctx.strokeRect(-box.w / 2 - pad, -box.h / 2 - pad, box.w + pad * 2, box.h + pad * 2);
  ctx.setLineDash([]);
  ctx.fillStyle = '#38BDF8';
  const r = Math.max(3, box.w * 0.016);
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => {
    ctx.beginPath();
    ctx.arc((sx * (box.w + pad * 2)) / 2, (sy * (box.h + pad * 2)) / 2, r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
  void st;
}

// ---------------------------------------------------------------- 헬퍼
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, radius);
  else ctx.rect(x, y, w, h);
}

function drawImageRound(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
}

function rgbaFromHex(hex: string, alpha: number): string {
  let c = (hex || '#FFFFFF').replace('#', '').trim();
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  if (c.length !== 6) return `rgba(255,255,255,${alpha})`;
  const n = parseInt(c, 16);
  if (Number.isNaN(n)) return `rgba(255,255,255,${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
