"""PyInstaller runtime hook — set environment variables for bundled tools.

This runs before any application code when the frozen binary starts.
It points Playwright, Tesseract, and ffmpeg to their bundled locations
inside sys._MEIPASS (the PyInstaller extraction directory).
"""

import os
import sys


if hasattr(sys, "_MEIPASS"):
    base = sys._MEIPASS

    # Playwright: tell the driver where to find the bundled browsers.
    # The browsers are bundled at playwright_browsers/ inside the archive.
    os.environ.setdefault(
        "PLAYWRIGHT_BROWSERS_PATH",
        os.path.join(base, "playwright_browsers"),
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
