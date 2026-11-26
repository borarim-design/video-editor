"""편집 요청(스펙) 스키마와 자막 스타일 기본값.

프론트엔드 `src/types.ts` 와 같은 필드 이름을 쓴다.
"""

from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

Aspect = Literal["original", "9:16", "1:1", "16:9", "4:5"]
Preset = Literal["highlight", "bounce", "box", "outline", "jiggle", "plain"]
MaskMode = Literal["blur", "pixelate"]
MaskShape = Literal["rect", "ellipse", "circle"]


class Word(BaseModel):
    text: str
    start: float
    end: float
    probability: Optional[float] = None


class Cue(BaseModel):
    id: str
    start: float
    end: float
    text: str
    words: List[Word] = Field(default_factory=list)


class SubtitleStyle(BaseModel):
    preset: Preset = "highlight"
    font: str = "pretendard"
    weight: str = "bold"
    fontSize: float = 7.0  # 캔버스 높이 대비 %
    lineHeight: float = 1.28
    maxWidthPct: float = 84.0
    yPercent: float = 78.0  # 자막 블록 중심의 세로 위치 %
    color: str = "#FFFFFF"
    accent: str = "#FFE14D"
    strokeColor: str = "#000000"
    strokeWidth: float = 0.10  # fontPx 대비 비율
    boxColor: str = "#000000"
    boxOpacity: float = 0.0
    boxRadius: float = 0.35
    boxPadX: float = 0.45
    boxPadY: float = 0.26
    shadow: float = 0.10  # fontPx 대비 오프셋
    wobble: float = 0.0  # 0~100 지글지글 강도
    highlightScale: float = 1.12
    letterSpacing: float = 0.0  # em


class SubtitleTrack(BaseModel):
    enabled: bool = True
    cues: List[Cue] = Field(default_factory=list)
    style: SubtitleStyle = Field(default_factory=SubtitleStyle)


class ManualMask(BaseModel):
    id: str
    x: float  # 원본 프레임 기준 0~1
    y: float
    w: float
    h: float
    start: float = 0.0
    end: Optional[float] = None
    mode: Optional[MaskMode] = None
    shape: Optional[MaskShape] = None
    strength: Optional[float] = None


class TrackToggle(BaseModel):
    id: int
    enabled: bool = True


class MaskSpec(BaseModel):
    enabled: bool = True
    mode: MaskMode = "blur"
    shape: MaskShape = "rect"
    strength: float = 60.0  # 1~100
    pad: float = 0.18  # 얼굴 박스 여백 비율
    shapeSmooth: float = 1.0
    tracks: List[TrackToggle] = Field(default_factory=list)
    manual: List[ManualMask] = Field(default_factory=list)


class Trim(BaseModel):
    start: float = 0.0
    end: Optional[float] = None


class RenderSpec(BaseModel):
    trim: Trim = Field(default_factory=Trim)
    aspect: Aspect = "original"
    subtitles: SubtitleTrack = Field(default_factory=SubtitleTrack)
    masks: MaskSpec = Field(default_factory=MaskSpec)


class DetectFacesRequest(BaseModel):
    sampleFps: float = 6.0
    start: Optional[float] = None
    end: Optional[float] = None


class TranscribeRequest(BaseModel):
    language: Optional[str] = "ko"
    start: Optional[float] = None
    end: Optional[float] = None
    maxChars: int = 16
    maxWords: int = 6


class JobInfo(BaseModel):
    id: str
    kind: str
    status: Literal["queued", "running", "done", "error", "canceled"] = "queued"
    progress: float = 0.0
    message: str = ""
    result: Optional[Dict] = None
    error: Optional[str] = None
    createdAt: float = 0.0
    updatedAt: float = 0.0
