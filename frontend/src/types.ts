export interface Word {
  text: string;
  start: number;
  end: number;
  probability?: number | null;
}

export interface Cue {
  id: string;
  start: number;
  end: number;
  text: string;
  words: Word[];
}

export type Preset = 'highlight' | 'bounce' | 'box' | 'outline' | 'jiggle' | 'plain';
export type Aspect = 'original' | '9:16' | '1:1' | '16:9' | '4:5' | '3:4';
export type MaskMode = 'blur' | 'pixelate';
export type MaskShape = 'rect' | 'ellipse' | 'circle';

export interface SubtitleStyle {
  preset: Preset;
  font: string;
  weight: string;
  fontSize: number;
  lineHeight: number;
  maxWidthPct: number;
  yPercent: number;
  color: string;
  accent: string;
  strokeColor: string;
  strokeWidth: number;
  boxColor: string;
  boxOpacity: number;
  boxRadius: number;
  boxPadX: number;
  boxPadY: number;
  shadow: number;
  wobble: number;
  highlightScale: number;
  letterSpacing: number;
}

export interface ProjectMeta {
  id: string;
  filename: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  hasAudio: boolean;
  frames: number;
  sizeBytes?: number;
  /** 브라우저에서 만든 객체 URL(blob:) — 서버 없이 로컬 파일을 재생한다. */
  srcUrl: string;
}

/**
 * 타임라인에 순서대로 이어 붙이는 영상 클립 하나.
 * `url` 은 blob: 객체 URL 이고, trimStart~trimEnd 구간만 편집본에 쓰인다.
 */
export interface VideoClip {
  id: string;
  url: string;
  name: string;
  /** 원본 파일 전체 길이(초) */
  duration: number;
  width: number;
  height: number;
  /** 원본 안에서 쓰기 시작하는 지점(초) */
  trimStart: number;
  /** 원본 안에서 쓰기를 끝내는 지점(초) */
  trimEnd: number;
  hasAudio: boolean;
  fps: number;
  sizeBytes?: number;
}

