"""Pillow 로 자막을 그린다 — 프론트엔드 Canvas 미리보기와 같은 규칙.

- 같은 폰트 파일(backend/fonts)을 쓰고
- 같은 레이아웃(layout.py) 좌표에
- 같은 애니메이션(바운스·지글지글)을 적용한다.
"""

from __future__ import annotations

import math
from typing import Dict, Tuple

from PIL import Image, ImageDraw, ImageFont

from . import layout as L
from .config import FONT_DIR
from .fonts import resolve_font_path
from .models import Cue, SubtitleStyle


def hex_to_rgb(color: str) -> Tuple[int, int, int]:
    c = color.strip().lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    if len(c) != 6:
        return (255, 255, 255)
    try:
        return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16))
    except ValueError:
        return (255, 255, 255)


def hex_to_rgba(color: str, alpha: float) -> Tuple[int, int, int, int]:
    r, g, b = hex_to_rgb(color)
    return (r, g, b, max(0, min(255, int(round(alpha * 255)))))


class FontCache:
    def __init__(self) -> None:
        self._fonts: Dict[Tuple[str, int], ImageFont.FreeTypeFont] = {}

    def get(self, path, size_px: float) -> ImageFont.FreeTypeFont:
        size = max(6, int(round(size_px)))
        key = (str(path), size)
        font = self._fonts.get(key)
        if font is None:
            font = ImageFont.truetype(str(path), size)
            self._fonts[key] = font
        return font


