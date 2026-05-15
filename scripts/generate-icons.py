#!/usr/bin/env python3
"""Generate Pilcrow app icons from the project's Newsreader serif glyph.

Outputs (all PNG, sRGB, premultiplied alpha as PIL writes it):
- assets/icon.png             1024x1024  rounded square, accent bg, cream glyph
- assets/adaptive-icon.png    1024x1024  Android adaptive foreground, transparent bg
                                         (Expo composites against android.adaptiveIcon.backgroundColor)
- assets/splash-icon.png      1024x1024  centered glyph on transparent bg
- assets/favicon.png            48x48    same composition, downscaled

Run:  pnpm tsx scripts/generate-icons.py   # or:  python3 scripts/generate-icons.py
"""
from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
FONT_PATH = ASSETS / "fonts" / "Newsreader.ttf"

ACCENT = (193, 41, 27, 255)        # #c1291b — light-palette accent
CREAM = (251, 248, 244, 255)       # #fbf8f4 — light-palette bg
TRANSPARENT = (0, 0, 0, 0)


def render_glyph(size: int, color: tuple[int, int, int, int]) -> Image.Image:
    """Render '¶' centered on a transparent canvas of (size, size)."""
    canvas = Image.new("RGBA", (size, size), TRANSPARENT)
    draw = ImageDraw.Draw(canvas)

    # Find the font size that makes the glyph fill ~56% of the canvas height —
    # tight enough to feel confident, loose enough to survive 48px favicons and
    # Android's 66% safe-zone crop.
    target = int(size * 0.56)
    font_size = target
    for _ in range(40):
        font = ImageFont.truetype(str(FONT_PATH), font_size)
        x0, y0, x1, y1 = font.getbbox("¶")
        glyph_h = y1 - y0
        if glyph_h >= target:
            break
        font_size += max(1, (target - glyph_h) // 2)
    font = ImageFont.truetype(str(FONT_PATH), font_size)
    x0, y0, x1, y1 = font.getbbox("¶")
    glyph_w = x1 - x0
    glyph_h = y1 - y0
    # Center using the glyph's own bbox so optical centering is honest.
    x = (size - glyph_w) / 2 - x0
    y = (size - glyph_h) / 2 - y0
    draw.text((x, y), "¶", fill=color, font=font)
    return canvas


def rounded_square(size: int, color: tuple[int, int, int, int], radius_ratio: float = 0.22) -> Image.Image:
    """Solid rounded square — used as the iOS-style icon background."""
    canvas = Image.new("RGBA", (size, size), TRANSPARENT)
    ImageDraw.Draw(canvas).rounded_rectangle(
        (0, 0, size - 1, size - 1),
        radius=int(size * radius_ratio),
        fill=color,
    )
    return canvas


def make_icon(size: int = 1024) -> Image.Image:
    bg = rounded_square(size, ACCENT)
    glyph = render_glyph(size, CREAM)
    bg.alpha_composite(glyph)
    return bg


def make_adaptive(size: int = 1024) -> Image.Image:
    """Android adaptive foreground: glyph only, with a safe-zone margin.

    Android masks the foreground inside a 66% safe circle; shrink the glyph so
    it survives that crop on round-icon launchers.
    """
    foreground = Image.new("RGBA", (size, size), TRANSPARENT)
    inner = int(size * 0.66)
    glyph = render_glyph(inner, CREAM)
    # Paint a soft accent disc behind the glyph so the adaptive foreground
    # reads on its own when launchers render it without a backgroundColor.
    disc = Image.new("RGBA", (size, size), TRANSPARENT)
    pad = (size - inner) // 2
    ImageDraw.Draw(disc).ellipse((pad, pad, pad + inner - 1, pad + inner - 1), fill=ACCENT)
    foreground.alpha_composite(disc)
    foreground.alpha_composite(glyph, ((size - inner) // 2, (size - inner) // 2))
    return foreground


def make_splash(size: int = 1024) -> Image.Image:
    """Splash glyph on transparent — Expo paints the configured splash background."""
    return render_glyph(size, ACCENT)


def main() -> None:
    icon = make_icon(1024)
    icon.save(ASSETS / "icon.png", optimize=True)

    adaptive = make_adaptive(1024)
    adaptive.save(ASSETS / "adaptive-icon.png", optimize=True)

    splash = make_splash(1024)
    splash.save(ASSETS / "splash-icon.png", optimize=True)

    # Favicon: render the rounded-square icon at high res then downscale once
    # for a crisp 48px result.
    favicon = make_icon(384).resize((48, 48), Image.LANCZOS)
    favicon.save(ASSETS / "favicon.png", optimize=True)

    for name in ("icon.png", "adaptive-icon.png", "splash-icon.png", "favicon.png"):
        path = ASSETS / name
        print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
