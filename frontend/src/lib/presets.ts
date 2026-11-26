import type { Cue, EditSpec, MaskState, SubtitleState, SubtitleStyle } from '../types';

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
): EditSpec {
  return {
    trim: { start: trim.start, end: trim.end },
    aspect,
    subtitles: {
      enabled: subtitles.enabled,
      cues: subtitles.cues,
      style: subtitles.style,
    },
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
