"""E2E 테스트: 업로드 → 얼굴 추적 → 모자이크/블러 강도 → 자막 스타일 → 내보내기.

모든 단계는 실제 API를 호출하고 실제 MP4 산출물을 만들어 검사한다.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

from tests.conftest import WORK, wait_job


# ------------------------------------------------------------------ 헬퍼
def frames_of(path: Path, times):
    """주어진 시각의 프레임을 순차 디코딩으로 정확히 꺼낸다(시크 오차 방지)."""
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    targets = {round(float(t), 3): int(round(float(t) * fps)) for t in times}
    last = max(targets.values())
    out = {}
    idx = 0
    while idx <= last:
        ok, frame = cap.read()
        if not ok:
            break
        for t, fi in targets.items():
            if fi == idx:
                out[t] = frame.copy()
        idx += 1
    cap.release()
    return out


def video_info(path: Path):
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 0
    n = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    return {"fps": fps, "frames": n, "width": w, "height": h,
            "duration": n / fps if fps else 0}


def base_spec(**overrides) -> dict:
    spec = {
        "trim": {"start": 0.0, "end": 2.0},
        "aspect": "original",
        "subtitles": {"enabled": False, "cues": [], "style": {"preset": "highlight"}},
        "masks": {"enabled": False},
    }
    spec.update(overrides)
    return spec


def render(client, project_id: str, spec: dict, timeout: float = 600.0) -> dict:
    resp = client.post(f"/api/projects/{project_id}/render", json=spec)
    assert resp.status_code == 200, resp.text
    job = wait_job(client, resp.json()["jobId"], timeout=timeout)
    assert job["status"] == "done", job
    result = job["result"]
    out = WORK / "projects" / project_id / "outputs" / f"{job['id']}.mp4"
    assert out.is_file() and out.stat().st_size > 5000
    result["_path"] = out
    return result


# ------------------------------------------------------------------ 1) 폰트
def test_fonts_catalog_and_files(client):
    resp = client.get("/api/fonts")
    assert resp.status_code == 200
    fonts = resp.json()["fonts"]
    ids = {f["id"] for f in fonts}
    assert len(fonts) >= 10, ids
    # 요청된 장르가 모두 들어 있어야 한다.
    for expected in {"pretendard", "gmarket", "blackhan", "notosans", "nanummyeongjo",
                     "maruburi", "nanumpen", "gaegu", "jua", "galmuri"}:
        assert expected in ids, f"{expected} 폰트 누락"

    from PIL import ImageFont

    for fam in fonts:
        assert fam["files"], fam["id"]
        for weight, url in fam["files"].items():
            r = client.get(url)
            assert r.status_code == 200, (fam["id"], weight, url)
            assert r.content[:4] in (b"\x00\x01\x00\x00", b"OTTO", b"true"), fam["id"]
            assert len(r.content) > 200_000
            # Pillow 로 실제 로드 + 한글 글리프 확인
            path = WORK / f"font-{fam['id']}-{weight}.ttf"
            path.write_bytes(r.content)
            font = ImageFont.truetype(str(path), 40)
            assert font.getlength("한글자막") > 40


# ------------------------------------------------------------------ 2) 업로드
def test_upload_project(client, uploaded):
    assert uploaded["width"] == 640 and uploaded["height"] == 360
    assert 4.5 <= uploaded["duration"] <= 5.5
    assert uploaded["hasAudio"] is True
    assert uploaded["frames"] > 100

    meta = client.get(f"/api/projects/{uploaded['id']}")
    assert meta.status_code == 200
    assert meta.json()["project"]["filename"].endswith(".mp4")

    # Range 요청(브라우저 재생) 지원 확인
    r = client.get(f"/api/projects/{uploaded['id']}/video", headers={"Range": "bytes=0-1023"})
    assert r.status_code == 206
    assert r.headers["content-range"].startswith("bytes 0-1023/")
    assert len(r.content) == 1024

    thumb = client.get(f"/api/projects/{uploaded['id']}/thumbnail?t=1.0")
    assert thumb.status_code == 200 and thumb.headers["content-type"] == "image/jpeg"


# ------------------------------------------------------------------ 3) 얼굴 추적
@pytest.fixture(scope="session")
def tracks(client, uploaded):
    resp = client.post(f"/api/projects/{uploaded['id']}/detect-faces", json={"sampleFps": 6})
    assert resp.status_code == 200, resp.text
    job = wait_job(client, resp.json()["jobId"])
    assert job["status"] == "done", job
    data = job["result"]
    assert data["tracks"], "얼굴을 하나도 찾지 못했습니다"
    return data


def test_detect_faces_and_tracking(client, uploaded, tracks):
    tr = tracks["tracks"]
    assert len(tr) >= 1
    first = tr[0]
    assert first["label"].startswith("인물")
    assert len(first["keyframes"]) >= 5
    xs = [k["x"] for k in first["keyframes"]]
    assert max(xs) - min(xs) > 0.02, "박스가 움직이지 않으면 추적이 아니다"

    # 저장된 트랙을 다시 읽을 수 있어야 한다.
    saved = client.get(f"/api/projects/{uploaded['id']}/tracks")
    assert saved.status_code == 200
    assert len(saved.json()["tracks"]) == len(tr)

    # 박스가 프레임 안에 있어야 한다.
    for k in first["keyframes"]:
        assert 0 <= k["x"] <= 1 and 0 <= k["y"] <= 1
        assert 0.02 < k["w"] < 1 and 0.02 < k["h"] < 1


# ------------------------------------------------------------------ 4) 블러 강도
def _region_diff(a: np.ndarray, b: np.ndarray, box) -> tuple:
    h, w = a.shape[:2]
    x = int(box["x"] * w)
    y = int(box["y"] * h)
    bw = int(box["w"] * w)
    bh = int(box["h"] * h)
    inside = (slice(y, y + bh), slice(x, x + bw))
    mask = np.ones((h, w), bool)
    mask[inside] = False
    diff = np.abs(a.astype(np.int16) - b.astype(np.int16)).mean(axis=2)
    return float(diff[inside].mean()), float(diff[mask].mean())


def test_blur_strength_changes_output(client, uploaded, tracks):
    track = tracks["tracks"][0]
    box = track["keyframes"][2]
    spec_weak = base_spec(masks={"enabled": True, "mode": "blur", "shape": "rect",
                                 "strength": 8, "pad": 0.1,
                                 "tracks": [{"id": track["id"], "enabled": True}]})
    spec_strong = base_spec(masks={"enabled": True, "mode": "blur", "shape": "rect",
                                   "strength": 92, "pad": 0.1,
                                   "tracks": [{"id": track["id"], "enabled": True}]})
    weak = render(client, uploaded["id"], spec_weak)
    strong = render(client, uploaded["id"], spec_strong)

    orig = frames_of(WORK / "fixture.mp4", [box["t"]])[round(box["t"], 3)]
    weak_f = frames_of(weak["_path"], [box["t"]])[round(box["t"], 3)]
    strong_f = frames_of(strong["_path"], [box["t"]])[round(box["t"], 3)]

    weak_in, weak_out = _region_diff(orig, weak_f, box)
    strong_in, strong_out = _region_diff(orig, strong_f, box)

    # 영역 안이 바깥보다 확실히 많이 변해야 하고, 강도가 셀수록 더 흐려져야 한다.
    assert weak_in > weak_out * 1.5, (weak_in, weak_out)
    assert strong_in > strong_out * 2.0, (strong_in, strong_out)

    laplacian = cv2.Laplacian(cv2.cvtColor(strong_f, cv2.COLOR_BGR2GRAY), cv2.CV_64F)
    x = int(box["x"] * strong_f.shape[1]); y = int(box["y"] * strong_f.shape[0])
    bw = int(box["w"] * strong_f.shape[1]); bh = int(box["h"] * strong_f.shape[0])
    assert np.abs(laplacian[y:y + bh, x:x + bw]).mean() < 8.0


def test_pixelate_mode(client, uploaded, tracks):
    track = tracks["tracks"][0]
    box = track["keyframes"][2]
    spec = base_spec(masks={"enabled": True, "mode": "pixelate", "shape": "ellipse",
                            "strength": 95, "pad": 0.12,
                            "tracks": [{"id": track["id"], "enabled": True}]})
    result = render(client, uploaded["id"], spec)
    frame = frames_of(result["_path"], [box["t"]])[round(box["t"], 3)]
    orig = frames_of(WORK / "fixture.mp4", [box["t"]])[round(box["t"], 3)]

    x = int(box["x"] * frame.shape[1]); y = int(box["y"] * frame.shape[0])
    bw = int(box["w"] * frame.shape[1]); bh = int(box["h"] * frame.shape[0])
    roi_new = frame[y:y + bh, x:x + bw]
    roi_orig = orig[y:y + bh, x:x + bw]
    # 모자이크는 색 종류(고유값)를 크게 줄인다.
    uniq_new = len(np.unique(roi_new.reshape(-1, 3), axis=0))
    uniq_orig = len(np.unique(roi_orig.reshape(-1, 3), axis=0))
    assert uniq_new < uniq_orig * 0.55, (uniq_new, uniq_orig)

    # 사각형이 아닌 타원형 마스크: 박스 모서리는 원본과 비슷하게 남는다.
    corner = (slice(y + 2, y + 6), slice(x + 2, x + 6))
    corner_new = frame[corner].astype(np.int16)
    corner_orig = orig[corner].astype(np.int16)
    assert np.abs(corner_new - corner_orig).mean() < 60


def test_manual_mask_with_time_range(client, uploaded):
    masks = {
        "enabled": True, "mode": "pixelate", "shape": "rect", "strength": 80,
        "tracks": [],
        "manual": [{"id": "m1", "x": 0.12, "y": 0.25, "w": 0.3, "h": 0.5,
                    "start": 0.0, "end": 1.0}],
    }
    masked = render(client, uploaded["id"], base_spec(masks=masks), timeout=300)
    plain = render(client, uploaded["id"], base_spec(masks={"enabled": False}), timeout=300)

    a = frames_of(masked["_path"], [0.5, 1.5])
    b = frames_of(plain["_path"], [0.5, 1.5])

    def diff_at(t):
        h, w = a[t].shape[:2]
        d = np.abs(a[t].astype(np.int16) - b[t].astype(np.int16)).mean(axis=2)
        roi = d[int(0.25 * h):int(0.75 * h), int(0.12 * w):int(0.42 * w)]
        rest = d.copy()
        rest[int(0.25 * h):int(0.75 * h), int(0.12 * w):int(0.42 * w)] = 0
        return float(roi.mean()), float(rest.mean())

    inside, outside = diff_at(0.5)
    assert inside > 4.0, inside            # 구간 안에서는 마스크가 적용됨
    assert inside > outside * 3.0, (inside, outside)

    after_in, _ = diff_at(1.5)
    assert after_in < 1.5, after_in        # 구간이 끝나면 원본과 거의 같다


# ------------------------------------------------------------------ 5) 자막 스타일
STYLES = {
    "highlight": dict(preset="highlight", font="pretendard", weight="bold", fontSize=8.5,
                      yPercent=72, accent="#FFE14D"),
    "bounce": dict(preset="bounce", font="jua", weight="regular", fontSize=9.0,
                   yPercent=72, color="#FFFFFF"),
    "box": dict(preset="box", font="gmarket", weight="bold", fontSize=8.0, yPercent=76,
                boxColor="#FFFFFF", boxOpacity=0.92, color="#111111"),
    "outline": dict(preset="outline", font="blackhan", weight="regular", fontSize=10.0,
                    yPercent=70, strokeWidth=0.18),
    "jiggle": dict(preset="jiggle", font="maruburi", weight="regular", fontSize=9.0,
                   yPercent=70, wobble=60, color="#FFF8E7", accent="#FFD9A0"),
}


@pytest.mark.parametrize("preset", list(STYLES))
def test_subtitle_presets(client, uploaded, preset):
    style = {"lineHeight": 1.25, "maxWidthPct": 84}
    style.update(STYLES[preset])
    cue = {
        "id": f"c-{preset}",
        "start": 0.1,
        "end": 1.9,
        "text": "지글지글 명조 자막 테스트",
        "words": [
            {"text": "지글지글", "start": 0.1, "end": 0.7},
            {"text": "명조", "start": 0.7, "end": 1.2},
            {"text": "자막", "start": 1.2, "end": 1.6},
            {"text": "테스트", "start": 1.6, "end": 1.9},
        ],
    }
    spec = base_spec(subtitles={"enabled": True, "cues": [cue], "style": style})
    result = render(client, uploaded["id"], spec, timeout=300)

    info = video_info(result["_path"])
    assert info["width"] == 640 and info["height"] == 360
    assert 1.6 <= info["duration"] <= 2.2

    # 자막이 실제로 그려졌는지: 자막 영역의 밝은 픽셀 수
    frame = frames_of(result["_path"], [0.9])[0.9]
    h, w = frame.shape[:2]
    band = frame[int(0.55 * h):int(0.9 * h), :]
    bright = int((band.max(axis=2) > 200).sum())
    assert bright > 400, f"{preset}: 자막 픽셀이 너무 적음 ({bright})"

    if preset == "jiggle":
        # 지글지글: 프레임마다 글자 위치가 흔들려야 한다(1/12초 간격 샘플 비교)
        f1 = frames_of(result["_path"], [0.60])[0.6]
        f2 = frames_of(result["_path"], [0.68])[0.68]
        diff = np.abs(f1.astype(np.int16) - f2.astype(np.int16)).mean()
        assert diff > 0.4, f"지글지글 흔들림이 없음 ({diff})"

    if preset == "box":
        # 둥근 배경 박스: 자막 밴드에서 밝은 영역 비율이 높다.
        assert (band.max(axis=2) > 190).mean() > 0.02


def test_subtitle_toggle_and_timing(client, uploaded):
    cue = {"id": "c1", "start": 0.6, "end": 1.4, "text": "딱 여기서만"}
    spec_on = base_spec(subtitles={"enabled": True, "cues": [cue],
                                   "style": dict(STYLES["highlight"], fontSize=10)})
    spec_off = base_spec(subtitles={"enabled": False, "cues": [cue],
                                    "style": dict(STYLES["highlight"], fontSize=10)})
    on = render(client, uploaded["id"], spec_on, timeout=300)
    off = render(client, uploaded["id"], spec_off, timeout=300)

    def bright(path, t):
        f = frames_of(path, [t])[t]
        return int((f.max(axis=2) > 235).sum())

    assert bright(on["_path"], 1.0) - bright(off["_path"], 1.0) > 800
    # 자막 구간 밖에서는 거의 같아야 한다.
    assert abs(bright(on["_path"], 0.2) - bright(off["_path"], 0.2)) < 300


# ------------------------------------------------------------------ 5-b) 상단 후킹 타이틀
HOOK_PRESETS = {
    "reviewming": dict(
        preset="reviewming", subtext="결혼준비 브이로그", title="2027년에 결혼하면\n개이득인 이유",
        yPercent=24, fontSize=9.0, subSize=2.9, color="#FFFFFF", accent="#FFD84D",
        accentLine=2, strokeWidth=0.12, skew=-6, font="pretendard", weight="extrabold",
        pillColor="#000000", pillOpacity=0.55,
        speedLines={"enabled": True, "color": "#FFFFFF", "opacity": 0.5,
                    "count": 76, "innerRadius": 0.62, "seed": 7},
    ),
    "vlog": dict(
        preset="vlog", subtext="", title="드레스 피팅 Vlog",
        yPercent=26, fontSize=8.6, strokeWidth=0.16, skew=0,
        font="pretendard", weight="bold", accentLine=0,
    ),
    "blackbox": dict(
        preset="blackbox", subtext="", title="엄마! 학예회 때\n예쁘게 좀 하고와",
        yPercent=20, fontSize=7.4, boxColor="#000000", boxOpacity=0.56, boxRadius=0.35,
        strokeWidth=0, font="dohyeon", weight="regular", accentLine=0,
    ),
    "badge": dict(
        preset="badge", subtext="등대같은 월세집", title="월세 30만원에\n이런 뷰라고?",
        yPercent=24, fontSize=8.8, subSize=2.7, font="nanumpen", weight="regular",
        strokeWidth=0.05, skew=-3, pillColor="#7C5CFF", pillOpacity=0.88, accentLine=0,
    ),
}


def _top_band_diff(a: np.ndarray, b: np.ndarray, ratio: float = 0.45) -> float:
    h = a.shape[0]
    band = slice(0, int(h * ratio))
    return float(np.abs(a[band].astype(np.int16) - b[band].astype(np.int16)).mean())


@pytest.mark.parametrize("preset", list(HOOK_PRESETS))
def test_hook_title_presets(client, uploaded, preset):
    spec_hook = base_spec(hook={"enabled": True, **HOOK_PRESETS[preset]})
    plain = render(client, uploaded["id"], base_spec(), timeout=300)
    with_hook = render(client, uploaded["id"], spec_hook, timeout=300)

    f_hook = frames_of(with_hook["_path"], [1.0])[1.0]
    f_plain = frames_of(plain["_path"], [1.0])[1.0]
    assert f_hook.shape == f_plain.shape

    top = _top_band_diff(f_hook, f_plain)
    bottom = float(np.abs(f_hook[int(0.6 * f_hook.shape[0]):].astype(np.int16)
                          - f_plain[int(0.6 * f_plain.shape[0]):].astype(np.int16)).mean())
    assert top > 3.0, f"{preset}: 상단 타이틀이 그려지지 않음 ({top:.2f})"
    # 집중선 프리셋은 화면 전체(가장자리)가 바뀌므로 비율 기준을 완화한다.
    ratio = 1.3 if HOOK_PRESETS[preset].get("speedLines", {}).get("enabled") else 2.5
    assert top > bottom * ratio, f"{preset}: 상단({top:.2f})이 하단({bottom:.2f})보다 확실히 달라야 함"

    # 글자가 실제로 있는지: 상단 영역의 밝은 픽셀
    band = f_hook[: int(0.45 * f_hook.shape[0])]
    bright = int((band.reshape(-1, 3).max(axis=1) > 230).sum())
    assert bright > 300, f"{preset}: 타이틀 글자 픽셀이 너무 적음 ({bright})"

    if preset == "reviewming":
        # 포인트 색(노랑) 2번째 줄
        b, g, r = band[..., 0].astype(int), band[..., 1].astype(int), band[..., 2].astype(int)
        yellow = int(((r > 200) & (g > 170) & (b < 120)).sum())
        assert yellow > 60, f"포인트 색 줄이 없음 ({yellow})"
        # 서브바(반투명 검정 알약) → 어두운 픽셀 증가
        dark_plain = int((frames_of(plain["_path"], [1.0])[1.0][: int(0.45 * 360)]
                          .reshape(-1, 3).max(axis=1) < 40).sum())
        dark_hook = int((band.reshape(-1, 3).max(axis=1) < 40).sum())
        assert dark_hook > dark_plain + 300, (dark_hook, dark_plain)


def test_hook_speed_lines_and_time_range(client, uploaded):
    style = dict(HOOK_PRESETS["reviewming"])
    style["speedLines"] = {"enabled": False, "count": 76, "innerRadius": 0.62, "seed": 7}
    with_lines_spec = base_spec(hook={"enabled": True, **HOOK_PRESETS["reviewming"]})
    no_lines_spec = base_spec(hook={"enabled": True, **style})
    with_lines = render(client, uploaded["id"], with_lines_spec, timeout=300)
    no_lines = render(client, uploaded["id"], no_lines_spec, timeout=300)

    f1 = frames_of(with_lines["_path"], [1.0])[1.0]
    f2 = frames_of(no_lines["_path"], [1.0])[1.0]
    # 가장자리(좌우 15%) 밝기가 올라가야 한다(반투명 흰 선).
    h, w = f1.shape[:2]
    left = slice(0, int(w * 0.15))
    right = slice(w - int(w * 0.15), w)
    bright1 = max(float(f1[:, left].mean()), float(f1[:, right].mean()))
    bright2 = max(float(f2[:, left].mean()), float(f2[:, right].mean()))
    assert bright1 > bright2 + 1.5, f"집중선이 그려지지 않음 ({bright1:.2f} vs {bright2:.2f})"

    # 가장자리에서 밝은(선) 픽셀도 늘어난다
    white1 = int((((f1[:, left].max(axis=2) > 110) | (f1[:, right].max(axis=2) > 110))).sum())
    white2 = int((((f2[:, left].max(axis=2) > 110) | (f2[:, right].max(axis=2) > 110))).sum())
    assert white1 > white2, (white1, white2)

    # 표시 시간 구간: 1.0~2.0초에만 보여야 한다
    ranged = dict(HOOK_PRESETS["vlog"])
    ranged.update({"start": 1.0, "end": 2.0})
    spec = base_spec(trim={"start": 0.0, "end": 3.0}, hook={"enabled": True, **ranged})
    plain = render(client, uploaded["id"], base_spec(trim={"start": 0.0, "end": 3.0}), timeout=300)
    out = render(client, uploaded["id"], spec, timeout=300)

    a = frames_of(out["_path"], [0.5, 1.5])
    b = frames_of(plain["_path"], [0.5, 1.5])
    before = _top_band_diff(a[0.5], b[0.5])
    inside = _top_band_diff(a[1.5], b[1.5])
    assert inside > 3.0, inside
    assert before < 1.2, before


def test_hook_with_subtitles_together(client, uploaded):
    cue = {"id": "c1", "start": 0.1, "end": 2.0, "text": "본문 자막은 그대로"}
    spec = base_spec(
        subtitles={"enabled": True, "cues": [cue], "style": dict(STYLES["highlight"], fontSize=8, yPercent=84)},
        hook={"enabled": True, **HOOK_PRESETS["badge"]},
    )
    result = render(client, uploaded["id"], spec, timeout=300)
    frame = frames_of(result["_path"], [1.0])[1.0]
    h = frame.shape[0]
    top_bright = int((frame[: int(0.4 * h)].reshape(-1, 3).max(axis=1) > 220).sum())
    bottom_bright = int((frame[int(0.6 * h):].reshape(-1, 3).max(axis=1) > 220).sum())
    assert top_bright > 300 and bottom_bright > 300, (top_bright, bottom_bright)


# ------------------------------------------------------------------ 6) 트림·비율
def test_trim_and_aspect(client, uploaded):
    spec = base_spec(trim={"start": 1.0, "end": 3.0}, aspect="9:16")
    result = render(client, uploaded["id"], spec, timeout=300)
    assert abs(result["width"] / result["height"] - 9 / 16) < 0.02, result
    assert 1.85 <= result["duration"] <= 2.2
    assert result["hasAudio"] is True

    spec_sq = base_spec(trim={"start": 0.0, "end": 1.0}, aspect="1:1")
    sq = render(client, uploaded["id"], spec_sq, timeout=300)
    assert abs(sq["width"] - sq["height"]) <= 2


# ------------------------------------------------------------------ 7) 자동 자막(ASR)
@pytest.mark.slow
def test_auto_transcribe(client):
    speech = WORK / "speech.mp3"
    if not speech.is_file():
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from tests import fixtures

        fixtures.make_audio(speech, "speech",
                            "안녕하세요 오늘은 릴스 자막을 만들어 볼게요 지금부터 시작합니다")
    if not speech.is_file() or speech.stat().st_size < 5000:
        pytest.skip("TTS 음성을 만들 수 없어 ASR 테스트를 건너뜁니다.")

    video = WORK / "speech.mp4"
    if not video.is_file():
        from tests import fixtures

        fixtures.make_video(video, speech)

    with video.open("rb") as fh:
        resp = client.post("/api/projects", files={"file": (video.name, fh, "video/mp4")})
    assert resp.status_code == 200, resp.text
    pid = resp.json()["project"]["id"]

    resp = client.post(f"/api/projects/{pid}/transcribe", json={"language": "ko"})
    assert resp.status_code == 200, resp.text
    job = wait_job(client, resp.json()["jobId"], timeout=900)
    if job["status"] == "error" and any(k in (job["error"] or "") for k in
                                        ("download", "Connection", "resolve", "model", "HTTP")):
        pytest.skip(f"whisper 모델을 받을 수 없어 건너뜁니다: {job['error']}")
    assert job["status"] == "done", job
    cues = job["result"]["cues"]
    assert cues, "자막 큐가 비어 있습니다"
    assert all(c["end"] > c["start"] for c in cues)
    assert any("자막" in c["text"] or "릴스" in c["text"] for c in cues), cues

    # 자동 자막 결과로 렌더링까지 이어지는지
    spec = base_spec(subtitles={"enabled": True, "cues": cues,
                                "style": dict(STYLES["highlight"], fontSize=9)})
    result = render(client, pid, spec, timeout=300)
    assert result["frames"] > 10


# ------------------------------------------------------------------ 8) 프론트/백엔드 레이아웃 일치
def _node() -> str | None:
    for candidate in ("/workspace/.local/node/bin/node", "node"):
        try:
            out = subprocess.run([candidate, "-v"], capture_output=True, text=True, timeout=20)
            if out.returncode == 0:
                return candidate
        except Exception:
            continue
    return None


def test_layout_parity_with_frontend():
    node = _node()
    frontend = Path(__file__).resolve().parents[2] / "frontend"
    if node is None:
        pytest.skip("node 가 없어 프론트 레이아웃 파리티를 확인할 수 없습니다.")

    harness = frontend / ".parity" / "scripts" / "parity.js"
    if not harness.is_file():
        # 산출물이 없으면 tsc 로 새로 만든다(레포를 처음 받은 상태에서도 동작).
        npm = str(Path(node).with_name("npm"))
        import os

        env = dict(os.environ)
        env["PATH"] = str(Path(node).parent) + os.pathsep + env.get("PATH", "")
        built = subprocess.run([npm, "run", "parity", "--silent"], cwd=str(frontend),
                               capture_output=True, text=True, timeout=300, env=env)
        if built.returncode != 0:
            pytest.skip(f"파리티 하네스 빌드 실패: {built.stderr[-400:]}")
        js = json.loads(built.stdout[built.stdout.index("{"):built.stdout.rindex("}") + 1])
    else:
        out = subprocess.run([node, str(harness)], capture_output=True, text=True, timeout=60)
        assert out.returncode == 0, out.stderr
        js = json.loads(out.stdout)

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from app.layout import compute_layout
    from app.models import Cue, SubtitleStyle

    for case in js["cases"]:
        style = SubtitleStyle(**case["style"])
        cue = Cue(id=case["cue"]["id"], start=0, end=1, text=case["cue"]["text"])
        font_px = style.fontSize / 100.0 * case["canvasH"]

        def measure(text: str, _fs=font_px) -> float:
            from app.layout import text_em

            return text_em(text) * _fs

        py = compute_layout(cue, style, case["canvasW"], case["canvasH"], measure)
        jsl = case["layout"]
        assert len(py.lines) == len(jsl["lines"]), (case["name"], py.lines, jsl["lines"])
        for a, b in zip(py.lines, jsl["lines"]):
            assert abs(a.baseline - b["baseline"]) < 0.01, (case["name"], a.baseline, b["baseline"])
            assert [t.text for t in a.tokens] == [t["text"] for t in b["tokens"]]
        from app.layout import bounce_scale, char_transform

        assert case["animations"]["bounce"][1] == pytest.approx(bounce_scale(0.05), abs=1e-9)
        jsj = case["animations"]["jiggle"]
        pyj = char_transform(3, 123456789, 0.5, 0.6, 40)
        assert jsj["dx"] == pytest.approx(pyj.dx, abs=1e-9)
        assert jsj["dy"] == pytest.approx(pyj.dy, abs=1e-9)
        assert jsj["rot"] == pytest.approx(pyj.rot, abs=1e-9)
        assert jsj["scale"] == pytest.approx(pyj.scale, abs=1e-9)

    # 기하·마스크 강도 공식도 동일해야 한다.
    from app.media import output_geometry
    from app.renderer import blur_sigma, pixel_block

    for key, aspect, size in [
        ("16:9-to-9:16", "9:16", (1920, 1080)),
        ("16:9-to-1:1", "1:1", (1920, 1080)),
        ("portrait-to-16:9", "16:9", (1080, 1920)),
        ("original", "original", (640, 360)),
    ]:
        w, h, cx, cy = output_geometry(size[0], size[1], aspect)
        assert js["geo"][key] == {"outW": w, "outH": h, "cropX": cx, "cropY": cy}, key

    for item in js["masks"]["blur"]:
        assert item["sigma"] == pytest.approx(blur_sigma(item["strength"], 120, 160), abs=1e-9)
    for item in js["masks"]["pixel"]:
        assert item["block"] == pixel_block(item["strength"], 120, 160)

    # ---- 상단 후킹 타이틀 레이아웃 일치
    from app.layout import compute_hook_layout, speed_line_polys, text_em
    from app.models import HookTitle, SpeedLines

    for case in js["hooks"]:
        hook = HookTitle(**case["hook"])
        main_px = max(6.0, hook.fontSize / 100.0 * case["canvasH"])
        sub_px = max(4.0, hook.subSize / 100.0 * case["canvasH"])
        py = compute_hook_layout(
            hook, case["canvasW"], case["canvasH"],
            lambda t, s=main_px: text_em(t) * s,
            lambda t, s=sub_px: text_em(t) * s,
        )
        jl = case["layout"]
        assert len(py.lines) == len(jl["lines"]), (case["name"], [l.text for l in py.lines], jl["lines"])
        assert py.font_px == pytest.approx(jl["fontPx"], abs=1e-9)
        assert py.block_top == pytest.approx(jl["blockTop"], abs=1e-9)
        for a, b in zip(py.lines, jl["lines"]):
            assert a.text == b["text"]
            assert a.is_accent == b["isAccent"]
            assert a.baseline == pytest.approx(b["baseline"], abs=1e-9)
            assert a.width == pytest.approx(b["width"], abs=1e-9)
            for (text, x, w), tok in zip(a.tokens, b["tokens"]):
                assert text == tok["text"]
                assert x == pytest.approx(tok["x"], abs=1e-9)
                assert w == pytest.approx(tok["w"], abs=1e-9)
        if py.pill is None:
            assert jl["pill"] is None
        else:
            for pv, jv in zip(py.pill, [jl["pill"]["x"], jl["pill"]["y"], jl["pill"]["w"], jl["pill"]["h"]]):
                assert pv == pytest.approx(jv, abs=1e-9)

    cfg = SpeedLines(**{"enabled": True, "color": "#FFFFFF", "opacity": 0.5,
                        "count": 76, "innerRadius": 0.62, "seed": 7})
    polys = speed_line_polys(1080, 1920, cfg)
    assert len(polys) == js["speedLines"]["count"]
    for a, b in zip(polys[:3], js["speedLines"]["first"]):
        for (px, pyv), pt in zip(a, b):
            assert px == pytest.approx(pt["x"], abs=1e-9)
            assert pyv == pytest.approx(pt["y"], abs=1e-9)
