/**
 * 미리보기(Canvas) ↔ 백엔드(Pillow) 레이아웃 일치 검증용 하네스.
 * 같은 입력에 대해 TS 레이아웃 결과를 JSON 으로 뱉고,
 * backend/tests/test_e2e.py 의 test_layout_parity_with_frontend 가 파이썬 결과와 비교한다.
 */
import {
  bounceScale,
  charTransform,
  computeHookLayout,
  computeLayout,
  outputGeometry,
  blurSigma,
  pixelBlock,
  speedLinePolys,
  textEm,
} from '../src/lib/layout';
import type { Cue, HookTitle, SubtitleStyle, SpeedLines } from '../src/types';

const baseStyle = (patch: Partial<SubtitleStyle> = {}): SubtitleStyle => ({
  preset: 'highlight',
  font: 'pretendard',
  weight: 'bold',
  fontSize: 7,
  lineHeight: 1.28,
  maxWidthPct: 84,
  yPercent: 78,
  color: '#FFFFFF',
  accent: '#FFE14D',
  strokeColor: '#000000',
  strokeWidth: 0.1,
  boxColor: '#000000',
  boxOpacity: 0,
  boxRadius: 0.35,
  boxPadX: 0.45,
  boxPadY: 0.26,
  shadow: 0.1,
  wobble: 0,
  highlightScale: 1.12,
  letterSpacing: 0,
  ...patch,
});

interface Case {
  name: string;
  canvasW: number;
  canvasH: number;
  style: SubtitleStyle;
  cue: { id: string; text: string };
}

const cases: Case[] = [
  {
    name: 'short-horizontal',
    canvasW: 1920,
    canvasH: 1080,
    style: baseStyle(),
    cue: { id: 'c1', text: '오늘은 릴스 자막을 만들어 볼게요' },
  },
  {
    name: 'vertical-long',
    canvasW: 1080,
    canvasH: 1920,
    style: baseStyle({ fontSize: 9, yPercent: 70, maxWidthPct: 80 }),
    cue: { id: 'c2', text: '지글지글 명조 감성 자막이 이렇게 길어지면 두 줄 세 줄로 자연스럽게 나뉘는지 확인합니다' },
  },
  {
    name: 'box-style',
    canvasW: 1080,
    canvasH: 1080,
    style: baseStyle({ preset: 'box', fontSize: 6.4, boxOpacity: 0.9, yPercent: 60 }),
    cue: { id: 'c3', text: '둥근 박스 자막 예시 ABC 123' },
  },
  {
    name: 'tiny-screen',
    canvasW: 360,
    canvasH: 640,
    style: baseStyle({ fontSize: 5.5, maxWidthPct: 92 }),
    cue: { id: 'c4', text: '작은 화면에서도 같은 줄바꿈' },
  },
];

const out = cases.map((c) => {
  const fontPx = (c.style.fontSize / 100) * c.canvasH;
  const measure = (text: string) => textEm(text) * fontPx;
  const cue = { id: c.cue.id, start: 0, end: 2, text: c.cue.text, words: [] } as Cue;
  const layout = computeLayout(cue, c.style, c.canvasW, c.canvasH, measure);
  const seed = 123456789;
  return {
    name: c.name,
    canvasW: c.canvasW,
    canvasH: c.canvasH,
    style: c.style,
    cue: c.cue,
    layout: {
      fontPx: layout.fontPx,
      lineHeight: layout.lineHeight,
      blockTop: layout.blockTop,
      box: layout.box,
      lines: layout.lines.map((ln) => ({
        baseline: ln.baseline,
        startX: ln.startX,
        width: ln.width,
        tokens: ln.tokens.map((t) => ({ text: t.text, x: t.x, w: t.w, wordIndex: t.wordIndex })),
      })),
    },
    animations: {
      bounce: [0, 0.05, 0.1, 0.18, 0.25, 0.34, 0.5].map((t) => bounceScale(t)),
      jiggle: charTransform(3, seed, 0.5, 0.6, 40),
    },
  };
});

