"""PyInstaller runtime hook — set environment variables for bundled tools.

This runs before any application code when the frozen binary starts.
It points Playwright, Tesseract, and ffmpeg to their bundled/user locations
inside sys._MEIPASS (the PyInstaller extraction directory) or the user's home.
"""

import os
import sys


if hasattr(sys, "_MEIPASS"):
    base = sys._MEIPASS

    # Playwright: browsers are NOT bundled inside the binary (bundling causes
    # codesign failures on macOS with Chrome's nested framework structure).
    # Point to a persistent user-writable directory instead; the engine will
    # auto-install browsers there on first startup if they are missing.
    os.environ.setdefault(
        "PLAYWRIGHT_BROWSERS_PATH",
        os.path.join(os.path.expanduser("~"), ".matrx", "playwright-browsers"),
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
