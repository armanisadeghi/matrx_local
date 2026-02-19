#!/usr/bin/env bash
#
# Generate Tauri app icons from a source PNG.
#
# Usage:
#   ./scripts/generate-icons.sh [source.png]
#
# If no source is provided, generates placeholder icons.
# Requires: ImageMagick (convert command)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ICONS_DIR="$(dirname "$SCRIPT_DIR")/desktop/src-tauri/icons"
SOURCE="${1:-}"

mkdir -p "$ICONS_DIR"

if command -v convert &>/dev/null && [ -n "$SOURCE" ] && [ -f "$SOURCE" ]; then
    echo "Generating icons from $SOURCE..."
    convert "$SOURCE" -resize 32x32   "$ICONS_DIR/32x32.png"
    convert "$SOURCE" -resize 128x128 "$ICONS_DIR/128x128.png"
    convert "$SOURCE" -resize 256x256 "$ICONS_DIR/128x128@2x.png"
    convert "$SOURCE" -resize 256x256 "$ICONS_DIR/icon.png"

    # macOS .icns (if iconutil is available)
    if command -v iconutil &>/dev/null; then
        ICONSET="$ICONS_DIR/icon.iconset"
        mkdir -p "$ICONSET"
        for size in 16 32 64 128 256 512; do
            convert "$SOURCE" -resize "${size}x${size}" "$ICONSET/icon_${size}x${size}.png"
        done
        for size in 16 32 64 128 256; do
            double=$((size * 2))
            convert "$SOURCE" -resize "${double}x${double}" "$ICONSET/icon_${size}x${size}@2x.png"
        done
        iconutil -c icns "$ICONSET" -o "$ICONS_DIR/icon.icns"
        rm -rf "$ICONSET"
    fi

    # Windows .ico
    if command -v convert &>/dev/null; then
        convert "$SOURCE" -define icon:auto-resize=256,128,64,48,32,16 "$ICONS_DIR/icon.ico"
    fi

    echo "Icons generated in $ICONS_DIR"
else
    echo "No source image or ImageMagick not available."
    echo "Creating placeholder icons using Python..."

    python3 -c "
from PIL import Image, ImageDraw
import os

icons_dir = '$ICONS_DIR'

def create_icon(size, path):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Purple gradient background with rounded feel
    for y in range(size):
        r = int(124 + (167 - 124) * y / size)
        g = int(58 + (139 - 58) * y / size)
        b = int(237 + (250 - 237) * y / size)
        draw.line([(0, y), (size, y)], fill=(r, g, b, 255))
    # White 'M' letter
    m = size // 8
    pts = [
        (m*2, m*6), (m*2, m*2), (m*4, m*4), (m*6, m*2), (m*6, m*6)
    ]
    draw.line(pts, fill='white', width=max(size//16, 2))
    img.save(path)
    print(f'  Created: {path} ({size}x{size})')

create_icon(32, os.path.join(icons_dir, '32x32.png'))
create_icon(128, os.path.join(icons_dir, '128x128.png'))
create_icon(256, os.path.join(icons_dir, '128x128@2x.png'))
create_icon(256, os.path.join(icons_dir, 'icon.png'))
print('Placeholder icons created.')
" 2>/dev/null || echo "Could not generate placeholder icons (Pillow not installed). Add icons manually."
fi
