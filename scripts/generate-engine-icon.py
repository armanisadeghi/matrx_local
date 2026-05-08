#!/usr/bin/env python3
"""Generate the Matrx Engine icon at every size needed by the build pipeline.

Inputs:  none — the icon is drawn programmatically with Pillow primitives so
         we don't need an SVG-to-raster toolchain (rsvg / cairosvg / ImageMagick).
         The matching SVG at desktop/src-tauri/icons/engine-icon.svg is the
         human-editable source of truth; this script reproduces the same
         shapes so the SVG and the rasters cannot drift.

Outputs (under desktop/src-tauri/icons/):
  engine-icon.png          (1024 × 1024 — universal master)
  engine-icon-32.png       (32 × 32)
  engine-icon-128.png      (128 × 128)
  engine-icon-128@2x.png   (256 × 256, retina)
  engine-icon.icns         (macOS — generated via iconutil if available)
  engine-icon.ico          (Windows — multi-resolution)

The .icns step requires `iconutil` (ships with macOS).  On Linux/Windows the
script skips the .icns generation; CI runs this on macOS so the .icns is
always present in the committed icons/ folder.

Usage:
    uv run python scripts/generate-engine-icon.py
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICONS_DIR = ROOT / "desktop" / "src-tauri" / "icons"

# ── Colours (must match engine-icon.svg) ─────────────────────────────────────
WHITE = (255, 255, 255, 255)
BLACK = (0, 0, 0, 255)
RED = (227, 6, 19, 255)


def draw_engine_icon(size: int) -> Image.Image:
    """Render the engine icon at *size* × *size* pixels.

    The geometry is defined in a 512 × 512 reference frame (matching the SVG)
    and scaled linearly to the requested output size.  Drawing in the larger
    reference frame and resizing produces sharper rasters than drawing
    natively at small sizes.
    """
    ref = 512
    img = Image.new("RGBA", (ref, ref), WHITE)
    draw = ImageDraw.Draw(img)

    # Heavy black border — drawn as four black rectangles so the corners
    # are perfectly square (PIL's stroke=... can produce subpixel artifacts
    # at small sizes).
    border = 32
    draw.rectangle((0, 0, ref, border), fill=BLACK)
    draw.rectangle((0, ref - border, ref, ref), fill=BLACK)
    draw.rectangle((0, 0, border, ref), fill=BLACK)
    draw.rectangle((ref - border, 0, ref, ref), fill=BLACK)

    # Three stacked "server rack" bars
    bar_x0, bar_x1 = 56, 456
    bar_h = 96
    bar_specs = [
        (80, RED),     # top
        (208, BLACK),  # middle
        (336, RED),    # bottom
    ]
    for y0, colour in bar_specs:
        draw.rectangle((bar_x0, y0, bar_x1, y0 + bar_h), fill=colour)
        # Two white "status" squares on each bar, vertically centred
        for ix in (80, 128):
            draw.rectangle((ix, y0 + 32, ix + 32, y0 + 64), fill=WHITE)

    if size != ref:
        # LANCZOS for sharp downsampling at small sizes (32, 16)
        img = img.resize((size, size), Image.Resampling.LANCZOS)

    return img


def write_pngs() -> dict[int, Path]:
    """Render the master + every PNG variant the build pipeline needs."""
    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    sizes = {
        16: ICONS_DIR / "engine-icon-16.png",
        32: ICONS_DIR / "engine-icon-32.png",
        64: ICONS_DIR / "engine-icon-64.png",
        128: ICONS_DIR / "engine-icon-128.png",
        256: ICONS_DIR / "engine-icon-128@2x.png",
        512: ICONS_DIR / "engine-icon-512.png",
        1024: ICONS_DIR / "engine-icon.png",
    }

    out: dict[int, Path] = {}
    for size, path in sizes.items():
        img = draw_engine_icon(size)
        img.save(path, "PNG")
        out[size] = path
        print(f"  ✓ {path.name} ({size}×{size})")
    return out


def write_icns(pngs: dict[int, Path]) -> Path | None:
    """Build a macOS .icns from the rendered PNGs using iconutil.

    iconutil requires a directory laid out exactly like Apple's .iconset:
      icon_16x16.png        (16)
      [email protected]     (32)
      icon_32x32.png        (32)
      [email protected]     (64)
      icon_128x128.png      (128)
      [email protected]    (256)
      icon_256x256.png      (256)
      [email protected]    (512)
      icon_512x512.png      (512)
      [email protected]    (1024)
    """
    if shutil.which("iconutil") is None:
        print("  ⚠  iconutil not available — skipping .icns "
              "(run on macOS to generate engine-icon.icns)")
        return None

    iconset_layout = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }

    with tempfile.TemporaryDirectory() as tmp:
        iconset_dir = Path(tmp) / "engine-icon.iconset"
        iconset_dir.mkdir()

        for name, size in iconset_layout.items():
            target = iconset_dir / name
            # Reuse pre-rendered PNGs where the size matches, otherwise
            # render fresh at the exact requested resolution.
            if size in pngs:
                shutil.copy2(pngs[size], target)
            else:
                draw_engine_icon(size).save(target, "PNG")

        out_path = ICONS_DIR / "engine-icon.icns"
        result = subprocess.run(
            ["iconutil", "-c", "icns", "-o", str(out_path), str(iconset_dir)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"  ✗ iconutil failed:\n{result.stderr}")
            return None
        print(f"  ✓ {out_path.name}")
        return out_path


def write_ico(pngs: dict[int, Path]) -> Path:
    """Build a multi-resolution Windows .ico containing 16/32/48/64/128/256."""
    sizes = [16, 32, 48, 64, 128, 256]
    images = []
    for s in sizes:
        if s in pngs:
            images.append(Image.open(pngs[s]))
        else:
            images.append(draw_engine_icon(s))

    out_path = ICONS_DIR / "engine-icon.ico"
    images[0].save(
        out_path,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=images[1:],
    )
    print(f"  ✓ {out_path.name}")
    return out_path


def main() -> None:
    print(f"Generating engine icon assets → {ICONS_DIR}")
    pngs = write_pngs()
    write_icns(pngs)
    write_ico(pngs)
    print("Done.")


if __name__ == "__main__":
    sys.exit(main())
