"""FastAPI 진입점.

프론트엔드(빌드된 dist)를 같은 오리진에서 정적 서빙하고,
업로드·얼굴 추적·자동 자막·최종 렌더링 API를 제공한다.
"""

from __future__ import annotations

import logging
import mimetypes
import os
import re
from pathlib import Path

import cv2
from fastapi import Body, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import fonts as font_catalog
from . import tracking as T
from .config import (APP_VERSION, FFMPEG, MAX_DURATION_SEC, PORT, STATIC_DIR,
                     TRACK_SAMPLE_FPS, WHISPER_MODEL, WORK_DIR)
from .models import DetectFacesRequest, RenderSpec, TranscribeRequest
from .renderer import render as render_video
from .store import STORE
from .transcribe import build_cues, transcribe

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("video-editor")

app = FastAPI(title="릴컷 스튜디오 API", version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
)

_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


# ------------------------------------------------------------------ 기본
@app.get("/api/health")
def health() -> dict:
    try:
        import faster_whisper  # noqa: F401

        asr = True
    except Exception:
        asr = False
    return {
        "status": "ok",
        "version": APP_VERSION,
        "ffmpeg": FFMPEG,
        "static": str(STATIC_DIR) if STATIC_DIR else None,
        "asr": {"available": asr, "model": WHISPER_MODEL},
        "fonts": font_catalog.catalog_status(),
        "workDir": str(WORK_DIR),
    }


@app.get("/api/fonts")
def list_fonts() -> dict:
    return {"fonts": font_catalog.list_fonts()}


@app.get("/api/fonts/file/{name}")
def font_file(name: str) -> FileResponse:
    if not name.endswith((".ttf", ".otf")):
        raise HTTPException(404, "폰트 파일이 아닙니다.")
    try:
        path = font_catalog.font_file_by_name(name)
    except FileNotFoundError as exc:
        raise HTTPException(404, "등록되지 않은 폰트입니다.") from exc
    if not path.is_file():
        raise HTTPException(404, "폰트 파일이 없습니다.")
    return FileResponse(
        path,
        media_type="font/ttf",
        headers={"Cache-Control": "public, max-age=31536000, immutable",
                 "Access-Control-Allow-Origin": "*"},
    )


# ------------------------------------------------------------------ 업로드
@app.post("/api/projects")
async def create_project(file: UploadFile = File(...)) -> dict:
    if not file.filename:
        raise HTTPException(400, "파일 이름이 없습니다.")
    suffix = Path(file.filename).suffix.lower()
    if suffix and suffix not in {".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"}:
        raise HTTPException(400, "MP4 / MOV / WebM 영상만 올릴 수 있습니다.")
    try:
        project = STORE.create_project(file.file, file.filename, file.filename)
    except ValueError as exc:
        raise HTTPException(413, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(400, str(exc)) from exc
    if project.info.duration > MAX_DURATION_SEC + 0.5:
        raise HTTPException(
            400, f"영상이 너무 깁니다(최대 {int(MAX_DURATION_SEC / 60)}분)."
        )
    logger.info("업로드 완료 %s (%s, %.1fs)", project.id, project.filename, project.info.duration)
    return {"project": project.to_dict()}


@app.get("/api/projects/{pid}")
def get_project(pid: str) -> dict:
    try:
        project = STORE.get_project(pid)
    except KeyError as exc:
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.") from exc
    return {"project": project.to_dict(), "tracks": project.tracks}


def _file_response_with_range(request: Request, path: Path, media_type: str) -> Response:
    size = path.stat().st_size
    range_header = request.headers.get("range")
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "no-store"}
    if not range_header:
        return FileResponse(path, media_type=media_type, headers=headers)

    match = _RANGE_RE.match(range_header.strip())
    if not match:
        return FileResponse(path, media_type=media_type, headers=headers)
    start_s, end_s = match.group(1), match.group(2)
    start = int(start_s) if start_s else 0
    end = int(end_s) if end_s else size - 1
    start = max(0, min(start, size - 1))
    end = max(start, min(end, size - 1))
    length = end - start + 1

    def iterator():
        with path.open("rb") as fh:
            fh.seek(start)
            remaining = length
            while remaining > 0:
                chunk = fh.read(min(1024 * 512, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    headers.update({
        "Content-Range": f"bytes {start}-{end}/{size}",
        "Content-Length": str(length),
    })
    return StreamingResponse(iterator(), status_code=206, media_type=media_type, headers=headers)


@app.get("/api/projects/{pid}/video")
def project_video(pid: str, request: Request) -> Response:
    try:
        project = STORE.get_project(pid)
    except KeyError as exc:
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.") from exc
    media_type = mimetypes.guess_type(project.path.name)[0] or "video/mp4"
    return _file_response_with_range(request, project.path, media_type)


@app.get("/api/projects/{pid}/thumbnail")
def project_thumbnail(pid: str, t: float = Query(0.0, ge=0.0)) -> Response:
    try:
        project = STORE.get_project(pid)
    except KeyError as exc:
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.") from exc
    cap = cv2.VideoCapture(str(project.path))
    cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t) * 1000.0)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise HTTPException(400, "썸네일을 만들 수 없습니다.")
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    if not ok:
        raise HTTPException(500, "썸네일 인코딩 실패")
    return Response(buf.tobytes(), media_type="image/jpeg")


