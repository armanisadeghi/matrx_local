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
#   ./scripts/build-sidecar.sh --target x86_64-apple-darwin
#
# Prerequisites:
#   pip install pyinstaller playwright
#   playwright install  (or run: playwright install chromium firefox webkit)
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

# Parse arguments — allow CI to override the auto-detected target triple
OVERRIDE_TARGET=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --target) OVERRIDE_TARGET="$2"; shift 2 ;;
        *)        shift ;;
    esac
done

TARGET="${OVERRIDE_TARGET:-$(detect_target)}"
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

# ---------------------------------------------------------------------------
# Step 2: Gather tessdata (Tesseract language data files)
# ---------------------------------------------------------------------------
echo ""
echo "=== Gathering Tesseract Data ==="
TESSDATA_ARG=""
TESSDATA_PATH="$("$PYTHON_CMD" -c "
import subprocess, sys
try:
    import pytesseract
    prefix = pytesseract.get_tessdata_prefix()
    print(prefix.rstrip('/'))
except Exception:
    # Try common system paths
    import os, platform
    candidates = []
    if platform.system() == 'Linux':
        candidates = ['/usr/share/tesseract-ocr/5/tessdata', '/usr/share/tesseract-ocr/4.00/tessdata', '/usr/share/tessdata']
    elif platform.system() == 'Darwin':
        candidates = ['/usr/local/share/tessdata', '/opt/homebrew/share/tessdata']
    for c in candidates:
        if os.path.isdir(c):
            print(c)
            break
" 2>/dev/null || echo "")"

if [[ -n "$TESSDATA_PATH" && -d "$TESSDATA_PATH" ]]; then
    echo "  → Bundling tessdata from: $TESSDATA_PATH"
    TESSDATA_ARG="--add-data \"$TESSDATA_PATH:tessdata\""
else
    echo "  → Tesseract data not found locally — OCR will require system Tesseract"
fi

# ---------------------------------------------------------------------------
# Step 3: Locate imageio-ffmpeg binary for PATH injection
# ---------------------------------------------------------------------------
FFMPEG_DIR="$("$PYTHON_CMD" -c "
import imageio_ffmpeg, os
ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
print(os.path.dirname(ffmpeg_exe))
" 2>/dev/null || echo "")"

if [[ -n "$FFMPEG_DIR" ]]; then
    echo "=== imageio-ffmpeg binary found: $FFMPEG_DIR ==="
fi

# ---------------------------------------------------------------------------
# Step 4: Run PyInstaller
# ---------------------------------------------------------------------------
echo ""
echo "Running PyInstaller (using $PYTHON_CMD)..."
echo "  → Playwright browsers will be auto-installed at runtime (not bundled)"

# Write the PyInstaller command to a temp file to avoid arg-quoting issues
PYINSTALLER_CMD_FILE="$(mktemp)"
cat > "$PYINSTALLER_CMD_FILE" << 'PYINSTALLER_EOF'
import subprocess, sys, os

