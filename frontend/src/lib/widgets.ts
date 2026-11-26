/**
 * 감성 오버레이 위젯 — 카메라 뷰파인더 / 날짜 스탬프 카드 / 여행 장소 카드.
 *
 * 모두 순수 Canvas 드로잉이라 미리보기와 MediaRecorder 내보내기 결과가 같다.
 * 크기는 출력 캔버스의 짧은 변(S) 기준으로 잡아 9:16·3:4·16:9 어디서든 비슷해 보이게 한다.
 */
import type { DateCardOverlay, OverlayState, PlaceCardOverlay, ViewfinderOverlay } from '../types';
import { fontFamilyName } from './fonts';

const SANS = (weight: 'regular' | 'bold' | 'extrabold' = 'bold') =>
  `"${fontFamilyName('pretendard', weight)}", "Malgun Gothic", sans-serif`;
const SERIF = (weight: 'regular' | 'bold' = 'regular') =>
  `"${fontFamilyName('nanummyeongjo', weight)}", "Batang", serif`;

function rgba(hex: string, alpha: number): string {
  let c = (hex || '#FFFFFF').replace('#', '').trim();
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  if (c.length !== 6) return `rgba(255,255,255,${alpha})`;
  const n = parseInt(c, 16);
  if (Number.isNaN(n)) return `rgba(255,255,255,${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, alpha))})`;
}

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

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) out = out.slice(0, -1);
  return `${out}…`;
}

export function drawOverlays(
  ctx: CanvasRenderingContext2D,
  overlays: OverlayState,
  W: number,
  H: number,
): void {
  if (overlays.viewfinder.enabled) drawViewfinder(ctx, overlays.viewfinder, W, H);
  if (overlays.dateCard.enabled) drawDateCard(ctx, overlays.dateCard, W, H);
  if (overlays.placeCard.enabled) drawPlaceCard(ctx, overlays.placeCard, W, H);
}

// ---------------------------------------------------------------- 뷰파인더
function drawViewfinder(
  ctx: CanvasRenderingContext2D,
  cfg: ViewfinderOverlay,
  W: number,
  H: number,
): void {
  const S = Math.min(W, H);
  const band = H * 0.13;
  const color = cfg.color || '#FFFFFF';
  const alpha = Math.max(0, Math.min(1, cfg.opacity));

  ctx.save();
  ctx.globalAlpha = alpha;

  // 상·하단 카메라 바
  if (cfg.bandOpacity > 0.001) {
    ctx.fillStyle = rgba('#000000', cfg.bandOpacity);
    ctx.fillRect(0, 0, W, band);
    ctx.fillRect(0, H - band, W, band);
  }

  // 3×3 그리드
  ctx.strokeStyle = rgba(color, 0.42);
  ctx.lineWidth = Math.max(1, S * 0.0016);
  for (let i = 1; i <= 2; i += 1) {
    ctx.beginPath();
    ctx.moveTo((W * i) / 3, band);
    ctx.lineTo((W * i) / 3, H - band);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, band + ((H - band * 2) * i) / 3);
    ctx.lineTo(W, band + ((H - band * 2) * i) / 3);
    ctx.stroke();
  }

  // 상단 텍스트
  const topPx = Math.max(8, S * 0.026);
  ctx.font = `400 ${topPx}px ${SANS('bold')}`;
  ctx.fillStyle = rgba(color, 0.95);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(fitText(ctx, cfg.topLeft, W * 0.62), W * 0.04, band / 2);
  ctx.textAlign = 'right';
  ctx.font = `400 ${topPx * 0.86}px ${SANS('regular')}`;
  ctx.fillStyle = rgba(color, 0.8);
  ctx.fillText(cfg.topRight, W * 0.96, band / 2);

  // 하단 라벨 + 셔터
  const labels = cfg.bottomLabels.split('|').map((s) => s.trim()).filter(Boolean).slice(0, 4);
  const labelPx = Math.max(6, S * 0.019);
  const shutterR = S * 0.036;
  const slotW = W / Math.max(1, labels.length + 1);
  ctx.textBaseline = 'middle';
  ctx.font = `400 ${labelPx}px ${SANS('regular')}`;
  const rowY = H - band * 0.62;
  labels.forEach((label, i) => {
    const cx = slotW * (i + 0.5);
    ctx.textAlign = 'center';
    ctx.fillStyle = rgba(color, i === 0 ? 0.98 : 0.6);
    ctx.font = `400 ${labelPx}px ${SANS(i === 0 ? 'bold' : 'regular')}`;
    ctx.fillText(label, cx, rowY);
  });

  // 셔터 버튼
  const scx = W / 2;
  const scy = H - band * 0.36;
  ctx.beginPath();
  ctx.arc(scx, scy, shutterR, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(color, 0.95);
  ctx.lineWidth = Math.max(1.5, S * 0.004);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(scx, scy, shutterR * 0.78, 0, Math.PI * 2);
  ctx.fillStyle = rgba(color, 0.92);
  ctx.fill();

  // 좌하단 사진 미리보기(작은 사각형)
  const thumb = band * 0.52;
  ctx.fillStyle = rgba(color, 0.5);
  roundRect(ctx, W * 0.04, H - band / 2 - thumb / 2, thumb, thumb, Math.max(2, thumb * 0.14));
  ctx.fill();

  ctx.restore();
}

