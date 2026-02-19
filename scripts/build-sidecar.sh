#!/usr/bin/env bash
#
# Build the Python/FastAPI engine as a standalone sidecar binary.
#
# This uses PyInstaller to create a single-file executable that Tauri
# can spawn as a managed child process. The binary is placed in
# desktop/src-tauri/sidecar/ with platform-specific naming.
#
# Usage:
#   ./scripts/build-sidecar.sh
#
# Prerequisites:
#   pip install pyinstaller
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SIDECAR_DIR="$PROJECT_ROOT/desktop/src-tauri/sidecar"

# Detect platform triple
detect_target() {
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"

    case "$os" in
        Linux)
            case "$arch" in
                x86_64)  echo "x86_64-unknown-linux-gnu" ;;
                aarch64) echo "aarch64-unknown-linux-gnu" ;;
                *)       echo "unknown-linux" ;;
            esac
            ;;
        Darwin)
            case "$arch" in
                x86_64)  echo "x86_64-apple-darwin" ;;
                arm64)   echo "aarch64-apple-darwin" ;;
                *)       echo "unknown-darwin" ;;
            esac
            ;;
        MINGW*|MSYS*|CYGWIN*)
            echo "x86_64-pc-windows-msvc"
            ;;
        *)
            echo "unknown-platform"
            ;;
    esac
}

TARGET="$(detect_target)"
BINARY_NAME="aimatrx-engine-$TARGET"

# On Windows, add .exe extension
case "$TARGET" in
    *windows*) BINARY_NAME="$BINARY_NAME.exe" ;;
esac

echo "=== Building AI Matrx Engine Sidecar ==="
echo "Target: $TARGET"
echo "Output: $SIDECAR_DIR/$BINARY_NAME"
echo ""

# Create output directory
mkdir -p "$SIDECAR_DIR"

# Build with PyInstaller
cd "$PROJECT_ROOT"

PYTHON="$PROJECT_ROOT/.venv/bin/python"
if [[ ! -f "$PYTHON" ]]; then
    echo "ERROR: .venv not found. Run 'uv sync' first."
    exit 1
fi

echo "Running PyInstaller (using $PYTHON)..."
"$PYTHON" -m PyInstaller \
    --name "aimatrx-engine-$TARGET" \
    --onefile \
    --clean \
    --noconfirm \
    --hidden-import uvicorn \
    --hidden-import uvicorn.logging \
    --hidden-import uvicorn.loops \
    --hidden-import uvicorn.loops.auto \
    --hidden-import uvicorn.protocols \
    --hidden-import uvicorn.protocols.http \
    --hidden-import uvicorn.protocols.http.auto \
    --hidden-import uvicorn.protocols.websockets \
    --hidden-import uvicorn.protocols.websockets.auto \
    --hidden-import uvicorn.lifespan \
    --hidden-import uvicorn.lifespan.on \
    --hidden-import httptools \
    --hidden-import pydantic \
    --hidden-import fastapi \
    --hidden-import websockets \
    --hidden-import httpx \
    --hidden-import curl_cffi \
    --hidden-import bs4 \
    --hidden-import lxml \
    --hidden-import selectolax \
    --hidden-import asyncpg \
    --hidden-import cachetools \
    --hidden-import tldextract \
    --hidden-import markdownify \
    --hidden-import tabulate \
    --hidden-import fitz \
    --hidden-import pytesseract \
    --add-data "app:app" \
    --add-data "scraper-service/app:scraper-service/app" \
    run.py

# Copy to sidecar directory
echo "Copying binary to sidecar directory..."
cp "dist/aimatrx-engine-$TARGET"* "$SIDECAR_DIR/"

echo ""
echo "=== Build Complete ==="
echo "Binary: $SIDECAR_DIR/$BINARY_NAME"
ls -lh "$SIDECAR_DIR/$BINARY_NAME"