args = [
    sys.executable, "-m", "PyInstaller",
    "--name", os.environ["BINARY_NAME"],
    "--onefile",
    "--clean",
    "--noconfirm",
    # ---- Runtime hook: sets env vars for bundled tools ----
    "--runtime-hook", "hooks/runtime_hook.py",
    # ---- Exclusions (heavy ML/audio models not needed) ----
    "--exclude-module", "torch",
    "--exclude-module", "torchvision",
    "--exclude-module", "torchaudio",
    "--exclude-module", "tensorflow",
    "--exclude-module", "tensorboard",
    "--exclude-module", "triton",
    "--exclude-module", "scipy",
    "--exclude-module", "nipype",
    "--exclude-module", "nibabel",
    "--exclude-module", "pyxnat",
    "--exclude-module", "openai_whisper",
    "--exclude-module", "whisper",
    "--exclude-module", "matplotlib",
    "--exclude-module", "sklearn",
    "--exclude-module", "skimage",
    "--exclude-module", "cv2",
    "--exclude-module", "IPython",
    "--exclude-module", "ipykernel",
    "--exclude-module", "jupyter",
    "--exclude-module", "ipywidgets",
    # ---- Hidden imports: uvicorn internals ----
    "--hidden-import", "uvicorn",
    "--hidden-import", "uvicorn.logging",
    "--hidden-import", "uvicorn.loops",
    "--hidden-import", "uvicorn.loops.auto",
    "--hidden-import", "uvicorn.protocols",
    "--hidden-import", "uvicorn.protocols.http",
    "--hidden-import", "uvicorn.protocols.http.auto",
    "--hidden-import", "uvicorn.protocols.websockets",
    "--hidden-import", "uvicorn.protocols.websockets.auto",
    "--hidden-import", "uvicorn.lifespan",
    "--hidden-import", "uvicorn.lifespan.on",
    "--hidden-import", "httptools",
    # ---- Hidden imports: web/data libs ----
    "--hidden-import", "pydantic",
    "--hidden-import", "fastapi",
    "--hidden-import", "websockets",
    "--hidden-import", "httpx",
    "--hidden-import", "curl_cffi",
    "--hidden-import", "bs4",
    "--hidden-import", "lxml",
    "--hidden-import", "selectolax",
    "--hidden-import", "asyncpg",
    "--hidden-import", "cachetools",
    "--hidden-import", "tldextract",
    "--hidden-import", "markdownify",
    "--hidden-import", "tabulate",
    "--hidden-import", "fitz",
    "--hidden-import", "pytesseract",
    # ---- Hidden imports: Playwright (all browsers) ----
    "--hidden-import", "playwright",
    "--hidden-import", "playwright.async_api",
    "--hidden-import", "playwright.sync_api",
    "--hidden-import", "playwright._impl._driver",
    # ---- Hidden imports: media / ffmpeg / yt-dlp ----
    "--hidden-import", "yt_dlp",
    "--hidden-import", "yt_dlp.extractor",
    "--hidden-import", "yt_dlp.downloader",
    "--hidden-import", "yt_dlp.postprocessor",
    "--hidden-import", "yt_dlp.utils",
    "--hidden-import", "imageio_ffmpeg",
    # ---- Hidden imports: system / monitoring ----
    "--hidden-import", "psutil",
    "--hidden-import", "pydantic_settings",
    "--hidden-import", "zeroconf",
    "--hidden-import", "watchfiles",
    "--hidden-import", "sounddevice",
    "--hidden-import", "soundfile",
    "--hidden-import", "pynput",
    # ---- Hidden imports: tool modules ----
    "--hidden-import", "app.tools.tools.system",
    "--hidden-import", "app.tools.tools.file_ops",
    "--hidden-import", "app.tools.tools.clipboard",
    "--hidden-import", "app.tools.tools.execution",
    "--hidden-import", "app.tools.tools.network",
    "--hidden-import", "app.tools.tools.notify",
    "--hidden-import", "app.tools.tools.transfer",
    "--hidden-import", "app.tools.tools.process_manager",
    "--hidden-import", "app.tools.tools.window_manager",
    "--hidden-import", "app.tools.tools.input_automation",
    "--hidden-import", "app.tools.tools.audio",
    "--hidden-import", "app.tools.tools.browser_automation",
    "--hidden-import", "app.tools.tools.network_discovery",
    "--hidden-import", "app.tools.tools.system_monitor",
    "--hidden-import", "app.tools.tools.file_watch",
    "--hidden-import", "app.tools.tools.app_integration",
    "--hidden-import", "app.tools.tools.scheduler",
    "--hidden-import", "app.tools.tools.media",
    "--hidden-import", "app.tools.tools.wifi_bluetooth",
    "--hidden-import", "pydantic_settings",
    # ---- Data files: app source ----
    "--add-data", "app:app",
    "--add-data", "scraper-service/app:scraper-service/app",
]

# Tesseract data
tessdata = os.environ.get("TESSDATA_PATH_ARG", "")
if tessdata:
    args += ["--add-data", tessdata]

args.append("run.py")

print("Running:", " ".join(args))
result = subprocess.run(args)
sys.exit(result.returncode)
PYINSTALLER_EOF

# Set env vars for the Python script
export BINARY_NAME="aimatrx-engine-$TARGET"
if [[ -n "${TESSDATA_PATH:-}" && -d "$TESSDATA_PATH" ]]; then
    export TESSDATA_PATH_ARG="$TESSDATA_PATH:tessdata"
fi

