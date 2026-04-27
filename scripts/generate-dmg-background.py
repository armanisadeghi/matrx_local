#!/usr/bin/env python3
"""Regenerate the macOS DMG installer background image.

Run with:  uv run --with pillow python3 scripts/generate-dmg-background.py

Tauri overlays the .app icon at (180, 200) and the Applications symlink at
(480, 200) on top of this background. Coordinates here must match
tauri.conf.json -> bundle.macOS.dmg.appPosition / applicationFolderPosition.
"""
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "desktop" / "src-tauri" / "icons"

BASE_W, BASE_H = 660, 400
APP_X, APP_Y = 180, 200
APPS_X, APPS_Y = 480, 200


def render(scale: int) -> Image.Image:
    w, h = BASE_W * scale, BASE_H * scale
    img = Image.new("RGB", (w, h), (244, 244, 247))

    # Soft vertical gradient: top #f6f6fa -> bottom #e9eaf0
    top = (246, 246, 250)
    bot = (233, 234, 240)
    px = img.load()
    for y in range(h):
        t = y / (h - 1)
        r = round(top[0] + (bot[0] - top[0]) * t)
        g = round(top[1] + (bot[1] - top[1]) * t)
        b = round(top[2] + (bot[2] - top[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b)

    draw = ImageDraw.Draw(img, "RGBA")

    # Center between the two icon positions
    cx = ((APP_X + APPS_X) // 2) * scale
    cy = APP_Y * scale

    # Chevron pointing right, drawn as two thick strokes (›)
    arm = 28 * scale
    thickness = 8 * scale
    color = (155, 158, 175, 220)
    # Upper arm
    draw.line(
        [(cx - arm // 2, cy - arm), (cx + arm // 2, cy)],
        fill=color,
        width=thickness,
    )
    # Lower arm
    draw.line(
        [(cx + arm // 2, cy), (cx - arm // 2, cy + arm)],
        fill=color,
        width=thickness,
    )

    # Faint rounded "plates" under each icon position so the icons feel grounded
    plate_w, plate_h = 140 * scale, 140 * scale
    plate_color = (255, 255, 255, 110)

    def plate(center_x: int, center_y: int) -> None:
        x0 = center_x - plate_w // 2
        y0 = center_y - plate_h // 2
        x1 = center_x + plate_w // 2
        y1 = center_y + plate_h // 2
        draw.rounded_rectangle(
            [x0, y0, x1, y1],
            radius=24 * scale,
            fill=plate_color,
        )

    plate(APP_X * scale, APP_Y * scale)
    plate(APPS_X * scale, APPS_Y * scale)

    return img


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    base = render(1)
    retina = render(2)
    base.save(OUT_DIR / "dmg-background.png", optimize=True)
    retina.save(OUT_DIR / "dmg-background@2x.png", optimize=True)
    print(f"Wrote {OUT_DIR / 'dmg-background.png'} ({base.size[0]}x{base.size[1]})")
    print(f"Wrote {OUT_DIR / 'dmg-background@2x.png'} ({retina.size[0]}x{retina.size[1]})")


if __name__ == "__main__":
    main()
