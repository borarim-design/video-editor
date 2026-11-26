"""ffmpeg·OpenCV 미디어 유틸."""

from __future__ import annotations

import json
import logging
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import cv2

from .config import FFMPEG, MAX_RENDER_WIDTH

logger = logging.getLogger("video-editor.media")

ASPECTS = {
    "original": None,
    "9:16": 9 / 16,
    "1:1": 1 / 1,
    "16:9": 16 / 9,
    "4:5": 4 / 5,
}

_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")
_VIDEO_RE = re.compile(r"Stream #\d+:\d+.*?: Video:.*?, (\d+)x(\d+)")


@dataclass
class MediaInfo:
    width: int
    height: int
    fps: float
    duration: float
    has_audio: bool
    frames: int
    codec: str = ""

    def to_dict(self) -> dict:
        return {
            "width": self.width,
            "height": self.height,
            "fps": round(self.fps, 3),
            "duration": round(self.duration, 3),
            "hasAudio": self.has_audio,
            "frames": self.frames,
            "codec": self.codec,
            "aspect": round(self.width / self.height, 4) if self.height else 0,
        }


def _run(cmd: List[str], timeout: Optional[float] = 600) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)


def ffmpeg_stderr(path: Path) -> str:
    proc = _run([FFMPEG, "-hide_banner", "-i", str(path)], timeout=60)
    return proc.stderr.decode("utf-8", "replace")


def probe(path: Path) -> MediaInfo:
    """영상 메타데이터. OpenCV + ffmpeg stderr 파싱(ffprobe 불필요)."""
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"영상을 열 수 없습니다: {path}")
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()

    if fps <= 0.1 or fps > 240:
        fps = 30.0

    stderr = ffmpeg_stderr(path)
    duration = frames / fps if frames > 0 else 0.0
    m = _DURATION_RE.search(stderr)
    if m:
        h, mi, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
        parsed = h * 3600 + mi * 60 + s
        if parsed > 0:
            duration = parsed
    has_audio = "Audio:" in stderr
    codec = ""
    vm = re.search(r"Video: ([a-zA-Z0-9_\-]+)", stderr)
    if vm:
        codec = vm.group(1)

    if duration <= 0:
        raise RuntimeError("영상 길이를 확인할 수 없습니다.")
    if frames <= 0:
        frames = int(round(duration * fps))

    return MediaInfo(width=width, height=height, fps=fps, duration=duration,
                     has_audio=has_audio, frames=frames, codec=codec)


def _even(value: float) -> int:
    v = int(round(value))
    return v if v % 2 == 0 else v + 1


def output_geometry(width: int, height: int, aspect: str) -> Tuple[int, int, int, int]:
    """출력 크기와 원본에서 잘라낼 영역(center crop)을 돌려준다."""
    ratio = ASPECTS.get(aspect)
    if ratio is None:
        return width, height, 0, 0
    src_ratio = width / height
    if ratio < src_ratio:  # 좌우를 자름
        crop_w = height * ratio
        crop_h = float(height)
    else:  # 위아래를 자름
        crop_w = float(width)
        crop_h = width / ratio
    longest = max(crop_w, crop_h)
    if longest > MAX_RENDER_WIDTH:
        scale = MAX_RENDER_WIDTH / longest
        crop_w *= scale
        crop_h *= scale
    out_w = _even(crop_w)
    out_h = _even(crop_h)
    crop_x = int(round((width - out_w) / 2))
    crop_y = int(round((height - out_h) / 2))
    crop_x = max(0, min(width - out_w, crop_x))
    crop_y = max(0, min(height - out_h, crop_y))
    return out_w, out_h, crop_x, crop_y


def extract_audio(src: Path, dst: Path, start: float, duration: float,
                  sample_rate: int = 44100, mono: bool = False,
                  codec: str = "aac") -> Optional[Path]:
    cmd = [
        FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
        "-ss", f"{max(0.0, start):.3f}", "-t", f"{max(0.05, duration):.3f}",
        "-i", str(src), "-vn", "-ar", str(sample_rate), "-ac", "1" if mono else "2",
    ]
    if codec == "pcm_s16le":
        cmd += ["-c:a", "pcm_s16le"]
    else:
        cmd += ["-c:a", "aac", "-b:a", "160k"]
    cmd.append(str(dst))
    proc = _run(cmd)
    if proc.returncode != 0 or not dst.is_file():
        logger.warning("오디오 추출 실패: %s", proc.stderr.decode("utf-8", "replace")[-500:])
        return None
    return dst


class VideoWriter:
    """raw RGB 프레임을 ffmpeg 로 인코딩한다(오디오는 따로 먹인다)."""

    def __init__(self, out_path: Path, width: int, height: int, fps: float,
                 audio_path: Optional[Path] = None) -> None:
        self.out_path = out_path
        cmd = [
            FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}",
            "-r", f"{fps:.4f}", "-i", "-",
        ]
        if audio_path is not None:
            cmd += ["-i", str(audio_path),
                    "-map", "0:v:0", "-map", "1:a:0",
                    "-c:a", "aac", "-b:a", "160k", "-shortest"]
        else:
            cmd += ["-an"]
        cmd += [
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            str(out_path),
        ]
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        self.width = width
        self.height = height

    def write(self, frame_rgb) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(frame_rgb.tobytes())

    def close(self) -> None:
        assert self.proc.stdin is not None
        try:
            self.proc.stdin.close()
        except BrokenPipeError:
            pass
        err = self.proc.stderr.read().decode("utf-8", "replace") if self.proc.stderr else ""
        code = self.proc.wait()
        if code != 0:
            raise RuntimeError(f"인코딩 실패(code={code}): {err[-800:]}")

    def abort(self) -> None:
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
        except Exception:
            pass
        self.proc.kill()


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))
