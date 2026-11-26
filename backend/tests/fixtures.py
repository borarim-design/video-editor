"""테스트용 영상 생성기 — 움직이는 얼굴 두 개 + 음성/톤.

외부 파일을 쓰지 않고 OpenCV 도형으로 '얼굴처럼 생긴' 패턴을 그린다.
Haar 캐스케이드가 이 패턴을 실제로 검출하는지도 테스트에서 확인한다.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Optional, Tuple

import cv2
import numpy as np

from app.config import FFMPEG

W, H = 640, 360
FPS = 24
DURATION = 5.0


def _draw_face(img: np.ndarray, cx: float, cy: float, scale: float,
               skin: Tuple[int, int, int]) -> None:
    """BGR 이미지 위에 단순화한 얼굴을 그린다."""
    w = int(96 * scale)
    h = int(120 * scale)
    cx, cy = int(cx), int(cy)
    cv2.ellipse(img, (cx, cy), (w // 2, h // 2), 0, 0, 360, skin, -1, cv2.LINE_AA)
    eye_dx = int(w * 0.22)
    eye_y = cy - int(h * 0.10)
    for sx in (-eye_dx, eye_dx):
        cv2.ellipse(img, (cx + sx, eye_y), (int(w * 0.11), int(h * 0.07)), 0, 0, 360,
                    (250, 250, 250), -1, cv2.LINE_AA)
        cv2.circle(img, (cx + sx, eye_y), max(2, int(w * 0.045)), (40, 30, 25), -1, cv2.LINE_AA)
    # 눈썹
    cv2.line(img, (cx - eye_dx - int(w * 0.12), eye_y - int(h * 0.10)),
             (cx - eye_dx + int(w * 0.12), eye_y - int(h * 0.12)), (60, 45, 40),
             max(2, int(w * 0.05)), cv2.LINE_AA)
    cv2.line(img, (cx + eye_dx - int(w * 0.12), eye_y - int(h * 0.12)),
             (cx + eye_dx + int(w * 0.12), eye_y - int(h * 0.10)), (60, 45, 40),
             max(2, int(w * 0.05)), cv2.LINE_AA)
    # 코
    cv2.line(img, (cx, cy - int(h * 0.02)), (cx, cy + int(h * 0.14)),
             (int(skin[0] * 0.82), int(skin[1] * 0.82), int(skin[2] * 0.82)),
             max(2, int(w * 0.03)), cv2.LINE_AA)
    # 입
    cv2.ellipse(img, (cx, cy + int(h * 0.26)), (int(w * 0.20), int(h * 0.08)), 0, 10, 170,
                (120, 70, 90), max(2, int(w * 0.05)), cv2.LINE_AA)


def _frame(t: float) -> np.ndarray:
    img = np.full((H, W, 3), (28, 34, 44), np.uint8)
    # 배경 그라데이션 + 움직이는 사각형(수동 모자이크 테스트용)
    for y in range(0, H, 4):
        img[y:y + 4, :, 0] = np.clip(28 + y // 12, 0, 255)
    cv2.rectangle(img, (int(20 + (t * 60) % (W - 80)), 300), (110, 340), (60, 160, 220), -1)

    p = t / DURATION
    f1x = W * (0.22 + 0.45 * p)
    f1y = H * (0.45 + 0.10 * np.sin(p * 6.2))
    _draw_face(img, f1x, f1y, 1.0, (150, 178, 224))

    f2x = W * (0.72 - 0.06 * np.sin(p * 4.0))
    f2y = H * (0.42 + 0.05 * np.cos(p * 3.1))
    _draw_face(img, f2x, f2y, 1.15, (140, 165, 214))
    return img


def make_video(path: Path, audio: Optional[Path] = None,
               duration: float = DURATION, fps: int = FPS) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".raw.mp4")
    cmd = [
        FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(fps), "-i", "-",
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", str(tmp),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    assert proc.stdin is not None
    total = int(duration * fps)
    for i in range(total):
        proc.stdin.write(_frame(i / fps).tobytes())
    proc.stdin.close()
    err = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
    if proc.wait() != 0:
        raise RuntimeError(f"테스트 영상 생성 실패: {err[-500:]}")

    if audio is not None and audio.is_file():
        mux = [
            FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(tmp), "-i", str(audio),
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", str(path),
        ]
        proc = subprocess.run(mux, capture_output=True)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.decode("utf-8", "replace")[-500:])
        tmp.unlink(missing_ok=True)
    else:
        tmp.replace(path)
    return path


def make_audio(path: Path, kind: str = "tone", text: Optional[str] = None) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if kind == "speech" and text:
        try:
            from gtts import gTTS

            gTTS(text=text, lang="ko").save(str(path))
            if path.is_file() and path.stat().st_size > 1000:
                return path
        except Exception:
            pass
    cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
           "-f", "lavfi", "-i", f"sine=frequency=440:duration={DURATION}",
           "-c:a", "libmp3lame", "-b:a", "96k", str(path)]
    subprocess.run(cmd, capture_output=True)
    return path


if __name__ == "__main__":  # 수동 확인용
    import sys

    out = Path(sys.argv[1] if len(sys.argv) > 1 else "test.mp4")
    make_video(out, make_audio(out.with_suffix(".mp3")))
    print(out, out.stat().st_size)