const geo = {
  '16:9-to-9:16': outputGeometry(1920, 1080, '9:16'),
  '16:9-to-1:1': outputGeometry(1920, 1080, '1:1'),
  'portrait-to-16:9': outputGeometry(1080, 1920, '16:9'),
  'original': outputGeometry(640, 360, 'original'),
};

const masks = {
  blur: [1, 25, 60, 100].map((s) => ({ strength: s, sigma: blurSigma(s, 120, 160) })),
  pixel: [1, 25, 60, 100].map((s) => ({ strength: s, block: pixelBlock(s, 120, 160) })),
};

// ------------------------------------------------------------------ 후킹 타이틀
const hookBase = (patch: Partial<HookTitle> = {}): HookTitle => ({
  enabled: true,
  preset: 'reviewming',
  subtext: '',
  title: '',
  start: null,
  end: null,
  yPercent: 24,
  fontSize: 9,
  subSize: 3,
  color: '#FFFFFF',
  accent: '#FFD84D',
  accentLine: 2,
  strokeColor: '#000000',
  strokeWidth: 0.12,
  boxColor: '#000000',
  boxOpacity: 0,
  boxRadius: 0.35,
  pillColor: '#000000',
  pillOpacity: 0.55,
  subColor: '#FFFFFF',
  skew: -6,
  font: 'pretendard',
  weight: 'extrabold',
  lineHeight: 1.16,
  speedLines: {
    enabled: false, color: '#FFFFFF', opacity: 0.5, count: 76, innerRadius: 0.62, seed: 7,
  },
  ...patch,
});

const hookCases = [
  {
    name: 'hook-reviewming',
    canvasW: 1080,
    canvasH: 1920,
    hook: hookBase({ subtext: '결혼준비 브이로그', title: '2027년에 결혼하면\n개이득인 이유' }),
  },
  {
    name: 'hook-blackbox',
    canvasW: 640,
    canvasH: 360,
    hook: hookBase({
      preset: 'blackbox', subtext: '', title: '엄마! 학예회 때\n예쁘게 좀 하고와',
      fontSize: 7.4, yPercent: 20, boxOpacity: 0.56, skew: 0, accentLine: 0,
    }),
  },
  {
    name: 'hook-long-line',
    canvasW: 1080,
    canvasH: 1920,
    hook: hookBase({ title: '아주 긴 제목이 한 줄을 넘어가면 자동으로 다음 줄로 넘어가는지 확인하는 케이스입니다', fontSize: 8 }),
  },
];

const hookOut = hookCases.map((c) => {
  const mainPx = Math.max(6, (c.hook.fontSize / 100) * c.canvasH);
  const subPx = Math.max(4, (c.hook.subSize / 100) * c.canvasH);
  const lay = computeHookLayout(
    c.hook, c.canvasW, c.canvasH,
    (t: string) => textEm(t) * mainPx,
    (t: string) => textEm(t) * subPx,
  );
  return {
    name: c.name,
    canvasW: c.canvasW,
    canvasH: c.canvasH,
    hook: c.hook,
    layout: {
      fontPx: lay.fontPx,
      subPx: lay.subPx,
      pill: lay.pill,
      subBaseline: lay.subBaseline,
      blockTop: lay.blockTop,
      blockHeight: lay.blockHeight,
      box: lay.box,
      lines: lay.lines.map((l) => ({
        text: l.text,
        width: l.width,
        baseline: l.baseline,
        isAccent: l.isAccent,
        tokens: l.tokens,
      })),
    },
  };
});

const speedCfg: SpeedLines = {
  enabled: true, color: '#FFFFFF', opacity: 0.5, count: 76, innerRadius: 0.62, seed: 7,
};
const speedPolys = speedLinePolys(1080, 1920, speedCfg);

process.stdout.write(JSON.stringify({
  cases: out,
  geo,
  masks,
  hooks: hookOut,
  speedLines: { count: speedPolys.length, first: speedPolys.slice(0, 3) },
}));
