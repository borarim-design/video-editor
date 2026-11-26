"""자막 레이아웃 기하 계산 — 프론트엔드 `src/lib/layout.ts` 와 1:1 대응.

미리보기(Canvas)와 최종 렌더링(Pillow)이 같은 좌표를 쓰도록
글자 폭 추정, 줄바꿈, baseline 위치, 지글지글 난수까지 모두
같은 규칙을 이 파일과 TS 파일에 나눠 둔다.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Sequence

from .models import Cue, HookTitle, SpeedLines, SubtitleStyle

ASCENT_RATIO = 0.84  # baseline 이 줄 박스 위에서 차지하는 비율
SPACE_ADVANCE = 0.30  # 단어 사이 공백 폭(em) — 폰트의 U+0020 유무와 무관하게 고정
SPACE_EM = 0.32


def is_wide(ch: str) -> bool:
    o = ord(ch)
    return (
        0xAC00 <= o <= 0xD7A3  # 한글 음절
        or 0x3131 <= o <= 0x318E  # 한글 자모
        or 0x4E00 <= o <= 0x9FFF  # 한자
        or 0x3000 <= o <= 0x303F  # CJK 문장부호
        or 0xFF01 <= o <= 0xFF60  # 전각
        or 0xFFE0 <= o <= 0xFFE6
    )


def char_em(ch: str) -> float:
    """글자 하나의 폭을 em 단위로 추정한다(줄바꿈 계산용)."""
    if ch in (" ", "\u00a0"):
        return SPACE_EM
    if is_wide(ch):
        return 1.0
    if ch in ".,:;!?'\"`·":
        return 0.28
    if ch in "()[]{}<>":
        return 0.42
    if ch in "-–—~|/\\":
        return 0.42
    if ch.isdigit():
        return 0.56
    if "A" <= ch <= "Z":
        return 0.66
    if "a" <= ch <= "z":
        return 0.54
    return 0.6


def text_em(text: str) -> float:
    return sum(char_em(ch) for ch in text)


@dataclass
class Token:
    text: str
    word_index: int
    x: float = 0.0
    w: float = 0.0


@dataclass
class Line:
    tokens: List[Token] = field(default_factory=list)
    baseline: float = 0.0
    start_x: float = 0.0
    width: float = 0.0


@dataclass
class CueLayout:
    cue_id: str
    font_px: float
    line_height: float
    lines: List[Line]
    block_top: float
    block_height: float
    box: Optional[tuple]  # (x, y, w, h) 배경 박스


def split_words(text: str) -> List[str]:
    words: List[str] = []
    cur = ""
    for ch in text.strip():
        if ch == " ":
            if cur:
                words.append(cur)
                cur = ""
        else:
            cur += ch
    if cur:
        words.append(cur)
    return words


def wrap_tokens(tokens: Sequence[str], max_em: float) -> List[List[int]]:
    """토큰 인덱스를 줄 단위로 나눈다(폭 추정 기반, 결정적)."""
    lines: List[List[int]] = []
    cur: List[int] = []
    cur_em = 0.0
    for idx, text in enumerate(tokens):
        w = text_em(text)
        if not cur:
            cur = [idx]
            cur_em = w
            continue
        if cur_em + SPACE_EM + w <= max_em:
            cur.append(idx)
            cur_em += SPACE_EM + w
        else:
            lines.append(cur)
            cur = [idx]
            cur_em = w
    if cur:
        lines.append(cur)
    return lines or [[]]


def compute_layout(
    cue: Cue,
    style: SubtitleStyle,
    canvas_w: float,
    canvas_h: float,
    measure: Callable[[str], float],
    cue_index: int = 0,
) -> CueLayout:
    """자막 한 개(큐)의 줄·토큰 좌표를 계산한다."""
    font_px = max(6.0, style.fontSize / 100.0 * canvas_h)
    line_height = font_px * style.lineHeight
    max_em = max(1.0, (canvas_w * style.maxWidthPct / 100.0) / font_px)

    words = split_words(cue.text)
    if not words:
        words = [""]

    line_groups = wrap_tokens(words, max_em)
    n_lines = len(line_groups)
    block_height = (n_lines - 1) * line_height + font_px
    top = canvas_h * style.yPercent / 100.0 - block_height / 2.0

    lines: List[Line] = []
    for li, group in enumerate(line_groups):
        tokens: List[Token] = []
        width = 0.0
        space_px = font_px * SPACE_ADVANCE
        for k, wi in enumerate(group):
            text = words[wi]
            w = measure(text)
            if k > 0:
                width += space_px
            tokens.append(Token(text=text, word_index=wi, w=w))
            width += w
        start_x = (canvas_w - width) / 2.0
        x = start_x
        for k, tok in enumerate(tokens):
            if k > 0:
                x += space_px
            tok.x = x
            x += tok.w
            if style.letterSpacing:
                x += style.letterSpacing * font_px
        baseline = top + font_px * ASCENT_RATIO + li * line_height
        lines.append(Line(tokens=tokens, baseline=baseline, start_x=start_x, width=width))

    box = None
    if style.boxOpacity > 0.001:
        pad_x = font_px * style.boxPadX
        pad_y = font_px * style.boxPadY
        widest = max((ln.width for ln in lines), default=0.0)
        box = (
            (canvas_w - widest) / 2.0 - pad_x,
            top - pad_y,
            widest + pad_x * 2.0,
            block_height + pad_y * 2.0,
        )

    return CueLayout(
        cue_id=cue.id,
        font_px=font_px,
        line_height=line_height,
        lines=lines,
        block_top=top,
        block_height=block_height,
        box=box,
    )


# ------------------------------------------------------------------ 애니메이션
def bounce_scale(t_local: float) -> float:
    """큐 시작 직후 통통 튀는 스케일(프론트와 동일)."""
    if t_local < 0:
        return 0.0
    if t_local < 0.18:
        p = t_local / 0.18
        e = 1.0 - (1.0 - p) * (1.0 - p) ** 2  # easeOutCubic
        return 0.55 + (1.08 - 0.55) * e
    if t_local < 0.34:
        p = (t_local - 0.18) / 0.16
        return 1.08 - 0.08 * p
    return 1.0


def fnv1a(text: str) -> int:
    h = 2166136261
    for b in text.encode("utf-8"):
        h ^= b
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def _hash32(a: int, b: int, c: int, d: int) -> int:
    h = (a * 374761393 + b * 668265263 + c * 1274126177 + d * 2654435761) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 1274126177) & 0xFFFFFFFF
    h ^= h >> 16
    return h


def jiggle(char_index: int, cue_seed: int, step: int, channel: int) -> float:
    """-1~1 사이 결정적 난수. 프론트엔드와 같은 정수 해시를 쓴다."""
    h = _hash32(char_index + 1, cue_seed, step, channel)
    return (h / 4294967295.0) * 2.0 - 1.0


@dataclass
class CharTransform:
    dx: float = 0.0
    dy: float = 0.0
    rot: float = 0.0  # 라디안
    scale: float = 1.0


def char_transform(
    char_index: int,
    cue_seed: int,
    t_abs: float,
    intensity: float,
    font_px: float,
) -> CharTransform:
    """지글지글 변형. intensity 0~1, step 은 12fps 로 끊어 아날로그 느낌을 낸다."""
    if intensity <= 0.001:
        return CharTransform()
    step = int(math.floor(t_abs * 12.0))
    dx = jiggle(char_index, cue_seed, step, 1) * 0.035 * font_px * intensity
    dy = jiggle(char_index, cue_seed, step, 2) * 0.030 * font_px * intensity
    rot = math.radians(jiggle(char_index, cue_seed, step, 3) * 9.0 * intensity)
    scale = 1.0 + jiggle(char_index, cue_seed, step, 4) * 0.05 * intensity
    return CharTransform(dx=dx, dy=dy, rot=rot, scale=scale)


def word_at(cue: Cue, t_rel: float) -> Optional[int]:
    """t_rel(큐 시작 기준 초)에 발화 중인 단어 인덱스."""
    for i, w in enumerate(cue.words):
        if w.start <= t_rel < w.end:
            return i
    if cue.words and t_rel >= cue.words[-1].end:
        return len(cue.words) - 1
    return None


def words_fallback(cue: Cue) -> List[Dict[str, float]]:
    """단어 타임스탬프가 없으면 글자 수 비례로 나눈다."""
    words = split_words(cue.text)
    if not words:
        return []
    total = sum(len(w) for w in words) or 1
    dur = max(0.01, cue.end - cue.start)
    out = []
    acc = 0
    for w in words:
        s = cue.start + dur * acc / total
        acc += len(w)
        e = cue.start + dur * acc / total
        out.append({"text": w, "start": s, "end": e})
    return out


# ------------------------------------------------------------------ 후킹 타이틀
@dataclass
class HookLine:
    text: str
    width: float
    baseline: float
    is_accent: bool
    tokens: List[tuple] = field(default_factory=list)  # (text, x, width)


@dataclass
class HookLayout:
    font_px: float
    sub_px: float
    lines: List[HookLine]
    pill: Optional[tuple]
    sub_baseline: float
    block_top: float
    block_height: float
    box: Optional[tuple]


def compute_hook_layout(
    hook: HookTitle,
    canvas_w: float,
    canvas_h: float,
    measure_main: Callable[[str], float],
    measure_sub: Callable[[str], float],
) -> HookLayout:
    """상단 후킹 타이틀 블록의 좌표(프론트 `computeHookLayout` 과 동일)."""
    font_px = max(6.0, hook.fontSize / 100.0 * canvas_h)
    sub_px = max(4.0, hook.subSize / 100.0 * canvas_h)
    line_height = font_px * hook.lineHeight
    max_w = canvas_w * 0.92

    texts: List[str] = []
    for raw in hook.title.replace("\r", "").split("\n"):
        raw = raw.strip()
        if not raw:
            continue
        words = split_words(raw)
        cur = ""
        for w in words:
            cand = w if not cur else cur + " " + w
            if cur and measure_main(cand) > max_w:
                texts.append(cur)
                cur = w
            else:
                cur = cand
        if cur:
            texts.append(cur)

    sub = hook.subtext.strip()
    has_pill = bool(sub)
    pill_h = sub_px * 1.55
    pill_pad = sub_px * 0.75
    sub_w = measure_sub(sub) if has_pill else 0.0
    pill_w = sub_w + pill_pad * 2.0
    gap = sub_px * 0.6 if has_pill else 0.0

    title_h = (len(texts) - 1) * line_height + font_px if texts else 0.0
    block_h = (pill_h + gap if has_pill else 0.0) + title_h
    top = canvas_h * hook.yPercent / 100.0 - block_h / 2.0

    pill = ((canvas_w - pill_w) / 2.0, top, pill_w, pill_h) if has_pill else None
    sub_baseline = top + pill_h / 2.0 + sub_px * 0.35
    title_top = top + (pill_h + gap if has_pill else 0.0)

    lines: List[HookLine] = []
    space_px = font_px * SPACE_ADVANCE
    for i, text in enumerate(texts):
        words = split_words(text)
        widths = [measure_main(w) for w in words]
        line_w = sum(widths) + space_px * max(0, len(words) - 1)
        x = (canvas_w - line_w) / 2.0
        toks: List[tuple] = []
        for w, ww in zip(words, widths):
            toks.append((w, x, ww))
            x += ww + space_px
        lines.append(
            HookLine(
                text=text,
                width=line_w,
                baseline=title_top + font_px * 0.86 + i * line_height,
                is_accent=hook.accentLine > 0 and (i + 1) == hook.accentLine,
                tokens=toks,
            )
        )

    box = None
    if hook.boxOpacity > 0.001:
        pad_x = font_px * 0.55
        pad_y = font_px * 0.42
        widest = max([ln.width for ln in lines] + ([pill_w] if has_pill else []) + [0.0])
        box = ((canvas_w - widest) / 2.0 - pad_x, top - pad_y,
               widest + pad_x * 2.0, block_h + pad_y * 2.0)

    return HookLayout(font_px=font_px, sub_px=sub_px, lines=lines, pill=pill,
                      sub_baseline=sub_baseline, block_top=top,
                      block_height=block_h, box=box)


def speed_line_polys(canvas_w: float, canvas_h: float,
                     cfg: SpeedLines) -> List[List[tuple]]:
    """집중선(스피드라인) 삼각형 목록 — 프론트 `speedLinePolys` 와 동일."""
    cx, cy = canvas_w / 2.0, canvas_h / 2.0
    base = min(canvas_w, canvas_h)
    count = max(6, min(240, int(cfg.count)))
    seed = int(cfg.seed)
    out: List[List[tuple]] = []
    step = 2.0 * math.pi / count
    for i in range(count):
        a = step * i + (jiggle(i, seed, 0, 1) * 0.5 + 0.5) * step * 0.6
        ca, sa = math.cos(a), math.sin(a)
        # 그 각도로 프레임 가장자리까지의 거리 → 가장자리 근처에만 선을 그린다.
        edge = min(
            (canvas_w / 2.0) / max(1e-6, abs(ca)),
            (canvas_h / 2.0) / max(1e-6, abs(sa)),
        )
        r0 = edge * cfg.innerRadius * (0.96 + 0.1 * abs(jiggle(i, seed, 0, 2)))
        w = base * 0.0042 * (0.35 + 1.15 * abs(jiggle(i, seed, 0, 3)))
        px, py = -sa * w, ca * w
        x1, y1 = cx + r0 * ca + px, cy + r0 * sa + py
        x2, y2 = cx + r0 * ca - px, cy + r0 * sa - py
        x3, y3 = cx + edge * 1.03 * ca, cy + edge * 1.03 * sa
        out.append([(x1, y1), (x2, y2), (x3, y3)])
    return out