// ---------------------------------------------------------------- 날짜 카드
function drawDateCard(
  ctx: CanvasRenderingContext2D,
  cfg: DateCardOverlay,
  W: number,
  H: number,
): void {
  const cardW = Math.min(W * 0.58, H * 0.4) * Math.max(0.4, cfg.scale);
  const cardH = cardW * 1.16;
  const cx = cfg.x * W;
  const cy = cfg.y * H;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((cfg.rotation * Math.PI) / 180);

  // 카드 본체
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.22)';
  ctx.shadowBlur = cardW * 0.06;
  ctx.shadowOffsetY = cardW * 0.02;
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, -cardW / 2, -cardH / 2, cardW, cardH, cardW * 0.02);
  ctx.fill();
  ctx.restore();

  // eyebrow
  const eyebrowPx = cardW * 0.062;
  ctx.fillStyle = '#8C8779';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `400 ${eyebrowPx}px ${SERIF('regular')}`;
  ctx.fillText(cfg.eyebrow, 0, -cardH / 2 + cardW * 0.11);

  // 안쪽 테두리 박스
  const innerX = -cardW * 0.36;
  const innerY = -cardH / 2 + cardW * 0.18;
  const innerW = cardW * 0.72;
  const innerH = cardW * 0.66;
  ctx.strokeStyle = '#DAD5C8';
  ctx.lineWidth = Math.max(1, cardW * 0.0035);
  ctx.strokeRect(innerX, innerY, innerW, innerH);

  // 요일
  ctx.fillStyle = '#8C8779';
  ctx.font = `400 ${cardW * 0.046}px ${SERIF('regular')}`;
  ctx.fillText(cfg.weekday, 0, innerY + innerH * 0.17);

  // 날짜(큰 숫자)
  ctx.fillStyle = '#1C1A17';
  const dayPx = cardW * (cfg.day.length >= 3 ? 0.2 : 0.26);
  ctx.font = `400 ${dayPx}px ${SERIF('bold')}`;
  ctx.fillText(cfg.day, 0, innerY + innerH * 0.5);

  // 구분선 + 월/연도
  const lineY = innerY + innerH * 0.75;
  ctx.strokeStyle = '#E2DED3';
  ctx.lineWidth = Math.max(1, cardW * 0.003);
  ctx.beginPath();
  ctx.moveTo(innerX + innerW * 0.08, lineY);
  ctx.lineTo(innerX + innerW * 0.92, lineY);
  ctx.stroke();
  ctx.fillStyle = '#8C8779';
  ctx.font = `400 ${cardW * 0.042}px ${SERIF('regular')}`;
  ctx.fillText(cfg.monthYear, 0, lineY + innerH * 0.13);

  ctx.restore();
}

