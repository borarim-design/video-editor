"""환경 설정과 경로 해석.

로컬 개발, Docker, Google Cloud Run 어디서든 같은 코드가 돌아가도록
경로·포트·모델 설정을 한 곳에서 읽는다.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional

APP_VERSION = "1.0.0"

BASE_DIR = Path(__file__).resolve().parent


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------- 경로
# 폰트는 저장소에 들어 있으므로(backend/fonts) 어떤 환경에서도
# 프론트엔드 미리보기와 최종 렌더링이 완전히 같은 파일을 쓴다.
FONT_DIR = Path(os.getenv("FONT_DIR") or (BASE_DIR.parent / "fonts"))
VENDOR_DIR = BASE_DIR / "vendor"

WORK_DIR = Path(os.getenv("WORK_DIR") or (Path(tempfile.gettempdir()) / "video-editor"))
WORK_DIR.mkdir(parents=True, exist_ok=True)

# 빌드된 프론트엔드(dist) 위치. STATIC_DIR이 없으면 로컬/컨테이너 순서로 찾는다.
def resolve_static_dir() -> Optional[Path]:
    configured = os.getenv("STATIC_DIR")
    candidates = (
        [Path(configured)]
        if configured
        else [BASE_DIR.parents[1] / "frontend" / "dist", Path("/app/static")]
    )
    for candidate in candidates:
        if (candidate / "index.html").is_file():
            return candidate.resolve()
    return None


STATIC_DIR = resolve_static_dir()

# ---------------------------------------------------------------- ffmpeg
def resolve_ffmpeg() -> str:
    """시스템 ffmpeg → imageio-ffmpeg 번들 바이너리 순으로 찾는다."""
    env = os.getenv("FFMPEG_BINARY")
    if env and Path(env).is_file():
        return env
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover - ffmpeg가 아예 없는 환경
        raise RuntimeError(
            "ffmpeg를 찾을 수 없습니다. 시스템 ffmpeg를 설치하거나 imageio-ffmpeg를 설치하세요."
        ) from exc


FFMPEG = resolve_ffmpeg()

# ---------------------------------------------------------------- 한도·기본값
PORT = _env_int("PORT", 8080)
MAX_UPLOAD_MB = _env_int("MAX_UPLOAD_MB", 250)
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
MAX_DURATION_SEC = _env_float("MAX_DURATION_SEC", 300.0)
JOB_TTL_MINUTES = _env_int("JOB_TTL_MINUTES", 180)
OUTPUT_FPS_CAP = _env_float("OUTPUT_FPS_CAP", 30.0)
MAX_RENDER_WIDTH = _env_int("MAX_RENDER_WIDTH", 1920)

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE = os.getenv("WHISPER_COMPUTE", "int8")
WHISPER_MODEL_DIR = os.getenv("WHISPER_MODEL_DIR") or str(WORK_DIR / "models")

# 자동 얼굴 추적 샘플링 기본값(초당 프레임 수)
TRACK_SAMPLE_FPS = _env_float("TRACK_SAMPLE_FPS", 6.0)
# Haar 검출이 실패한 프레임에서 피부색 후보 영역으로 보완할지
SKIN_FALLBACK = os.getenv("SKIN_FALLBACK", "1") not in {"0", "false", "False"}
UPLOAD_EXTENSIONS = {".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"}
