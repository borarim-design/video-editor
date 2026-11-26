"""얼굴 자동 감지·트래킹.

외부 모델 다운로드 없이 동작하도록:
1) 저장소에 포함된 OpenCV Haar 캐스케이드(정면/측면)로 얼굴을 찾고
2) 어려운 프레임은 피부색·움직임 기반 후보 영역으로 보완하며
3) IoU + 중심 이동 최근접 매칭으로 track_id 를 붙이고
4) 표본 사이는 선형 보간한다.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np

from .config import SKIN_FALLBACK, TRACK_SAMPLE_FPS, VENDOR_DIR

logger = logging.getLogger("video-editor.tracking")

Box = Tuple[float, float, float, float]  # x, y, w, h (정규화 0~1)


@dataclass
class Track:
    id: int
    keyframes: List[Tuple[float, Box]] = field(default_factory=list)
    hits: int = 0
    samples: int = 0
    source: str = "haar"
    last_seen: float = 0.0

    def add(self, t: float, box: Box) -> None:
        self.keyframes.append((t, box))
        self.hits += 1
        self.last_seen = t

    def box_at(self, t: float) -> Optional[Box]:
        kf = self.keyframes
        if not kf:
            return None
        if t <= kf[0][0]:
            return kf[0][1]
        if t >= kf[-1][0]:
            return kf[-1][1]
        for i in range(1, len(kf)):
            t1, b1 = kf[i]
            if t <= t1:
                t0, b0 = kf[i - 1]
                span = max(1e-6, t1 - t0)
                p = (t - t0) / span
                return tuple(b0[k] + (b1[k] - b0[k]) * p for k in range(4))  # type: ignore[return-value]
        return kf[-1][1]

    def to_dict(self) -> dict:
        start = self.keyframes[0][0] if self.keyframes else 0.0
        end = self.keyframes[-1][0] if self.keyframes else 0.0
        return {
            "id": self.id,
            "label": f"인물 {self.id}",
            "source": self.source,
            "start": round(start, 3),
            "end": round(end, 3),
            "hits": self.hits,
            "samples": self.samples,
            "coverage": round(self.hits / max(1, self.samples), 3),
            "keyframes": [
                {"t": round(float(t), 4), "x": round(float(b[0]), 5), "y": round(float(b[1]), 5),
                 "w": round(float(b[2]), 5), "h": round(float(b[3]), 5)}
                for t, b in self.keyframes
            ],
        }


def _iou(a: Box, b: Box) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1 = max(ax, bx)
    y1 = max(ay, by)
    x2 = min(ax + aw, bx + bw)
    y2 = min(ay + ah, by + bh)
    iw = max(0.0, x2 - x1)
    ih = max(0.0, y2 - y1)
    inter = iw * ih
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def _center(b: Box) -> Tuple[float, float]:
    return (b[0] + b[2] / 2.0, b[1] + b[3] / 2.0)


class FaceDetector:
    def __init__(self) -> None:
        self.cascades = []
        for name in ("haarcascade_frontalface_default.xml",
                     "haarcascade_frontalface_alt2.xml",
                     "haarcascade_profileface.xml"):
            path = VENDOR_DIR / name
            if path.is_file():
                cas = cv2.CascadeClassifier(str(path))
                if not cas.empty():
                    self.cascades.append((name, cas))
        if not self.cascades:
            raise RuntimeError("Haar 캐스케이드 파일을 찾을 수 없습니다(backend/app/vendor).")

    def detect(self, frame_bgr: np.ndarray) -> List[Box]:
        h, w = frame_bgr.shape[:2]
        # 검출은 640px 폭으로 줄여 속도를 확보한다.
        scale = 640.0 / w if w > 640 else 1.0
        small = cv2.resize(frame_bgr, (int(w * scale), int(h * scale))) if scale < 1.0 else frame_bgr
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)
        boxes: List[Box] = []
        for _name, cas in self.cascades:
            found = cas.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=5,
                                         minSize=(int(36 * scale), int(36 * scale)))
            for (x, y, bw, bh) in found:
                boxes.append((x / (w * scale), y / (h * scale),
                              bw / (w * scale), bh / (h * scale)))
        if not boxes and SKIN_FALLBACK:
            boxes = self._skin_candidates(frame_bgr)
        return _merge_boxes(boxes)

    def _skin_candidates(self, frame_bgr: np.ndarray) -> List[Box]:
        h, w = frame_bgr.shape[:2]
        ycrcb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2YCrCb)
        mask = cv2.inRange(ycrcb, (0, 133, 77), (255, 173, 127))
        kernel = np.ones((11, 11), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        out: List[Box] = []
        for c in sorted(contours, key=cv2.contourArea, reverse=True)[:3]:
            area = cv2.contourArea(c)
            if area < h * w * 0.004:
                continue
            x, y, bw, bh = cv2.boundingRect(c)
            aspect = bw / max(1, bh)
            if not 0.45 <= aspect <= 1.9:
                continue
            out.append((x / w, y / h, bw / w, bh / h))
        return out


def _merge_boxes(boxes: List[Box], iou_threshold: float = 0.45) -> List[Box]:
    result: List[Box] = []
    for box in sorted(boxes, key=lambda b: b[2] * b[3], reverse=True):
        if all(_iou(box, kept) < iou_threshold for kept in result):
            result.append(box)
    return result


def _smooth(track: Track, radius: int = 2) -> None:
    if len(track.keyframes) < 3:
        return
    smoothed: List[Tuple[float, Box]] = []
    for i, (t, box) in enumerate(track.keyframes):
        lo = max(0, i - radius)
        hi = min(len(track.keyframes), i + radius + 1)
        neigh = [b for _t, b in track.keyframes[lo:hi]]
        avg = tuple(sum(n[k] for n in neigh) / len(neigh) for k in range(4))
        smoothed.append((t, avg))  # type: ignore[arg-type]
    track.keyframes = smoothed


def analyze(
    video_path: Path,
    info,
    start: float = 0.0,
    end: Optional[float] = None,
    sample_fps: float = TRACK_SAMPLE_FPS,
    progress: Optional[Callable[[float, str], None]] = None,
) -> List[dict]:
    """영상에서 인물별 track_id 와 프레임별 박스를 만든다."""
    end = min(info.duration, end if end is not None else info.duration)
    if end <= start:
        raise ValueError("분석 구간이 비어 있습니다.")
    sample_fps = max(1.0, min(15.0, sample_fps))
    duration = end - start
    total_samples = max(1, int(math.ceil(duration * sample_fps)))

    detector = FaceDetector()
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError("영상을 열 수 없습니다.")

    # 트래킹 파라미터 (정규화 좌표 기준)
    iou_gate = 0.2
    dist_gate = 0.55
    max_age = 0.9  # 초

    tracks: List[Track] = []
    active: List[Track] = []
    next_id = 1
    frame_idx = 0
    processed = 0
    next_sample_t = start
    step = 1.0 / sample_fps

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = frame_idx / info.fps
        frame_idx += 1
        if t < start - 1e-6:
            continue
        if t > end + 1e-6:
            break
        if t + 1e-6 < next_sample_t:
            continue

        processed += 1
        next_sample_t = start + processed * step
        rel = t - start

        # 잠정 트랙 만료
        active = [tr for tr in active if rel - tr.last_seen <= max_age]

        dets = detector.detect(frame)
        used: set = set()

        for tr in active:
            last = tr.keyframes[-1][1]
            best_i, best_score = -1, -1.0
            for i, det in enumerate(dets):
                if i in used:
                    continue
                iou = _iou(last, det)
                c0, c1 = _center(last), _center(det)
                dist = math.hypot(c0[0] - c1[0], c0[1] - c1[1])
                if iou < iou_gate and dist > dist_gate * max(last[2], last[3]):
                    continue
                score = iou + max(0.0, 0.5 - dist)
                if score > best_score:
                    best_score, best_i = score, i
            if best_i >= 0:
                used.add(best_i)
                tr.add(rel, dets[best_i])
            tr.samples += 1

        for i, det in enumerate(dets):
            if i in used:
                continue
            tr = Track(id=next_id)
            next_id += 1
            tr.samples = 1
            tr.add(rel, det)
            tracks.append(tr)
            active.append(tr)

        if progress and processed % 3 == 0:
            progress(min(0.99, processed / total_samples), f"얼굴 분석 {processed}/{total_samples}프레임")

    cap.release()

    min_hits = max(2, int(total_samples * 0.15))
    kept: List[Track] = []
    for tr in tracks:
        if tr.hits < min_hits:
            continue
        span = tr.keyframes[-1][0] - tr.keyframes[0][0]
        if span < 0.3 and len(tracks) > 1:
            continue
        _smooth(tr)
        kept.append(tr)

    kept.sort(key=lambda tr: (-len(tr.keyframes), tr.id))
    for idx, tr in enumerate(kept, start=1):
        tr.id = idx

    if progress:
        progress(1.0, f"인물 {len(kept)}명 추적 완료")
    return [tr.to_dict() for tr in kept]


def tracks_index(tracks: List[dict]) -> Dict[int, List[Tuple[float, Box]]]:
    out: Dict[int, List[Tuple[float, Box]]] = {}
    for tr in tracks:
        frames = [(k["t"], (k["x"], k["y"], k["w"], k["h"])) for k in tr["keyframes"]]
        out[int(tr["id"])] = frames
    return out


def box_at_frames(frames: List[Tuple[float, Box]], t: float) -> Optional[Box]:
    if not frames:
        return None
    if t <= frames[0][0]:
        return frames[0][1]
    if t >= frames[-1][0]:
        return frames[-1][1]
    for i in range(1, len(frames)):
        t1, b1 = frames[i]
        if t <= t1:
            t0, b0 = frames[i - 1]
            p = (t - t0) / max(1e-6, t1 - t0)
            return tuple(b0[k] + (b1[k] - b0[k]) * p for k in range(4))  # type: ignore[return-value]
    return frames[-1][1]