// ---------------------------------------------------------------- 장소 카드
function drawPlaceCard(
  ctx: CanvasRenderingContext2D,
  cfg: PlaceCardOverlay,
  W: number,
  H: number,
): void {
  const s = Math.max(0.4, cfg.scale);
  const cardW = Math.min(W * 0.88, H * 0.62) * s;
  const pad = cardW * 0.055;
  const titlePx = cardW * 0.058;
  const metaPx = cardW * 0.04;
  const chipH = cardW * 0.115;
  const cardH = pad * 2 + titlePx * 1.2 + metaPx * 1.4 + metaPx * 1.25 + chipH + cardW * 0.045;
  const accent = cfg.accent || '#2BB7A8';

  ctx.save();
  ctx.translate(cfg.x * W, cfg.y * H);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.26)';
  ctx.shadowBlur = cardW * 0.05;
  ctx.shadowOffsetY = cardW * 0.018;
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, -cardW / 2, -cardH / 2, cardW, cardH, cardW * 0.045);
  ctx.fill();
  ctx.restore();

  const left = -cardW / 2 + pad;
  const right = cardW / 2 - pad;
  let y = -cardH / 2 + pad + titlePx * 0.62;

  // 장소명 + 닫기 아이콘
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#17191C';
  ctx.font = `400 ${titlePx}px ${SANS('bold')}`;
  ctx.fillText(fitText(ctx, cfg.title, cardW * 0.72), left, y);
  ctx.strokeStyle = '#9AA0A6';
  ctx.lineWidth = Math.max(1, cardW * 0.005);
  const xr = cardW * 0.022;
  const xx = right - xr;
  ctx.beginPath();
  ctx.moveTo(xx - xr, y - xr);
  ctx.lineTo(xx + xr, y + xr);
  ctx.moveTo(xx + xr, y - xr);
  ctx.lineTo(xx - xr, y + xr);
  ctx.stroke();

  // 별점 + 리뷰 수
  y += titlePx * 0.95;
  const starPx = metaPx * 1.05;
  ctx.font = `400 ${starPx}px ${SANS('regular')}`;
  let sx = left;
  for (let i = 0; i < 5; i += 1) {
    const full = i + 1 <= Math.round(cfg.rating);
    ctx.fillStyle = full ? '#F6B21B' : '#DADDE1';
    ctx.fillText('★', sx, y);
    sx += starPx * 1.08;
  }
  ctx.fillStyle = '#5F6368';
  ctx.font = `400 ${metaPx}px ${SANS('regular')}`;
  ctx.fillText(`${cfg.rating.toFixed(1)}  (${cfg.reviews})`, sx + metaPx * 0.35, y);

  // 소요시간
  y += metaPx * 1.35;
  const icon = metaPx * 0.62;
  ctx.strokeStyle = '#5F6368';
  ctx.lineWidth = Math.max(1, cardW * 0.0045);
  ctx.beginPath();
  ctx.arc(left + icon, y, icon, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(left + icon, y - icon * 0.55);
  ctx.lineTo(left + icon, y);
  ctx.lineTo(left + icon + icon * 0.45, y + icon * 0.25);
  ctx.stroke();
  ctx.fillStyle = '#3C4043';
  ctx.font = `400 ${metaPx}px ${SANS('regular')}`;
  ctx.fillText(cfg.duration, left + icon * 2.6, y);

  // 영업 상태
  y += metaPx * 1.2;
  ctx.fillStyle = '#9AA0A6';
  ctx.font = `400 ${metaPx * 0.9}px ${SANS('regular')}`;
  ctx.fillText(fitText(ctx, cfg.status, cardW * 0.8), left, y);

  // 액션 칩 4개
  y += metaPx * 1.05 + chipH / 2;
  const chips = ['경로', '시작', '티켓', '통화'];
  const gap = cardW * 0.02;
  const chipW = (cardW - pad * 2 - gap * 3) / 4;
  chips.forEach((label, i) => {
    const chipX = left + i * (chipW + gap);
    ctx.fillStyle = rgba(accent, 0.1);
    roundRect(ctx, chipX, y - chipH / 2, chipW, chipH, chipH * 0.28);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.font = `400 ${metaPx * 0.94}px ${SANS('bold')}`;
    ctx.textAlign = 'center';
    // 아이콘 자리(작은 점) + 라벨
    const labelW = ctx.measureText(label).width;
    const glyph = metaPx * 0.24;
    const startX = chipX + chipW / 2 - (labelW + glyph * 2.2) / 2;
    ctx.beginPath();
    ctx.arc(startX + glyph * 0.5, y, glyph * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillText(label, startX + glyph * 1.5, y);
    ctx.textAlign = 'center';
  });

  ctx.restore();
}
