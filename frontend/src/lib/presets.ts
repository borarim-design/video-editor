import type { Cue, EditSpec, HookPreset, HookTitle, MaskState, SubtitleState, SubtitleStyle } from '../types';

/** 캔버스/백엔드 공통 자막 스타일 기본값 (backend/app/models.py SubtitleStyle 과 동일) */
export const DEFAULT_STYLE: SubtitleStyle = {
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
};

export const DEFAULT_HOOK: HookTitle = {
  enabled: false,
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
  skew: 0,
  font: 'pretendard',
  weight: 'extrabold',
  lineHeight: 1.16,
  speedLines: {
    enabled: false,
    color: '#FFFFFF',
    opacity: 0.5,
    count: 76,
    innerRadius: 0.62,
    seed: 7,
  },
};

export interface HookPresetDef {
  id: HookPreset;
  name: string;
  tagline: string;
  emoji: string;
  sampleTitle: string;
  sampleSub: string;
  style: Partial<HookTitle>;
}

/** 상단 후킹 타이틀 프리셋 4종 (레퍼런스 릴스 스타일) */
export const HOOK_PRESETS: HookPresetDef[] = [
  {
    id: 'reviewming',
    name: '리뷰밍밍',
    tagline: '서브바 + 기울임 2줄 빅타이틀 + 집중선',
    emoji: '🔥',
    sampleTitle: '2027년에 결혼하면\n개이득인 이유',
    sampleSub: '결혼준비 브이로그',
    style: {
      yPercent: 24, fontSize: 9, subSize: 2.9, color: '#FFFFFF', accent: '#FFD84D',
      accentLine: 2, strokeWidth: 0.12, skew: -6, font: 'pretendard', weight: 'extrabold',
      pillColor: '#000000', pillOpacity: 0.55, subColor: '#FFFFFF',
      boxOpacity: 0, lineHeight: 1.16,
      speedLines: {
        enabled: true, color: '#FFFFFF', opacity: 0.5, count: 76, innerRadius: 0.62, seed: 7,
      },
    },
  },
  {
    id: 'vlog',
    name: '감성 브이로그',
    tagline: '굵은 외곽선 한 줄 타이틀',
    emoji: '🎬',
    sampleTitle: '드레스 피팅 Vlog',
    sampleSub: '',
    style: {
      yPercent: 26, fontSize: 8.6, subSize: 2.8, color: '#FFFFFF', accent: '#FFFFFF',
      accentLine: 0, strokeWidth: 0.16, skew: 0, font: 'pretendard', weight: 'bold',
      boxOpacity: 0, pillOpacity: 0.5, lineHeight: 1.16,
      speedLines: {
        enabled: false, color: '#FFFFFF', opacity: 0.5, count: 76, innerRadius: 0.62, seed: 7,
      },
    },
  },
  {
    id: 'blackbox',
    name: '블랙 박스',
    tagline: '반투명 라운드 박스 + 굵은 흰 글씨',
    emoji: '🖤',
    sampleTitle: '엄마! 학예회 때\n예쁘게 좀 하고와',
    sampleSub: '',
    style: {
      yPercent: 20, fontSize: 7.4, subSize: 2.6, color: '#FFFFFF', accent: '#FFFFFF',
      accentLine: 0, strokeWidth: 0, skew: 0, font: 'dohyeon', weight: 'regular',
      boxOpacity: 0.56, boxColor: '#000000', boxRadius: 0.35, lineHeight: 1.18,
      speedLines: {
        enabled: false, color: '#FFFFFF', opacity: 0.5, count: 76, innerRadius: 0.62, seed: 7,
      },
    },
  },
  {
    id: 'badge',
    name: '배지 + 손글씨',
    tagline: '컬러 배지 + 삐뚤빼뚤 손글씨',
    emoji: '🏷️',
    sampleTitle: '월세 30만원에\n이런 뷰라고?',
    sampleSub: '등대같은 월세집',
    style: {
      yPercent: 24, fontSize: 8.8, subSize: 2.7, color: '#FFFFFF', accent: '#FFFFFF',
      accentLine: 0, strokeWidth: 0.05, skew: -3, font: 'nanumpen', weight: 'regular',
      pillColor: '#7C5CFF', pillOpacity: 0.88, subColor: '#FFFFFF',
      boxOpacity: 0, lineHeight: 1.2,
      speedLines: {
        enabled: false, color: '#FFFFFF', opacity: 0.5, count: 76, innerRadius: 0.62, seed: 7,
      },
    },
  },
];

export function applyHookPreset(hook: HookTitle, preset: HookPreset): HookTitle {
  const def = HOOK_PRESETS.find((p) => p.id === preset);
  if (!def) return { ...hook, preset };
  return {
    ...hook,
    ...def.style,
    preset,
    speedLines: { ...(def.style.speedLines ?? hook.speedLines) },
  };
}

export interface PresetDef {
  id: SubtitleStyle['preset'];
  name: string;
  tagline: string;
  emoji: string;
  style: Partial<SubtitleStyle>;
}

