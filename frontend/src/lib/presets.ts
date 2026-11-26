import type {
  Cue, EditSpec, HookDecor, HookPreset, HookTitle, ImageSticker, MaskState, OverlayState,
  SubtitleState, SubtitleStyle,
} from '../types';

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

export const DEFAULT_DECOR: HookDecor = {
  bars: false,
  barShape: 'rounded',
  barColors: ['#FFE9A0', '#FFFFFF', '#BFD9FF'],
  barOpacity: 0.96,
  barRadius: 0.26,
  barPadX: 0.5,
  barPadY: 0.3,
  labelBox: false,
  labelBoxColor: '#111111',
  labelBoxTextColor: '#FFFFFF',
  paperShadow: false,
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
  decor: { ...DEFAULT_DECOR, barColors: [...DEFAULT_DECOR.barColors] },
};

/** hook.decor 가 없는 예전 스펙도 안전하게 그리기 위한 기본값 병합 */
export function hookDecorOf(hook: HookTitle): HookDecor {
  return {
    ...DEFAULT_DECOR,
    ...hook.decor,
    barColors: hook.decor?.barColors?.length ? [...hook.decor.barColors] : [...DEFAULT_DECOR.barColors],
  };
}

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
  {
    id: 'pastel-bars',
    name: '형광펜 다중 바',
    tagline: '줄마다 다른 파스텔·흰 테두리 바',
    emoji: '🖍️',
    sampleTitle: '팔로워가 적어서\n돈을 못 번다고요?',
    sampleSub: '인스타 수익화 루틴',
    style: {
      yPercent: 46, fontSize: 6.4, subSize: 2.4, color: '#141414', accent: '#141414',
      accentLine: 0, strokeWidth: 0, strokeColor: '#FFFFFF', skew: 0,
      font: 'pretendard', weight: 'extrabold', lineHeight: 1.62,
      pillColor: '#FFFFFF', pillOpacity: 0.94, subColor: '#111111', boxOpacity: 0,
      decor: {
        ...DEFAULT_DECOR,
        bars: true, barShape: 'rounded', barColors: ['#FFE9A0', '#FFFFFF', '#BFD9FF'],
        barOpacity: 0.97, barRadius: 0.2, barPadX: 0.55, barPadY: 0.3,
      },
    },
  },
  {
    id: 'color-outline-badge',
    name: '컬러 아웃라인 + 배지',
    tagline: '파스텔 채우기 + 두꺼운 흰 외곽선 + 검정 라벨',
    emoji: '🟩',
    sampleTitle: '아이폰 카메라\n웜톤 설정법',
    sampleSub: '푸른끼 빼주는',
    style: {
      yPercent: 38, fontSize: 7.2, subSize: 2.4, color: '#8CF0A2', accent: '#8CF0A2',
      accentLine: 0, strokeColor: '#FFFFFF', strokeWidth: 0.26, skew: 0,
      font: 'jua', weight: 'regular', lineHeight: 1.32,
      pillColor: '#FFFFFF', pillOpacity: 0.95, subColor: '#111111', boxOpacity: 0,
      decor: {
        ...DEFAULT_DECOR,
        labelBox: true, labelBoxColor: '#111111', labelBoxTextColor: '#FFFFFF',
        barPadX: 0.42, barPadY: 0.5,
      },
    },
  },
  {
    id: 'torn-paper',
    name: '찢어진 종이 라벨',
    tagline: '불규칙 종이 스티커 + 손글씨 + 흰 알약',
    emoji: '📜',
    sampleTitle: '망원동\n한바퀴',
    sampleSub: '미감좋은 언니들 꼭 다 모였다',
    style: {
      yPercent: 58, fontSize: 6.2, subSize: 2.2, color: '#FFFFFF', accent: '#FFFFFF',
      accentLine: 0, strokeColor: '#3A2A22', strokeWidth: 0.09, skew: -2.5,
      font: 'nanumpen', weight: 'regular', lineHeight: 1.75,
      pillColor: '#FFFFFF', pillOpacity: 0.93, subColor: '#2A2118', boxOpacity: 0,
      decor: {
        ...DEFAULT_DECOR,
        bars: true, barShape: 'torn', barColors: ['#F6C3D2', '#EFE0C3', '#F6C3D2'],
        barOpacity: 1, barPadX: 0.42, barPadY: 0.34, paperShadow: true,
      },
    },
  },
  {
    id: 'travel-bracket',
    name: '여행 포인트',
    tagline: '반투명 흰 라벨 2개 + 민트 대괄호 타이틀',
    emoji: '📍',
    sampleTitle: '[남해] 여행 코스',
    sampleSub: '한지 멋집부터|노출 카페까지',
    style: {
      yPercent: 62, fontSize: 6.0, subSize: 2.1, color: '#FFFFFF', accent: '#6BE8D8',
      accentLine: 0, strokeColor: '#0E3B36', strokeWidth: 0.17, skew: 0,
      font: 'pretendard', weight: 'extrabold', lineHeight: 1.3,
      pillColor: '#FFFFFF', pillOpacity: 0.74, subColor: '#1B2A28', boxOpacity: 0,
    },
  },
];

