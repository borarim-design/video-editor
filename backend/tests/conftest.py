"""pytest 공통 설정 — 앱 임포트 전에 작업 폴더를 테스트 전용으로 바꾼다."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # backend/
sys.path.insert(0, str(ROOT))

WORK = Path(os.environ.get("VE_TEST_WORK") or (ROOT / ".pytest-work"))
WORK.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("WORK_DIR", str(WORK))
os.environ.setdefault("TMPDIR", str(WORK / "tmp"))
os.environ.setdefault("WHISPER_MODEL", "tiny")
os.environ.setdefault("WHISPER_MODEL_DIR", str(WORK / "models"))
Path(os.environ["TMPDIR"]).mkdir(parents=True, exist_ok=True)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from tests import fixtures  # noqa: E402

VIDEO = WORK / "fixture.mp4"
AUDIO_TONE = WORK / "tone.mp3"
SPEECH = WORK / "speech.mp3"


@pytest.fixture(scope="session")
def client() -> TestClient:
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def video_path() -> Path:
    if not VIDEO.is_file():
        fixtures.make_audio(AUDIO_TONE, "tone")
        fixtures.make_video(VIDEO, AUDIO_TONE)
    return VIDEO


@pytest.fixture(scope="session")
def uploaded(client: TestClient, video_path: Path) -> dict:
    with video_path.open("rb") as fh:
        resp = client.post("/api/projects", files={"file": (video_path.name, fh, "video/mp4")})
    assert resp.status_code == 200, resp.text
    return resp.json()["project"]


def wait_job(client: TestClient, job_id: str, timeout: float = 600.0) -> dict:
    import time

    deadline = time.time() + timeout
    last = {}
    while time.time() < deadline:
        resp = client.get(f"/api/jobs/{job_id}")
        assert resp.status_code == 200, resp.text
        last = resp.json()["job"]
        if last["status"] in {"done", "error"}:
            return last
        time.sleep(0.3)
    raise AssertionError(f"작업 시간 초과: {job_id} / 마지막 상태 {last}")
