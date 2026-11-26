"""폰트 카탈로그.

backend/fonts/*.ttf 를 그대로 서빙해 프론트엔드 Canvas와
백엔드 Pillow가 같은 글꼴 파일을 쓰도록 만든다.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from .config import FONT_DIR

logger = logging.getLogger("video-editor.fonts")


@dataclass(frozen=True)
class FontFile:
    weight: str  # "regular" | "bold"
    filename: str


@dataclass(frozen=True)
class FontFamily:
    id: str
    name: str
    category: str
    description: str
    files: Dict[str, str] = field(default_factory=dict)
    default_weight: str = "regular"
    sample: str = "오늘도 한 컷"

    def url(self, weight: Optional[str] = None) -> str:
        key = weight if weight in self.files else self.default_weight
        return f"/api/fonts/file/{self.files[key]}"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "description": self.description,
            "sample": self.sample,
            "defaultWeight": self.default_weight,
            "weights": sorted(self.files.keys(), key=lambda w: 0 if w == "regular" else 1),
            "files": {w: self.url(w) for w in self.files},
        }

    def path(self, weight: Optional[str] = None) -> Path:
        key = weight if weight in self.files else self.default_weight
        return FONT_DIR / self.files[key]


FAMILIES: List[FontFamily] = [
    FontFamily(
        id="pretendard",
        name="프리텐다드",
        category="고딕",
        description="요즘 가장 많이 쓰는 기본 고딕. 깔끔한 정보 전달용",
        files={"regular": "pretendard-regular.ttf", "bold": "pretendard-bold.ttf",
               "extrabold": "pretendard-extrabold.ttf"},
        default_weight="bold",
        sample="오늘의 브이로그",
    ),
    FontFamily(
        id="gmarket",
        name="G마켓 산스",
        category="고딕",
        description="광고·홍보에 잘 붙는 단단한 고딕",
        files={"regular": "gmarket-medium.ttf", "bold": "gmarket-bold.ttf"},
        default_weight="bold",
        sample="지금 바로 확인!",
    ),
    FontFamily(
        id="blackhan",
        name="검은고딕",
        category="임팩트",
        description="굵고 강한 제목용. 훅 문구에 최적",
        files={"regular": "blackhan-regular.ttf"},
        default_weight="regular",
        sample="충격 반전",
    ),
    FontFamily(
        id="notosans",
        name="Noto Sans KR",
        category="고딕",
        description="어디서나 무난한 표준 고딕",
        files={"regular": "notosans-regular.ttf", "bold": "notosans-bold.ttf"},
        default_weight="regular",
        sample="자막 예시입니다",
    ),
    FontFamily(
        id="nanummyeongjo",
        name="나눔명조",
        category="명조",
        description="차분한 아날로그 명조. 감성 브이로그에",
        files={"regular": "nanummyeongjo-regular.ttf", "bold": "nanummyeongjo-bold.ttf"},
        default_weight="regular",
        sample="그날의 기록",
    ),
    FontFamily(
        id="maruburi",
        name="마루부리",
        category="명조",
        description="부드러운 획의 현대적 명조. 지글지글 자막과 찰떡",
        files={"regular": "maruburi-regular.ttf"},
        default_weight="regular",
        sample="삐뚤빼뚤 명조",
    ),
    FontFamily(
        id="nanumpen",
        name="나눔손글씨 펜",
        category="손글씨",
        description="가볍게 적은 듯한 펜글씨",
        files={"regular": "nanumpen-regular.ttf"},
        default_weight="regular",
        sample="손글씨 자막",
    ),
    FontFamily(
        id="gaegu",
        name="개구",
        category="손글씨",
        description="삐뚤빼뚤 귀여운 손글씨",
        files={"regular": "gaegu-regular.ttf", "bold": "gaegu-bold.ttf"},
        default_weight="regular",
        sample="이거 봐봐!",
    ),
    FontFamily(
        id="cafe24",
        name="카페24 써라운드",
        category="둥근 제목",
        description="통통하고 둥근 제목용. 릴스 후킹 타이틀에 인기",
        files={"regular": "cafe24surround-regular.ttf"},
        default_weight="regular",
        sample="이거 진짜 실화?",
    ),
    FontFamily(
        id="paperlogy",
        name="페이퍼로지",
        category="임팩트",
        description="각지고 굵은 제목체. 정보 전달형 문구에 강함",
        files={"regular": "paperlogy-extra.ttf"},
        default_weight="regular",
        sample="월세 30만원",
    ),
    FontFamily(
        id="dohyeon",
        name="배민 도현체",
        category="임팩트",
        description="배달의민족 도현체. 굵고 단단한 제목",
        files={"regular": "dohyeon-regular.ttf"},
        default_weight="regular",
        sample="학예회 때",
    ),
    FontFamily(
        id="bagel",
        name="베이글팻원",
        category="둥근 제목",
        description="아주 통통한 둥근 글자. 귀여운 훅 문구에",
        files={"regular": "bagel-regular.ttf"},
        default_weight="regular",
        sample="완전 개이득",
    ),
    FontFamily(
        id="jua",
        name="주아",
        category="둥근모꼴",
        description="둥글둥글 통통 튀는 느낌",
        files={"regular": "jua-regular.ttf"},
        default_weight="regular",
        sample="두근두근",
    ),
    FontFamily(
        id="galmuri",
        name="갈무리 11",
        category="레트로",
        description="옛날 게임 감성의 픽셀 레트로",
        files={"regular": "galmuri11-regular.ttf"},
        default_weight="regular",
        sample="레트로 감성",
    ),
]

BY_ID: Dict[str, FontFamily] = {f.id: f for f in FAMILIES}
DEFAULT_FONT_ID = "pretendard"


def get_family(font_id: Optional[str]) -> FontFamily:
    return BY_ID.get(font_id or "", BY_ID[DEFAULT_FONT_ID])


def list_fonts() -> List[dict]:
    return [f.to_dict() for f in FAMILIES]


def catalog_status() -> List[dict]:
    """파일이 실제로 있는지 점검(헬스체크·테스트용)."""
    out = []
    for fam in FAMILIES:
        out.append(
            {
                "id": fam.id,
                "files": {w: (FONT_DIR / name).is_file() for w, name in fam.files.items()},
            }
        )
    return out


def resolve_font_path(font_id: Optional[str], weight: Optional[str]) -> Path:
    fam = get_family(font_id)
    path = fam.path(weight)
    if not path.is_file():
        logger.warning("폰트 파일이 없습니다: %s → 기본 폰트로 대체", path)
        return BY_ID[DEFAULT_FONT_ID].path("regular")
    return path


def font_file_by_name(name: str) -> Path:
    """경로 탈출 방지: 카탈로그에 등록된 파일명만 허용한다."""
    for fam in FAMILIES:
        for filename in fam.files.values():
            if filename == name:
                return FONT_DIR / filename
    raise FileNotFoundError(name)
