"""업로드 프로젝트·작업(Job) 저장소."""

from __future__ import annotations

import json
import logging
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional

from .config import JOB_TTL_MINUTES, MAX_UPLOAD_BYTES, WORK_DIR
from .media import MediaInfo, probe

logger = logging.getLogger("video-editor.store")

PROJECTS_DIR = WORK_DIR / "projects"
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class Project:
    id: str
    filename: str
    path: Path
    info: MediaInfo
    created_at: float = field(default_factory=time.time)
    tracks: List[dict] = field(default_factory=list)
    tracks_meta: dict = field(default_factory=dict)

    @property
    def dir(self) -> Path:
        return self.path.parent

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "filename": self.filename,
            "sizeBytes": self.path.stat().st_size if self.path.is_file() else 0,
            "createdAt": self.created_at,
            **self.info.to_dict(),
        }


@dataclass
class Job:
    id: str
    kind: str
    project_id: Optional[str] = None
    status: str = "queued"
    progress: float = 0.0
    message: str = ""
    result: Optional[dict] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def set(self, progress: Optional[float] = None, message: Optional[str] = None) -> None:
        if progress is not None:
            self.progress = max(0.0, min(1.0, float(progress)))
        if message is not None:
            self.message = message
        self.updated_at = time.time()

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "projectId": self.project_id,
            "status": self.status,
            "progress": round(self.progress, 4),
            "message": self.message,
            "result": self.result,
            "error": self.error,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }


class Store:
    def __init__(self, workers: int = 2) -> None:
        self.lock = threading.RLock()
        self.projects: Dict[str, Project] = {}
        self.jobs: Dict[str, Job] = {}
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="job")
        self._load_existing()

    # ------------------------------------------------------------ projects
    def _load_existing(self) -> None:
        for meta_path in PROJECTS_DIR.glob("*/meta.json"):
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                source = meta_path.parent / meta["storedName"]
                if not source.is_file():
                    continue
                info = probe(source)
                project = Project(
                    id=meta["id"], filename=meta["filename"], path=source,
                    info=info, created_at=meta.get("createdAt", time.time()),
                )
                tracks_file = meta_path.parent / "tracks.json"
                if tracks_file.is_file():
                    payload = json.loads(tracks_file.read_text(encoding="utf-8"))
                    project.tracks = payload.get("tracks", [])
                    project.tracks_meta = payload.get("meta", {})
                self.projects[project.id] = project
            except Exception as exc:  # pragma: no cover
                logger.warning("프로젝트 복원 실패 %s: %s", meta_path, exc)

    def create_project(self, stream, filename: str, stored_name: str) -> Project:
        pid = uuid.uuid4().hex[:12]
        pdir = PROJECTS_DIR / pid
        pdir.mkdir(parents=True, exist_ok=True)
        suffix = Path(filename).suffix.lower() or ".mp4"
        path = pdir / f"source{suffix}"

        size = 0
        with path.open("wb") as out:
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    out.close()
                    shutil.rmtree(pdir, ignore_errors=True)
                    raise ValueError("업로드 용량 한도를 넘었습니다.")
                out.write(chunk)

        info = probe(path)
        project = Project(id=pid, filename=filename, path=path, info=info)
        self._write_meta(project)
        with self.lock:
            self.projects[pid] = project
        return project

    def _write_meta(self, project: Project) -> None:
        meta = {
            "id": project.id,
            "filename": project.filename,
            "storedName": project.path.name,
            "createdAt": project.created_at,
        }
        (project.dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2),
                                              encoding="utf-8")

    def get_project(self, pid: str) -> Project:
        with self.lock:
            project = self.projects.get(pid)
        if project is None:
            raise KeyError(pid)
        return project

    def save_tracks(self, project: Project, tracks: List[dict], meta: dict) -> None:
        project.tracks = tracks
        project.tracks_meta = meta
        (project.dir / "tracks.json").write_text(
            json.dumps({"tracks": tracks, "meta": meta}, ensure_ascii=False),
            encoding="utf-8",
        )

    # ------------------------------------------------------------ jobs
    def new_job(self, kind: str, project_id: Optional[str] = None) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], kind=kind, project_id=project_id)
        with self.lock:
            self.jobs[job.id] = job
        return job

    def get_job(self, jid: str) -> Job:
        with self.lock:
            job = self.jobs.get(jid)
        if job is None:
            raise KeyError(jid)
        return job

    def run(self, job: Job, fn: Callable[[Job], dict]) -> None:
        def target() -> None:
            job.status = "running"
            job.set(0.01, "시작 중…")
            try:
                result = fn(job)
                job.result = result
                job.status = "done"
                job.set(1.0, "완료")
            except Exception as exc:  # noqa: BLE001
                logger.exception("작업 실패 %s(%s)", job.id, job.kind)
                job.status = "error"
                job.error = str(exc)
                job.set(message=str(exc))

        self.pool.submit(target)

    # ------------------------------------------------------------ cleanup
    def cleanup(self) -> None:
        cutoff = time.time() - JOB_TTL_MINUTES * 60
        with self.lock:
            for jid, job in list(self.jobs.items()):
                if job.updated_at < cutoff and job.status in {"done", "error"}:
                    self.jobs.pop(jid, None)
                    out = PROJECTS_DIR / (job.project_id or "") / "outputs" / f"{jid}.mp4"
                    try:
                        out.unlink(missing_ok=True)
                    except Exception:
                        pass


STORE = Store()
