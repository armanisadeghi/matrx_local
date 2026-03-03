#!/usr/bin/env bash
#
# Generate Tauri app icons from a source PNG or SVG.
#
# Uses the official `pnpm tauri icon` command, which is the correct
# way to generate all platform icons (Windows, macOS, Linux, iOS, Android).
#
# Usage:
#   ./scripts/generate-icons.sh [source_image]
#
# If no source is provided, defaults to the existing android-chrome-512x512.png
# in desktop/src-tauri/icons/.
#
# Requirements:
#   - pnpm (installed in desktop/)
#   - Source image should be a square PNG (ideally 512×512 or larger)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEFAULT_SOURCE="$PROJECT_ROOT/desktop/src-tauri/icons/android-chrome-512x512.png"
SOURCE="${1:-$DEFAULT_SOURCE}"

if [[ ! -f "$SOURCE" ]]; then
    echo "ERROR: Source image not found: $SOURCE"
    echo ""
    echo "Usage: $0 [source_image.png]"
    exit 1
fi

echo "=== Generating Tauri Icons ==="
echo "Source: $SOURCE"
echo ""

cd "$PROJECT_ROOT/desktop"
pnpm tauri icon "$SOURCE"

echo ""
echo "=== Done ==="
echo "Icons written to: $PROJECT_ROOT/desktop/src-tauri/icons/"