export function applyHookPreset(hook: HookTitle, preset: HookPreset): HookTitle {
  const def = HOOK_PRESETS.find((p) => p.id === preset);
  if (!def) return { ...hook, preset };
  const decor = def.style.decor ?? hook.decor;
  return {
    ...hook,
    ...def.style,
    preset,
    speedLines: { ...(def.style.speedLines ?? hook.speedLines) },
    decor: {
      ...DEFAULT_DECOR,
      ...decor,
      barColors: decor?.barColors?.length ? [...decor.barColors] : [...DEFAULT_DECOR.barColors],
    },
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
  { id: '3:4', name: '3:4', hint: '인스타 피드(카드뉴스)' },
];

/** 오버레이 위젯 기본값 — 모두 꺼진 상태로 시작한다. */
export const DEFAULT_OVERLAYS: OverlayState = {
  viewfinder: {
    enabled: false,
    topLeft: 'Auto · HDR Off',
    topRight: '4K',
    bottomLabels: 'VIDEO|PHOTO|SQUARE|PANO',
    color: '#FFFFFF',
    opacity: 0.9,
    bandOpacity: 0.35,
  },
  dateCard: {
    enabled: false,
    eyebrow: 'view of today',
    weekday: 'SUN',
    day: '22',
    monthYear: 'NOV 2026',
    x: 0.5,
    y: 0.3,
    scale: 1,
    rotation: 0,
  },
  placeCard: {
    enabled: false,
    title: '교토 여행',
    rating: 4.5,
    reviews: '63,602',
    duration: '1시간 35분',
    status: '영업 중 · 오후 10:00에 영업 종로',
    x: 0.5,
    y: 0.74,
    scale: 1,
    accent: '#2BB7A8',
  },
};

/** 사진 스티커 기본값 */
export const STICKER_FRAMES: { id: ImageSticker['frame']; name: string; hint: string }[] = [
  { id: 'dashed', name: '점선 흰 테두리', hint: '레퍼런스의 점선 박스' },
  { id: 'polaroid', name: '폴라로이드', hint: '흰 종이 프레임' },
  { id: 'rounded', name: '둥근 모서리', hint: '부드러운 라운드' },
  { id: 'none', name: '테두리 없음', hint: '사진만' },
];

export const STICKER_WIDTHS = { min: 0.12, max: 0.72 } as const;

export function newSticker(
  id: string,
  name: string,
  src: string,
  index = 0,
): ImageSticker {
  // 여러 장이면 서로 겹치지 않게 계단식으로 놓는다.
  const offset = (index % 3) * 0.1;
  return {
    id,
    name,
    src,
    x: 0.27 + offset,
    y: 0.27 + offset,
    width: 0.3,
    rotation: index % 2 === 0 ? -3 : 3,
    frame: 'dashed',
    frameColor: '#FFFFFF',
    opacity: 1,
    start: null,
    end: null,
    enabled: true,
  };
}

export function buildSpec(
  trim: { start: number; end: number },
  aspect: EditSpec['aspect'],
  subtitles: SubtitleState,
  masks: MaskState,
  hook: HookTitle,
  stickers: ImageSticker[] = [],
  overlays: OverlayState = DEFAULT_OVERLAYS,
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
    stickers,
    overlays,
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