# ------------------------------------------------------------------ 얼굴 추적
@app.post("/api/projects/{pid}/detect-faces")
def detect_faces(pid: str, body: DetectFacesRequest = Body(default=DetectFacesRequest())) -> dict:
    try:
        project = STORE.get_project(pid)
    except KeyError as exc:
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.") from exc

    job = STORE.new_job("detect-faces", pid)

    def work(j: "object") -> dict:
        tracks = T.analyze(
            project.path, project.info,
            start=body.start if body.start is not None else 0.0,
            end=body.end,
            sample_fps=body.sampleFps or TRACK_SAMPLE_FPS,
            progress=lambda p, m: j.set(p * 0.98, m),  # type: ignore[attr-defined]
        )
        meta = {"sampleFps": body.sampleFps or TRACK_SAMPLE_FPS, "count": len(tracks),
                "analyzedAt": __import__("time").time()}
        STORE.save_tracks(project, tracks, meta)
        return {"tracks": tracks, "meta": meta}

    STORE.run(job, work)
    return {"jobId": job.id}


@app.get("/api/projects/{pid}/tracks")
def get_tracks(pid: str) -> dict:
    try:
        project = STORE.get_project(pid)
    except KeyError as exc:
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.") from exc
    return {"tracks": project.tracks, "meta": project.tracks_meta}


# ------------------------------------------------------------------ 자동 자막
@app.post("/api/projects/{pid}/transcribe")
def transcribe_project(pid: str, body: TranscribeRequest = Body(default=TranscribeRequest())) -> dict:
    try:
        project = STORE.get_project(pid)
    except KeyError as exc:
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.") from exc
    if not project.info.has_audio:
        raise HTTPException(400, "오디오 트랙이 없는 영상입니다. 자막을 직접 추가해 주세요.")

    job = STORE.new_job("transcribe", pid)

    def work(j) -> dict:
        from .media import extract_audio

        start = body.start or 0.0
        end = body.end if body.end is not None else project.info.duration
        wav = project.dir / f"asr-{j.id}.wav"
        if extract_audio(project.path, wav, start, max(0.1, end - start), 16000, True, "pcm_s16le") is None:
            raise RuntimeError("오디오를 추출하지 못했습니다.")
        j.set(0.05, "음성을 준비하는 중…")
        segments = transcribe(wav, body.language, progress=lambda p, m: j.set(p * 0.9, m))
        cues = build_cues(segments, body.maxChars, body.maxWords)
        wav.unlink(missing_ok=True)
        return {"cues": cues, "segments": segments,
                "language": body.language, "trimStart": start}

    STORE.run(job, work)
    return {"jobId": job.id}


# ------------------------------------------------------------------ 렌더링
@app.post("/api/projects/{pid}/render")
def render_project(pid: str, spec: RenderSpec = Body(...)) -> dict:
    try:
        project = STORE.get_project(pid)
    except KeyError as exc:
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.") from exc

    job = STORE.new_job("render", pid)
    out_dir = project.dir / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{job.id}.mp4"

    def work(j) -> dict:
        result = render_video(project, spec, project.tracks, out_path,
                              progress=lambda p, m: j.set(p * 0.98, m))
        payload = result.to_dict()
        payload.update({
            "downloadUrl": f"/api/jobs/{j.id}/download",
            "playUrl": f"/api/jobs/{j.id}/video",
            "fileName": f"{Path(project.filename).stem}-edit.mp4",
        })
        return payload

    STORE.run(job, work)
    return {"jobId": job.id}


@app.get("/api/jobs/{jid}")
def get_job(jid: str) -> dict:
    try:
        job = STORE.get_job(jid)
    except KeyError as exc:
        raise HTTPException(404, "작업을 찾을 수 없습니다.") from exc
    STORE.cleanup()
    return {"job": job.to_dict()}


def _job_output(jid: str) -> Path:
    try:
        job = STORE.get_job(jid)
    except KeyError as exc:
        raise HTTPException(404, "작업을 찾을 수 없습니다.") from exc
    if job.status != "done" or not job.project_id:
        raise HTTPException(409, "아직 결과물이 준비되지 않았습니다.")
    path = WORK_DIR / "projects" / job.project_id / "outputs" / f"{jid}.mp4"
    if not path.is_file():
        raise HTTPException(404, "결과 파일이 없습니다.")
    return path


@app.get("/api/jobs/{jid}/download")
def download_job(jid: str) -> FileResponse:
    path = _job_output(jid)
    job = STORE.get_job(jid)
    name = (job.result or {}).get("fileName") or "edited.mp4"
    return FileResponse(path, media_type="video/mp4", filename=name)


@app.get("/api/jobs/{jid}/video")
def job_video(jid: str, request: Request) -> Response:
    return _file_response_with_range(request, _job_output(jid), "video/mp4")


# ------------------------------------------------------------------ 정적 파일
if STATIC_DIR is not None:
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
else:
    @app.get("/")
    def index_placeholder() -> JSONResponse:
        return JSONResponse({
            "message": "API만 실행 중입니다. frontend에서 npm run build 후 STATIC_DIR을 지정하세요.",
            "docs": "/docs",
        })


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("PORT", str(PORT))), reload=False)
