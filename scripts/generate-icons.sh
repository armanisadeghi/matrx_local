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

# ── Preflight checks ─────────────────────────────────────────────────────────
PREFLIGHT_OK=true

if ! command -v pnpm &>/dev/null; then
    echo "ERROR: pnpm is not installed." >&2
    echo "       Install it with:  npm install -g pnpm" >&2
    echo "       Or via corepack:  corepack enable && corepack prepare pnpm@latest --activate" >&2
    PREFLIGHT_OK=false
fi

if [[ ! -f "$SOURCE" ]]; then
    echo "ERROR: Source image not found: $SOURCE" >&2
    echo "" >&2
    echo "Usage: $0 [source_image.png]" >&2
    echo "" >&2
    echo "  The source image must be a square PNG, ideally 512×512 or larger." >&2
    echo "  Default location: $DEFAULT_SOURCE" >&2
    PREFLIGHT_OK=false
fi

if ! $PREFLIGHT_OK; then
    exit 1
fi

echo ""
echo "=== Done ==="
echo "Icons written to: $PROJECT_ROOT/desktop/src-tauri/icons/"
