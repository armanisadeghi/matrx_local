"""PyInstaller runtime hook — set environment variables for bundled tools.

This runs before any application code when the frozen binary starts.
It injects compile-time config (API URLs, publishable keys) and then
points Playwright, Tesseract, and ffmpeg to their bundled/user locations
inside sys._MEIPASS (the PyInstaller extraction directory) or the user's home.
"""

import os
import sys
from pathlib import Path

# ── Windows UTF-8 fix — MUST be first, before any other import ───────────────
#
# Windows uses CP1252 (charmap) as the default stdout/stderr encoding for
# console applications. Our log messages contain Unicode characters (✓, →, ←,
# ─, ⚠, etc.) that are not representable in CP1252. When Python tries to write
# them it raises UnicodeEncodeError, which gets swallowed by Starlette's
# middleware logger and floods stderr with hundreds of "--- Logging error ---"
# tracebacks per second — completely obscuring real errors.
#
# Fix strategy (defence-in-depth):
#   1. PYTHONUTF8=1 — tells the Python interpreter itself to use UTF-8 for
#      ALL text I/O, file opens, etc.  Effective for subprocesses we spawn.
#   2. PYTHONIOENCODING=utf-8:replace — used by Python < 3.7 and as a
#      secondary signal for libraries that read it directly.
#   3. Reconfigure sys.stdout / sys.stderr with UTF-8 + errors='replace' so
#      that any character that still can't be encoded becomes '?' instead of
#      raising. This is the decisive fix for the running process.
#
# This hook runs before any application code so the streams are correct for
# the very first log line emitted during import of app.common.platform_ctx.
#
if sys.platform == "win32":
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8:replace")
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        else:
            import io
            sys.stdout = io.TextIOWrapper(
                sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True
            )
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        else:
            import io
            sys.stderr = io.TextIOWrapper(
                sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=True
            )
    except Exception:
        pass  # If reconfigure fails (e.g. no buffer attr), continue — better than crashing.

# Inject API URLs and publishable keys baked in at build time by CI.
# Must run before any other module import so dotenv / config.py see the values.
try:
    from app.bundled_config import apply as _apply_bundled_config
    _apply_bundled_config()
except Exception:
    pass  # Dev mode or partial build — values come from .env instead.

if hasattr(sys, "_MEIPASS"):
    base = sys._MEIPASS

    # Playwright: browsers are NOT bundled inside the binary (bundling causes
    # codesign failures on macOS with Chrome's nested framework structure).
    # Point to a persistent user-writable directory instead; the engine will
    # auto-install browsers there on first startup if they are missing.
    os.environ.setdefault(
        "PLAYWRIGHT_BROWSERS_PATH",
        str(Path.home() / ".matrx" / "playwright-browsers"),
    )

    # Tesseract: point to the bundled tessdata language files.
    tessdata = os.path.join(base, "tessdata")
    if os.path.isdir(tessdata):
        os.environ.setdefault("TESSDATA_PREFIX", tessdata)

    # imageio-ffmpeg: it auto-discovers its binary, but set PATH so
    # yt-dlp and any subprocess calls can also find ffmpeg.
    ffmpeg_bin_dir = os.path.join(base, "imageio_ffmpeg", "binaries")
    if os.path.isdir(ffmpeg_bin_dir):
        os.environ["PATH"] = ffmpeg_bin_dir + os.pathsep + os.environ.get("PATH", "")