/** 요즘 릴스·숏츠에서 도는 자막 스타일 프리셋 */
export const PRESETS: PresetDef[] = [
  {
    id: 'highlight',
    name: '단어 강조',
    tagline: '말하는 단어만 컬러로 톡',
    emoji: '✨',
    style: {
      color: '#FFFFFF', accent: '#FFE14D', strokeWidth: 0.1, strokeColor: '#000000',
      shadow: 0.1, boxOpacity: 0, wobble: 0, highlightScale: 1.16, weight: 'bold',
    },
  },
  {
    id: 'bounce',
    name: '바운스 팝업',
    tagline: '통통 튀어오르는 등장',
    emoji: '🎈',
    style: {
      color: '#FFFFFF', accent: '#FFFFFF', strokeWidth: 0.14, strokeColor: '#111111',
      shadow: 0.12, boxOpacity: 0, wobble: 0, highlightScale: 1, weight: 'bold',
    },
  },
  {
    id: 'box',
    name: '둥근 박스',
    tagline: '깔끔한 정보 전달',
    emoji: '🏷️',
    style: {
      color: '#111111', accent: '#E11D48', strokeWidth: 0, boxColor: '#FFFFFF',
      boxOpacity: 0.92, boxRadius: 0.45, boxPadX: 0.55, boxPadY: 0.36, shadow: 0,
      wobble: 0, highlightScale: 1, weight: 'bold',
    },
  },
  {
    id: 'outline',
    name: '굵은 외곽선',
    tagline: '화면 어디서든 또렷하게',
    emoji: '🖊️',
    style: {
      color: '#FFFFFF', accent: '#7DD3FC', strokeWidth: 0.2, strokeColor: '#000000',
      shadow: 0, boxOpacity: 0, wobble: 0, highlightScale: 1, weight: 'bold',
    },
  },
  {
    id: 'jiggle',
    name: '지글지글',
    tagline: '삐뚤빼뚤 명조 감성',
    emoji: '〰️',
    style: {
      color: '#FFF6E5', accent: '#FFD9A0', strokeWidth: 0.04, strokeColor: '#3A2A1E',
      shadow: 0.08, boxOpacity: 0, wobble: 60, highlightScale: 1.06,
      font: 'maruburi', weight: 'regular',
    },
  },
  {
    id: 'plain',
    name: '심플',
    tagline: '군더더기 없이',
    emoji: '⚪',
    style: {
      color: '#FFFFFF', accent: '#FFFFFF', strokeWidth: 0, shadow: 0.08,
      boxOpacity: 0, wobble: 0, highlightScale: 1, weight: 'regular',
    },
  },
];

export function applyPreset(style: SubtitleStyle, preset: SubtitleStyle['preset']): SubtitleStyle {
  const def = PRESETS.find((p) => p.id === preset);
  if (!def) return { ...style, preset };
  return { ...style, ...def.style, preset };
}

export const DEFAULT_MASKS: MaskState = {
  enabled: true,
  mode: 'blur',
  shape: 'ellipse',
  strength: 60,
  pad: 0.18,
  tracks: [],
  manual: [],
};

export const ASPECTS: { id: EditSpec['aspect']; name: string; hint: string }[] = [
  { id: 'original', name: '원본', hint: '원본 비율 그대로' },
  { id: '9:16', name: '9:16', hint: '릴스·숏츠·틱톡' },
  { id: '1:1', name: '1:1', hint: '피드 정사각' },
  { id: '16:9', name: '16:9', hint: '유튜브 가로' },
  { id: '4:5', name: '4:5', hint: '인스타 세로 피드' },
];

export function buildSpec(
  trim: { start: number; end: number },
  aspect: EditSpec['aspect'],
  subtitles: SubtitleState,
  masks: MaskState,
  hook: HookTitle,
): EditSpec {
  return {
    trim: { start: trim.start, end: trim.end },
    aspect,
    subtitles: {
      enabled: subtitles.enabled,
      cues: subtitles.cues,
      style: subtitles.style,
    },
    hook,
    masks: {
      enabled: masks.enabled,
      mode: masks.mode,
      shape: masks.shape,
      strength: masks.strength,
      pad: masks.pad,
      tracks: masks.tracks,
      manual: masks.manual,
    },
  };
}

/** 데모/테스트용 큐 */
export function sampleCues(duration: number): Cue[] {
  const texts = ['오늘은 릴스 자막 만들기', '지글지글 명조 감성 어때?', '이렇게 딱 맞춰'];
  const span = Math.max(1.5, Math.min(duration, 9) / texts.length);
  return texts.map((text, i) => {
    const start = 0.2 + i * span;
    const words = text.split(' ').map((w, k, arr) => {
      const d = (span - 0.2) / arr.length;
      return { text: w, start: start + k * d, end: start + (k + 1) * d };
    });
    return {
      id: `demo-${i + 1}`,
      start,
      end: Math.min(duration - 0.05, start + span - 0.15),
      text,
      words,
    };
  });
}