# ── macOS code signing: re-sign Python dylibs AT SOURCE before PyInstaller ──
#
# ROOT CAUSE FIX: codesign --deep on a PyInstaller --onefile binary cannot
# reach inside the compressed archive to re-sign embedded dylibs. The dylibs
# are compressed data inside the EXE, not separate files. When they are
# extracted to /tmp at runtime, they still carry Python.org's original team ID.
#
# The ONLY correct fix: re-sign the dylibs in the Python installation BEFORE
# PyInstaller collects and packs them. PyInstaller then bakes in the already-
# correctly-signed copy, so macOS sees our Team ID when it's extracted.
#
ENTITLEMENTS_FILE="$PROJECT_ROOT/desktop/src-tauri/sidecar/sidecar.entitlements.plist"
if [[ -n "${APPLE_SIGNING_IDENTITY:-}" && "$(uname -s)" == "Darwin" ]]; then
    echo ""
    echo "=== Pre-Build: Re-signing Python dylibs at source ==="
    echo "  Identity: $APPLE_SIGNING_IDENTITY"

    # Find the Python prefix (base install dir, not the venv)
    PYTHON_PREFIX="$("$PYTHON_CMD" -c 'import sys; print(sys.base_prefix)')"
    echo "  Python prefix: $PYTHON_PREFIX"

    # Build codesign base args
    SIGN_BASE=(codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp --options runtime)
    if [[ -f "$ENTITLEMENTS_FILE" ]]; then
        SIGN_BASE+=(--entitlements "$ENTITLEMENTS_FILE")
        echo "  Entitlements: $ENTITLEMENTS_FILE"
    fi

    # Re-sign every .dylib and .so in the Python installation.
    # This ensures libpython3.13.dylib and any extension modules packed by
    # PyInstaller carry our Team ID before they are added to the archive.
    SIGNED_COUNT=0
    while IFS= read -r -d '' dylib; do
        "${SIGN_BASE[@]}" "$dylib" 2>/dev/null && (( SIGNED_COUNT++ )) || true
    done < <(find "$PYTHON_PREFIX" \( -name "*.dylib" -o -name "*.so" \) -print0 2>/dev/null)

    # Also sign dylibs in the venv itself (compiled extensions installed by uv/pip)
    VENV_DIR="$PROJECT_ROOT/.venv"
    if [[ -d "$VENV_DIR" ]]; then
        while IFS= read -r -d '' dylib; do
            "${SIGN_BASE[@]}" "$dylib" 2>/dev/null && (( SIGNED_COUNT++ )) || true
        done < <(find "$VENV_DIR" \( -name "*.dylib" -o -name "*.so" \) -print0 2>/dev/null)
    fi

    echo "  ✅ Re-signed $SIGNED_COUNT dylib/so files"
    echo ""

    # Export so the .spec file can also pass codesign_identity to PyInstaller
    # (this signs the outer EXE, which is correct)
    export APPLE_SIGNING_IDENTITY
    [[ -f "$ENTITLEMENTS_FILE" ]] && export SIDECAR_ENTITLEMENTS="$ENTITLEMENTS_FILE"
else
    echo "  → Pre-build signing: skipped (not macOS or APPLE_SIGNING_IDENTITY not set)"
fi

"$PYTHON_CMD" "$PYINSTALLER_CMD_FILE"
rm -f "$PYINSTALLER_CMD_FILE"

# ── Post-build: verify the outer binary is signed (macOS only) ────────
# Note: codesign --verify only checks the outer EXE signature, not the
# embedded dylibs (which are compressed data). The real check happens
# at runtime — if the pre-build step above worked, the engine will start.
BUILT_BINARY="dist/aimatrx-engine-$TARGET"
if [[ -n "${APPLE_SIGNING_IDENTITY:-}" && "$(uname -s)" == "Darwin" && -f "$BUILT_BINARY" ]]; then
    echo ""
    echo "=== Post-Build: Verifying outer binary signature ==="
    codesign --verify --verbose "$BUILT_BINARY"
    echo "  ✅ Outer binary signature valid"
fi

# Copy to sidecar directory
echo "Copying binary to sidecar directory..."
cp "dist/aimatrx-engine-$TARGET"* "$SIDECAR_DIR/"

echo ""
echo "=== Build Complete ==="
echo "Binary: $SIDECAR_DIR/$BINARY_NAME"
ls -lh "$SIDECAR_DIR/$BINARY_NAME"

DESKTOP_DIR="$(dirname "$SIDECAR_DIR")"
TAURI_DEV_CMD="cd $PROJECT_ROOT/desktop && npm run tauri:dev"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Next Steps"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Option 1 — Test the sidecar binary standalone:"
echo ""
echo "    $SIDECAR_DIR/$BINARY_NAME"
echo ""
echo "    Then verify it's running:"
echo "    curl http://localhost:22140/tools/list"
echo ""
echo "  Option 2 — Launch the full Tauri desktop app:"
echo "    (Tauri will spawn the sidecar automatically)"
echo ""
echo "    $TAURI_DEV_CMD"
echo ""
echo "  Option 3 — Run the Python engine directly (dev mode, no binary):"
echo ""
echo "    cd $PROJECT_ROOT && uv run python run.py"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