class SubtitleRenderer:
    """한 프레임 위에 자막 레이어를 합성한다."""

    def __init__(self, style: SubtitleStyle) -> None:
        self.style = style
        self.font_path = resolve_font_path(style.font, style.weight)
        self.cache = FontCache()
        self._color = hex_to_rgb(style.color)
        self._accent = hex_to_rgb(style.accent)
        self._stroke = hex_to_rgb(style.strokeColor)

    # ------------------------------------------------------------ helpers
    def measure_fn(self, size_px: float):
        font = self.cache.get(self.font_path, size_px)

        def measure(text: str) -> float:
            if not text:
                return 0.0
            return float(font.getlength(text))

        return measure

    def _font(self, size_px: float) -> ImageFont.FreeTypeFont:
        return self.cache.get(self.font_path, size_px)

    def _stroke_width(self, size_px: float) -> int:
        return max(0, int(round(self.style.strokeWidth * size_px)))

    # ------------------------------------------------------------ draw
    def draw(self, base: Image.Image, cues, t_out: float) -> Image.Image:
        """base(RGB) 위에 t_out 시점의 자막을 합성해 돌려준다."""
        active = [
            (i, cue)
            for i, cue in enumerate(cues)
            if cue.start - 0.001 <= t_out <= cue.end + 0.15
        ]
        if not active:
            return base

        overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        base_w, base_h = base.size

        for cue_index, cue in active:
            measure = self.measure_fn(self.style.fontSize / 100.0 * base_h)
            lay = L.compute_layout(cue, self.style, base_w, base_h, measure, cue_index)
            self._draw_cue(draw, overlay, lay, cue, cue_index, t_out)

        return Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB")

    def _draw_cue(self, draw, overlay, lay: L.CueLayout, cue: Cue, cue_index: int,
                  t_out: float) -> None:
        style = self.style
        t_rel = t_out - cue.start
        seed = L.fnv1a(cue.id)

        # 배경 박스
        if lay.box is not None:
            x, y, w, h = lay.box
            radius = max(0, int(round(style.boxRadius * lay.font_px)))
            draw.rounded_rectangle(
                (x, y, x + w, y + h),
                radius=radius,
                fill=hex_to_rgba(style.boxColor, style.boxOpacity),
            )

        if cue.words:
            words = [{"text": w.text, "start": w.start - cue.start, "end": w.end - cue.start}
                     for w in cue.words]
        else:
            words = [{"text": w["text"], "start": w["start"] - cue.start,
                      "end": w["end"] - cue.start} for w in L.words_fallback(cue)]
        active_word = None
        for wi, wd in enumerate(words):
            if wd["start"] <= t_rel < wd["end"]:
                active_word = wi
                break
        if active_word is None and words and t_rel >= words[-1]["end"]:
            active_word = len(words) - 1

        intensity = max(0.0, min(100.0, style.wobble)) / 100.0
        for li, line in enumerate(lay.lines):
            scale = 1.0
            if style.preset == "bounce":
                scale = L.bounce_scale(t_rel - li * 0.045)
                if scale <= 0.01:
                    continue
            line_center = line.start_x + line.width / 2.0

            for tok in line.tokens:
                is_active = (
                    style.preset == "highlight"
                    and active_word is not None
                    and tok.word_index == active_word
                )
                color = self._accent if is_active else self._color
                # 지글지글일 때는 단어 확대를 끄고(흔들림만), 아니면 강조 단어를 확대한다.
                extra = 1.0 if intensity > 0.001 else (style.highlightScale if is_active else 1.0)
                tok_scale = scale * extra
                # 확대는 단어 중심(강조) 또는 줄 중심(바운스)을 기준으로 해서
                # 옆 단어와의 간격이 무너지지 않게 한다.
                anchor = (tok.x + tok.w / 2.0) if is_active else line_center
                x = anchor + (tok.x - anchor) * tok_scale
                self._draw_token(draw, overlay, tok, x, line.baseline, lay.font_px,
                                 tok_scale, color, seed, t_out, cue_index)

    def _draw_token(self, draw, overlay, tok: L.Token, x: float, baseline: float,
                    font_px: float, scale: float, color, seed: int, t_abs: float,
                    cue_index: int) -> None:
        style = self.style
        intensity = max(0.0, min(100.0, style.wobble)) / 100.0
        size = font_px * scale
        stroke_w = self._stroke_width(size)

        if intensity > 0.001:
            # 글자 단위 지글지글: 글자마다 회전·이동·확대
            cx_pos = x
            for ci, ch in enumerate(tok.text):
                ch_w = float(self._font(size).getlength(ch))
                tr = L.char_transform(cue_index * 100000 + tok.word_index * 1000 + ci,
                                      seed, t_abs, intensity, font_px)
                cx = cx_pos + ch_w / 2.0 + tr.dx
                cy = baseline - font_px * 0.4 + tr.dy
                if abs(tr.rot) < 0.002:
                    draw.text((cx - ch_w / 2.0, baseline + tr.dy), ch,
                              font=self._font(size * tr.scale), fill=color,
                              anchor="ls", stroke_width=stroke_w, stroke_fill=self._stroke)
                else:
                    self._draw_char_tile(overlay, ch, cx, cy, size * tr.scale, tr.rot,
                                         color, stroke_w, font_px)
                cx_pos += ch_w
            return

        if style.shadow > 0.01:
            off = style.shadow * font_px
            draw.text((x, baseline + off), tok.text, font=self._font(size),
                      fill=(0, 0, 0, 120), anchor="ls", stroke_width=stroke_w,
                      stroke_fill=(0, 0, 0, 120))
        draw.text((x, baseline), tok.text, font=self._font(size), fill=color,
                  anchor="ls", stroke_width=stroke_w, stroke_fill=self._stroke)

    def _draw_char_tile(self, overlay, ch: str, cx: float, cy: float, size: float,
                        rot: float, color, stroke_w: int, font_px: float) -> None:
        if not ch.strip():
            return
        font = self._font(size)
        w = float(font.getlength(ch))
        tw = max(4, int(size * 2.0))
        th = max(4, int(size * 2.0))
        tile = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
        td = ImageDraw.Draw(tile)
        if self.style.shadow > 0.01:
            td.text((tw / 2.0 - w / 2.0, th / 2.0 + font_px * 0.4 + self.style.shadow * font_px),
                    ch, font=font, fill=(0, 0, 0, 120), anchor="ls",
                    stroke_width=stroke_w, stroke_fill=(0, 0, 0, 120))
        td.text((tw / 2.0 - w / 2.0, th / 2.0 + font_px * 0.4), ch, font=font, fill=color,
                anchor="ls", stroke_width=stroke_w, stroke_fill=self._stroke)
        rotated = tile.rotate(-math.degrees(rot), resample=Image.BICUBIC, center=(tw / 2.0, th / 2.0))
        overlay.alpha_composite(rotated, (int(round(cx - tw / 2.0)), int(round(cy - th / 2.0))))


def palette_for_preview(style: SubtitleStyle) -> dict:
    """프론트엔드 디버그용 색상 요약."""
    return {
        "color": hex_to_rgb(style.color),
        "accent": hex_to_rgb(style.accent),
        "stroke": hex_to_rgb(style.strokeColor),
        "font": str(resolve_font_path(style.font, style.weight).relative_to(FONT_DIR)),
    }


def sample_cue() -> Cue:
    return Cue(id="sample", start=0.0, end=1.0, text="자막 예시")
