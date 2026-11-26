"""자동 자막 생성 (faster-whisper, 단어 단위 타임스탬프)."""

from __future__ import annotations

import logging
import threading
import wave
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

from .config import WHISPER_COMPUTE, WHISPER_DEVICE, WHISPER_MODEL, WHISPER_MODEL_DIR

logger = logging.getLogger("video-editor.asr")

_lock = threading.Lock()
_models: Dict[str, object] = {}


class TranscriptionUnavailable(RuntimeError):
    pass


def _load_model(size: str):
    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # pragma: no cover
        raise TranscriptionUnavailable(
            "faster-whisper가 설치되어 있지 않습니다. pip install faster-whisper"
        ) from exc
    with _lock:
        model = _models.get(size)
        if model is None:
            logger.info("faster-whisper 모델 로드: %s (%s/%s)", size, WHISPER_DEVICE, WHISPER_COMPUTE)
            model = WhisperModel(
                size,
                device=WHISPER_DEVICE,
                compute_type=WHISPER_COMPUTE,
                download_root=WHISPER_MODEL_DIR,
                cpu_threads=2,
            )
            _models[size] = model
    return model


def load_wav(path: Path, target_sr: int = 16000) -> np.ndarray:
    """16kHz 모노 float32 배열로 읽는다(av 패키지 버전 문제를 피한다)."""
    with wave.open(str(path), "rb") as wf:
        frames = wf.getnframes()
        raw = wf.readframes(frames)
        rate = wf.getframerate()
        channels = wf.getnchannels()
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    if rate != target_sr and audio.size:
        duration = audio.size / float(rate)
        new_len = int(round(duration * target_sr))
        x_old = np.linspace(0.0, duration, num=audio.size, endpoint=False)
        x_new = np.linspace(0.0, duration, num=new_len, endpoint=False)
        audio = np.interp(x_new, x_old, audio).astype(np.float32)
    return audio / 32768.0


def transcribe(audio_path: Path, language: Optional[str] = "ko",
               model_size: Optional[str] = None,
               progress=None) -> List[dict]:
    """WAV 오디오 → 세그먼트(단어 타임스탬프 포함) 목록."""
    model = _load_model(model_size or WHISPER_MODEL)
    if progress:
        progress(0.1, "음성을 인식하는 중…")
    audio = load_wav(Path(audio_path))
    segments, info = model.transcribe(
        audio,
        language=language or None,
        word_timestamps=True,
        vad_filter=True,
        beam_size=3,
        condition_on_previous_text=False,
    )
    total = float(getattr(info, "duration", 0.0) or 0.0)
    out: List[dict] = []
    for seg in segments:
        words = []
        for w in (seg.words or []):
            words.append({
                "text": (w.word or "").strip(),
                "start": round(float(w.start), 3),
                "end": round(float(w.end), 3),
                "probability": round(float(getattr(w, "probability", 0.0) or 0.0), 3),
            })
        out.append({
            "start": round(float(seg.start), 3),
            "end": round(float(seg.end), 3),
            "text": (seg.text or "").strip(),
            "words": [w for w in words if w["text"]],
        })
        if progress and total > 0:
            progress(min(0.95, 0.15 + 0.8 * float(seg.end) / total), "음성을 인식하는 중…")
    if progress:
        progress(1.0, "자막 생성 완료")
    return out


def build_cues(segments: List[dict], max_chars: int = 16, max_words: int = 6,
               gap: float = 0.55, start_offset: float = 0.0) -> List[dict]:
    """세그먼트의 단어들을 릴스/숏츠용 짧은 큐로 다시 묶는다."""
    words: List[dict] = []
    for seg in segments:
        words.extend(seg.get("words") or [])

    cues: List[dict] = []
    cur: List[dict] = []
    cur_chars = 0

    def flush() -> None:
        nonlocal cur, cur_chars
        if not cur:
            return
        text = "".join(w["text"] if i == 0 else " " + w["text"] for i, w in enumerate(cur)).strip()
        if text:
            cues.append({
                "id": f"cue-{len(cues) + 1}",
                "start": round(max(0.0, cur[0]["start"] - start_offset), 3),
                "end": round(max(0.0, cur[-1]["end"] - start_offset + 0.12), 3),
                "text": text,
                "words": [
                    {
                        "text": w["text"],
                        "start": round(max(0.0, w["start"] - start_offset), 3),
                        "end": round(max(0.0, w["end"] - start_offset), 3),
                        "probability": w.get("probability"),
                    }
                    for w in cur
                ],
            })
        cur = []
        cur_chars = 0

    for w in words:
        if cur:
            prev = cur[-1]
            if (w["start"] - prev["end"] > gap
                    or len(cur) >= max_words
                    or cur_chars + len(w["text"]) > max_chars):
                flush()
        cur.append(w)
        cur_chars += len(w["text"])

    flush()
    return cues
