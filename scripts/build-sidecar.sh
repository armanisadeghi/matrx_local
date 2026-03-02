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

# Resolve the venv Python — always use it directly so we control the env.
# (uv run would re-sync before running, which reinstalls the bogus `fitz`
# package pulled in by matrx-utils, which drags in pathlib — incompatible
# with PyInstaller on Python 3.13+.)
# Detect venv Python — differs between Unix (.venv/bin/python) and
# Windows/MSYS (.venv/Scripts/python.exe).
detect_venv_python() {
    if [[ -f "$PROJECT_ROOT/.venv/bin/python" ]]; then
        echo "$PROJECT_ROOT/.venv/bin/python"
    elif [[ -f "$PROJECT_ROOT/.venv/Scripts/python.exe" ]]; then
        echo "$PROJECT_ROOT/.venv/Scripts/python.exe"
    else
        echo ""
    fi
}

PYTHON="$(detect_venv_python)"
if [[ -z "$PYTHON" ]]; then
    if command -v uv &>/dev/null; then
        echo "  → .venv not found — running 'uv sync --extra all' first..."
        uv sync --extra all
    else
        echo "ERROR: .venv not found. Run 'uv sync' first."
        exit 1
    fi
    PYTHON="$(detect_venv_python)"
    if [[ -z "$PYTHON" ]]; then
        echo "ERROR: .venv Python not found after uv sync."
        exit 1
    fi
fi

# Remove the obsolete 'pathlib' backport that matrx-utils pulls in via fitz →
# nipype → pyxnat. Python 3.13 ships pathlib as stdlib; the backport breaks
# PyInstaller. Safe to remove: nothing in this project actually imports it.
if "$PYTHON" -c "import importlib.metadata; importlib.metadata.version('pathlib')" &>/dev/null 2>&1; then
    echo "  → Removing incompatible 'pathlib' backport (replaced by stdlib)..."
    "$PYTHON" -m pip uninstall pathlib -y --quiet
fi

PYTHON_CMD="$PYTHON"

echo "Running PyInstaller (using $PYTHON_CMD)..."
$PYTHON_CMD -m PyInstaller \
    --name "aimatrx-engine-$TARGET" \
    --onefile \
    --clean \
    --noconfirm \
    --exclude-module torch \
    --exclude-module torchvision \
    --exclude-module torchaudio \
    --exclude-module tensorflow \
    --exclude-module tensorboard \
    --exclude-module triton \
    --exclude-module scipy \
    --exclude-module nipype \
    --exclude-module nibabel \
    --exclude-module pyxnat \
    --exclude-module openai_whisper \
    --exclude-module whisper \
    --exclude-module matplotlib \
    --exclude-module sklearn \
    --exclude-module skimage \
    --exclude-module cv2 \
    --exclude-module IPython \
    --exclude-module ipykernel \
    --exclude-module jupyter \
    --exclude-module ipywidgets \
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
    --hidden-import app.tools.tools.system \
    --hidden-import app.tools.tools.file_ops \
    --hidden-import app.tools.tools.clipboard \
    --hidden-import app.tools.tools.execution \
    --hidden-import app.tools.tools.network \
    --hidden-import app.tools.tools.notify \
    --hidden-import app.tools.tools.transfer \
    --hidden-import app.tools.tools.process_manager \
    --hidden-import app.tools.tools.window_manager \
    --hidden-import app.tools.tools.input_automation \
    --hidden-import app.tools.tools.audio \
    --hidden-import app.tools.tools.browser_automation \
    --hidden-import app.tools.tools.network_discovery \
    --hidden-import app.tools.tools.system_monitor \
    --hidden-import app.tools.tools.file_watch \
    --hidden-import app.tools.tools.app_integration \
    --hidden-import app.tools.tools.scheduler \
    --hidden-import app.tools.tools.media \
    --hidden-import app.tools.tools.wifi_bluetooth \
    --hidden-import pydantic_settings \
    --hidden-import psutil \
    --hidden-import zeroconf \
    --hidden-import watchfiles \
    --hidden-import sounddevice \
    --hidden-import soundfile \
    --hidden-import pynput \
    --hidden-import playwright \
    --hidden-import playwright.async_api \
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