export interface TrackKeyframe {
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PersonTrack {
  id: number;
  label: string;
  source: string;
  start: number;
  end: number;
  hits: number;
  samples: number;
  coverage: number;
  keyframes: TrackKeyframe[];
}

export interface ManualMask {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  start: number;
  end: number;
  mode?: MaskMode | null;
  shape?: MaskShape | null;
  strength?: number | null;
}

export interface TrackToggle {
  id: number;
  enabled: boolean;
}

export interface MaskState {
  enabled: boolean;
  mode: MaskMode;
  shape: MaskShape;
  strength: number;
  pad: number;
  tracks: TrackToggle[];
  manual: ManualMask[];
}

export interface SpeedLines {
  enabled: boolean;
  color: string;
  opacity: number;
  count: number;
  innerRadius: number;
  seed: number;
}

export type HookPreset =
  | 'reviewming'
  | 'vlog'
  | 'blackbox'
  | 'badge'
  | 'pastel-bars'
  | 'color-outline-badge'
  | 'torn-paper'
  | 'travel-bracket'
  | 'plain';

/** 줄 배경 바 모양 — 둥근 형광펜 바 / 찢어진 종이 조각 */
export type BarShape = 'rounded' | 'torn';

/**
 * 후킹 타이틀 장식(레퍼런스 템플릿 반영).
 * 캔버스와 내보내기가 같은 값을 보도록 순수 데이터로만 둔다.
 */
export interface HookDecor {
  /** 줄마다 색이 다른 배경 바 */
  bars: boolean;
  barShape: BarShape;
  /** 줄 순서대로 돌려 쓰는 바 색 (#RRGGBB) */
  barColors: string[];
  barOpacity: number;
  barRadius: number;
  barPadX: number;
  barPadY: number;
  /** 마지막 줄을 검정/컬러 라벨 박스로 */
  labelBox: boolean;
  labelBoxColor: string;
  labelBoxTextColor: string;
  /** 종이 바에 옅은 그림자 */
  paperShadow: boolean;
}

/** 릴스 상단 후킹 타이틀(오프닝/고정 헤드라인) */
export interface HookTitle {
  enabled: boolean;
  preset: HookPreset;
  subtext: string;
  title: string;
  start: number | null;
  end: number | null;
  yPercent: number;
  fontSize: number;
  subSize: number;
  color: string;
  accent: string;
  accentLine: number;
  strokeColor: string;
  strokeWidth: number;
  boxColor: string;
  boxOpacity: number;
  boxRadius: number;
  pillColor: string;
  pillOpacity: number;
  subColor: string;
  skew: number;
  font: string;
  weight: string;
  lineHeight: number;
  speedLines: SpeedLines;
  /** 레퍼런스 장식(바·라벨 박스). 없으면 장식 없음으로 본다. */
  decor?: HookDecor;
}

/** 사진 스티커(PiP) 테두리 스타일 */
export type StickerFrame = 'none' | 'dashed' | 'polaroid' | 'rounded';

/** 영상 위에 얹는 추가 이미지 — 위치·크기·회전·테두리 */
export interface ImageSticker {
  id: string;
  name: string;
  /** blob: 또는 data: URL */
  src: string;
  /** 출력 캔버스 기준 중심 좌표(0~1) */
  x: number;
  y: number;
  /** 출력 캔버스 너비 대비 크기(0~1) */
  width: number;
  /** 기울기(도) */
  rotation: number;
  frame: StickerFrame;
  frameColor: string;
  opacity: number;
  /** 표시 구간(편집본 기준 초). null 이면 전체 */
  start: number | null;
  end: number | null;
  enabled: boolean;
}

/** 카메라 뷰파인더 프레임 (Auto · HDR Off + 3×3 그리드 + 셔터) */
export interface ViewfinderOverlay {
  enabled: boolean;
  topLeft: string;
  topRight: string;
  bottomLabels: string;
  color: string;
  opacity: number;
  bandOpacity: number;
}

/** 날짜 스탬프 카드 (view of today / SUN / 22) */
export interface DateCardOverlay {
  enabled: boolean;
  eyebrow: string;
  weekday: string;
  day: string;
  monthYear: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

/** 여행 장소 카드 위젯 (장소명·별점·소요시간) */
export interface PlaceCardOverlay {
  enabled: boolean;
  title: string;
  rating: number;
  reviews: string;
  duration: string;
  status: string;
  x: number;
  y: number;
  scale: number;
  accent: string;
}

export interface OverlayState {
  viewfinder: ViewfinderOverlay;
  dateCard: DateCardOverlay;
  placeCard: PlaceCardOverlay;
}

export interface SubtitleState {
  enabled: boolean;
  cues: Cue[];
  style: SubtitleStyle;
}

/**
 * 오디오 레이어(BGM·효과음). 영상과 별개로 타임라인 위에 얹혀
 * 미리보기와 내보내기에서 원본 영상 소리와 함께 믹싱된다.
 */
export interface AudioLayer {
  id: string;
  name: string;
  /** blob: URL — 기기 안에서만 쓰인다 */
  src: string;
  /** 오디오 파일 전체 길이(초) */
  duration: number;
  /** 편집본(트림 기준) 타임라인에서 재생을 시작하는 초 */
  start: number;
  /** 오디오 파일 안에서 재생을 시작할 지점(초) */
  offset: number;
  /** 타임라인에 놓이는 클립 길이(초) */
  length: number;
  /** 0~1 */
  volume: number;
  muted: boolean;
  enabled: boolean;
}

export interface EditSpec {
  trim: { start: number; end: number };
  aspect: Aspect;
  subtitles: { enabled: boolean; cues: Cue[]; style: SubtitleStyle };
  hook: HookTitle;
  /** 사진 스티커(최대 3장) — 영상·자막 사이에 합성된다 */
  stickers: ImageSticker[];
  /** 뷰파인더·날짜 카드·장소 카드 위젯 */
  overlays: OverlayState;
  masks: {
    enabled: boolean;
    mode: MaskMode;
    shape: MaskShape;
    strength: number;
    pad: number;
    tracks: TrackToggle[];
    manual: ManualMask[];
  };
}

export interface FontFamily {
  id: string;
  name: string;
  category: string;
  description: string;
  sample: string;
  defaultWeight: string;
  weights: string[];
  files: Record<string, string>;
}

export interface Job<T = unknown> {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'canceled';
  progress: number;
  message: string;
  result: T | null;
  error: string | null;
}

export interface RenderResult {
  width: number;
  height: number;
  frames: number;
  fps: number;
  duration: number;
  elapsedSec: number;
  hasAudio: boolean;
  sizeBytes: number;
  downloadUrl: string;
  playUrl: string;
  fileName: string;
}

/** 브라우저(MediaRecorder)에서 바로 만든 결과물 */
export interface ExportResult {
  width: number;
  height: number;
  duration: number;
  elapsedSec: number;
  hasAudio: boolean;
  sizeBytes: number;
  /** blob: 객체 URL — 재생·다운로드 공용 */
  url: string;
  fileName: string;
  mimeType: string;
  extension: 'mp4' | 'webm';
}

export interface TranscribeResult {
  cues: Cue[];
  segments: unknown[];
  language: string | null;
  trimStart: number;
}
