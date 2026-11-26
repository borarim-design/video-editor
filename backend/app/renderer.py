"""최종 MP4 렌더링.

프레임을 OpenCV로 읽어 (1) 비율 크롭 (2) 추적/수동 모자이크·블러
(3) 자막 합성 후 ffmpeg 파이프로 인코딩한다. 오디오는 트림 구간만 잘라 붙인다.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image

from . import tracking as T
from .media import VideoWriter, extract_audio, output_geometry
from .models import RenderSpec
from .hook_draw import HookRenderer
from .subtitle_draw import SubtitleRenderer

logger = logging.getLogger("video-editor.render")

Progress = Callable[[float, str], None]


# ---------------------------------------------------------------- 마스크 효과
def blur_sigma(strength: float, w: float, h: float) -> float:
    s = max(1.0, min(100.0, strength)) / 100.0
    base = max(1.0, min(w, h))
    return (0.5 + 20.0 * s) * max(1.0, base / 120.0)


def pixel_block(strength: float, w: float, h: float) -> int:
    s = max(1.0, min(100.0, strength)) / 100.0
    base = max(1.0, min(w, h))
    return max(2, int(round((0.01 + 0.10 * s) * base)))


def _mask_shape(w: int, h: int, shape: str) -> np.ndarray:
    mask = np.zeros((h, w), dtype=np.uint8)
    if shape == "rect":
        mask[:, :] = 255
    elif shape == "circle":
        d = min(w, h)
        cv2.circle(mask, (w // 2, h // 2), d // 2, 255, -1)
    else:  # ellipse
        cv2.ellipse(mask, (w // 2, h // 2), (max(1, w // 2), max(1, h // 2)), 0, 0, 360, 255, -1)
    if shape != "rect":
        # 경계 페더링(부드러운 가장자리)
        k = max(3, int(min(w, h) * 0.08) | 1)
        mask = cv2.GaussianBlur(mask, (k, k), 0)
    return mask


def apply_mosaic(frame: np.ndarray, box: Tuple[int, int, int, int], mode: str,
                 strength: float, shape: str) -> None:
    """frame(BGR) 의 box 영역에 블러 또는 픽셀 모자이크를 제자리 적용."""
    H, W = frame.shape[:2]
    x, y, w, h = box
    x = max(0, min(W - 1, x))
    y = max(0, min(H - 1, y))
    w = max(2, min(W - x, w))
    h = max(2, min(H - y, h))
    roi = frame[y:y + h, x:x + w]
    if roi.size == 0:
        return

    if mode == "pixelate":
        block = pixel_block(strength, w, h)
        small = cv2.resize(roi, (max(1, w // block), max(1, h // block)),
                           interpolation=cv2.INTER_LINEAR)
        processed = cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)
    else:
        sigma = blur_sigma(strength, w, h)
        k = int(max(3, round(sigma * 4) | 1))
        processed = cv2.GaussianBlur(roi, (k, k), sigmaX=sigma, sigmaY=sigma)

    mask = _mask_shape(w, h, shape)
    if shape == "rect":
        roi[:, :] = processed
    else:
        alpha = (mask.astype(np.float32) / 255.0)[..., None]
        roi[:, :] = (processed.astype(np.float32) * alpha + roi.astype(np.float32) * (1 - alpha)).astype(np.uint8)


# ---------------------------------------------------------------- 렌더러
@dataclass
class RenderResult:
    path: Path
    width: int
    height: int
    frames: int
    fps: float
    duration: float
    elapsed: float
    has_audio: bool

    def to_dict(self) -> dict:
        return {
            "width": self.width,
            "height": self.height,
            "frames": self.frames,
            "fps": round(self.fps, 3),
            "duration": round(self.duration, 3),
            "elapsedSec": round(self.elapsed, 2),
            "hasAudio": self.has_audio,
            "sizeBytes": self.path.stat().st_size if self.path.is_file() else 0,
        }


def _manual_boxes(spec: RenderSpec, t_out: float, crop_x: int, crop_y: int,
                  out_w: int, out_h: int, src_w: int, src_h: int) -> List[Tuple[Tuple[int, int, int, int], str, float, str]]:
    out = []
    for m in spec.masks.manual:
        if m.start is not None and t_out < m.start - 1e-6:
            continue
        if m.end is not None and t_out > m.end + 1e-6:
            continue
        x = m.x * src_w - crop_x
        y = m.y * src_h - crop_y
        w = m.w * src_w
        h = m.h * src_h
        if w < 2 or h < 2:
            continue
        mode = m.mode or spec.masks.mode
        shape = m.shape or spec.masks.shape
        strength = m.strength if m.strength is not None else spec.masks.strength
        out.append(((int(round(x)), int(round(y)), int(round(w)), int(round(h))),
                    mode, strength, shape))
    return out


def render(project, spec: RenderSpec, tracks: List[dict], out_path: Path,
           progress: Optional[Progress] = None) -> RenderResult:
    started = time.time()
    info = project.info
    trim_start = max(0.0, min(spec.trim.start, info.duration - 0.05))
    trim_end = info.duration if spec.trim.end is None else min(info.duration, spec.trim.end)
    if trim_end - trim_start < 0.05:
        trim_end = min(info.duration - 1e-3, trim_start + 0.05)
    duration = max(0.05, trim_end - trim_start)

    out_w, out_h, crop_x, crop_y = output_geometry(info.width, info.height, spec.aspect)
    fps = min(info.fps, 30.0) if info.fps > 30.0 else info.fps
    total_frames = max(1, int(round(duration * fps)))

    work = out_path.parent
    audio_path = None
    if info.has_audio:
        audio_path = extract_audio(project.path, work / "audio.m4a", trim_start, duration)

    subtitle_renderer = None
    cues = [c for c in spec.subtitles.cues if c.text.strip()]
    if spec.subtitles.enabled and cues:
        subtitle_renderer = SubtitleRenderer(spec.subtitles.style)

    hook_renderer = None
    if spec.hook.enabled:
        hook_renderer = HookRenderer(spec.hook)

    # 어떤 트랙을 가릴지 (명시된 인물만 켠다 — 프론트엔드는 감지된 인물 전체를 보낸다)
    enabled_tracks: Dict[int, bool] = {int(t.id): bool(t.enabled) for t in spec.masks.tracks}
    track_frames: Dict[int, list] = {}
    if spec.masks.enabled:
        for tr in tracks:
            tid = int(tr["id"])
            if enabled_tracks.get(tid, False):
                track_frames[tid] = [(k["t"], (k["x"], k["y"], k["w"], k["h"])) for k in tr["keyframes"]]

    canvas = Image.new("RGB", (out_w, out_h))
    writer = VideoWriter(out_path, out_w, out_h, fps, audio_path)
    cap = cv2.VideoCapture(str(project.path))
    if not cap.isOpened():
        raise RuntimeError("영상을 열 수 없습니다.")

    start_frame = int(round(trim_start * info.fps))
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    written = 0
    try:
        while written < total_frames:
            ok, frame = cap.read()
            if not ok:
                break
            t_out = written / fps
            t_src = trim_start + t_out

            crop = frame[crop_y:crop_y + out_h, crop_x:crop_x + out_w]
            if crop.shape[1] != out_w or crop.shape[0] != out_h:
                crop = cv2.resize(crop, (out_w, out_h), interpolation=cv2.INTER_AREA)

            if spec.masks.enabled:
                pad = spec.masks.pad
                for tid, frames in track_frames.items():
                    box = T.box_at_frames(frames, t_src)
                    if box is None:
                        continue
                    x = box[0] * info.width - crop_x
                    y = box[1] * info.height - crop_y
                    w = box[2] * info.width
                    h = box[3] * info.height
                    ex, ey = w * pad, h * pad
                    apply_mosaic(
                        crop,
                        (int(round(x - ex)), int(round(y - ey)),
                         int(round(w + ex * 2)), int(round(h + ey * 2))),
                        spec.masks.mode, spec.masks.strength, spec.masks.shape,
                    )
                for box, mode, strength, shape in _manual_boxes(
                        spec, t_src, crop_x, crop_y, out_w, out_h, info.width, info.height):
                    apply_mosaic(crop, box, mode, strength, shape)

            canvas = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
            if hook_renderer is not None:
                canvas = hook_renderer.draw(canvas, t_out, duration)
            if subtitle_renderer is not None:
                canvas = subtitle_renderer.draw(canvas, cues, t_out)

            writer.write(np.asarray(canvas))
            written += 1
            if progress and (written % 5 == 0 or written == total_frames):
                progress(min(0.99, written / total_frames),
                         f"렌더링 {written}/{total_frames}프레임")
    finally:
        cap.release()

    writer.close()
    if progress:
        progress(1.0, "렌더링 완료")

    return RenderResult(
        path=out_path, width=out_w, height=out_h, frames=written, fps=fps,
        duration=written / fps if fps else duration, elapsed=time.time() - started,
        has_audio=audio_path is not None,
    )
