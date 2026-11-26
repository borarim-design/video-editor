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
export type Aspect = 'original' | '9:16' | '1:1' | '16:9' | '4:5';
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

export type HookPreset = 'reviewming' | 'vlog' | 'blackbox' | 'badge' | 'plain';

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
}

export interface SubtitleState {
  enabled: boolean;
  cues: Cue[];
  style: SubtitleStyle;
}

export interface EditSpec {
  trim: { start: number; end: number };
  aspect: Aspect;
  subtitles: { enabled: boolean; cues: Cue[]; style: SubtitleStyle };
  hook: HookTitle;
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

export interface TranscribeResult {
  cues: Cue[];
  segments: unknown[];
  language: string | null;
  trimStart: number;
}
