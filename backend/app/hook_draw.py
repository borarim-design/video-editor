"""상단 후킹 타이틀 + 집중선(스피드라인) 렌더링 — Pillow.

프론트엔드 `drawHook`(Canvas) 과 같은 좌표(layout.py compute_hook_layout)와
같은 폰트 파일을 쓴다. 기울임(skew)은 줄 타일을 회전해 그린다.
"""

from __future__ import annotations

import math
from typing import List, Optional, Tuple

from PIL import Image, ImageDraw

from . import layout as L
from .fonts import resolve_font_path
from .models import HookTitle, SpeedLines
from .subtitle_draw import FontCache, hex_to_rgb, hex_to_rgba


class HookRenderer:
    def __init__(self, hook: HookTitle) -> None:
        self.hook = hook
        self.main_path = resolve_font_path(hook.font, hook.weight)
        self.cache = FontCache()

    # ------------------------------------------------------------ helpers
    def active(self, t_out: float, duration: float) -> bool:
        h = self.hook
        if not h.enabled:
            return False
        start = 0.0 if h.start is None else h.start
        end = duration if h.end is None else h.end
        return start - 1e-6 <= t_out <= end + 1e-6

    def _font(self, size: float):
        return self.cache.get(self.main_path, size)

    def _measure(self, size: float):
        font = self._font(size)

        def fn(text: str) -> float:
            return float(font.getlength(text)) if text else 0.0

        return fn

    # ------------------------------------------------------------ draw
    def draw(self, base: Image.Image, t_out: float, duration: float) -> Image.Image:
        if not self.active(t_out, duration):
            return base
        hook = self.hook
        if not hook.title.strip() and not hook.subtext.strip() and not hook.speedLines.enabled:
            return base

        W, H = base.size
        overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        if hook.speedLines.enabled:
            self._draw_speed_lines(draw, W, H, hook.speedLines)

        lay = L.compute_hook_layout(hook, W, H, self._measure(lay_font_size(hook, H, True)),
                                    self._measure(lay_font_size(hook, H, False)))

        if lay.box is not None:
            x, y, w, h = lay.box
            radius = max(0, int(round(hook.boxRadius * lay.font_px)))
            draw.rounded_rectangle((x, y, x + w, y + h), radius=radius,
                                   fill=hex_to_rgba(hook.boxColor, hook.boxOpacity))

        if lay.pill is not None:
            x, y, w, h = lay.pill
            radius = int(round(h / 2))
            draw.rounded_rectangle((x, y, x + w, y + h), radius=radius,
                                   fill=hex_to_rgba(hook.pillColor, hook.pillOpacity))
            self._draw_words(draw, hook.subtext.strip(), x + w / 2.0, lay.sub_baseline,
                             lay.sub_px, hex_to_rgb(hook.subColor), 0)

        for line in lay.lines:
            color = hex_to_rgb(hook.accent if line.is_accent else hook.color)
            self._draw_line(overlay, line, lay.font_px, color, W)

        return Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB")

    def _draw_speed_lines(self, draw: ImageDraw.ImageDraw, W: int, H: int,
                          cfg: SpeedLines) -> None:
        fill = hex_to_rgba(cfg.color, cfg.opacity)
        for poly in L.speed_line_polys(W, H, cfg):
            draw.polygon(poly, fill=fill)

    def _draw_words(self, draw: ImageDraw.ImageDraw, text: str, center_x: float,
                    baseline: float, size_px: float, color: Tuple[int, int, int],
                    stroke_w: int) -> None:
        """단어를 하나씩 그린다(폰트에 U+0020 글리프가 없어도 안전)."""
        words = L.split_words(text)
        if not words:
            return
        font = self._font(size_px)
        space = size_px * L.SPACE_ADVANCE
        widths = [float(font.getlength(w)) for w in words]
        total = sum(widths) + space * max(0, len(words) - 1)
        x = center_x - total / 2.0
        for w, ww in zip(words, widths):
            draw.text((x, baseline), w, font=font, fill=color, anchor="ls",
                      stroke_width=stroke_w, stroke_fill=hex_to_rgb(self.hook.strokeColor))
            x += ww + space

    def _draw_line(self, overlay: Image.Image, line: L.HookLine, font_px: float,
                   color: Tuple[int, int, int], W: int) -> None:
        hook = self.hook
        font = self._font(font_px)
        stroke_w = max(0, int(round(hook.strokeWidth * font_px)))
        text_w = line.width
        tile_w = int(text_w + font_px * 0.9) + 8
        tile_h = int(font_px * 2.0) + 8
        tile = Image.new("RGBA", (max(4, tile_w), max(4, tile_h)), (0, 0, 0, 0))
        td = ImageDraw.Draw(tile)
        cx, cy = tile.width / 2.0, tile.height / 2.0
        self._draw_words(td, line.text, cx, cy + font_px * 0.35, font_px, color, stroke_w)

        if abs(hook.skew) > 0.01:
            tile = tile.rotate(-hook.skew, resample=Image.BICUBIC, center=(cx, cy))

        pivot_x = W / 2.0
        pivot_y = line.baseline - font_px * 0.35
        overlay.alpha_composite(tile, (int(round(pivot_x - tile.width / 2.0)),
                                       int(round(pivot_y - tile.height / 2.0))))


def lay_font_size(hook: HookTitle, canvas_h: float, main: bool) -> float:
    pct = hook.fontSize if main else hook.subSize
    floor = 6.0 if main else 4.0
    return max(floor, pct / 100.0 * canvas_h)
