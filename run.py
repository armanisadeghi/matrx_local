"""Matrx Local — entry point.

Starts the FastAPI server on localhost:8000 and a system tray icon.
On startup, checks for updates via tufup (if an update server is configured).
"""

from __future__ import annotations

import logging
import os
import sys
import threading
from pathlib import Path

import uvicorn
from PIL import Image
from pystray import Icon, Menu, MenuItem

from app.main import app

logger = logging.getLogger(__name__)

# ── Resolve paths (works both in dev and PyInstaller frozen builds) ─────────
if getattr(sys, "frozen", False):
    BUNDLE_DIR = Path(sys.executable).parent
else:
    BUNDLE_DIR = Path(__file__).resolve().parent

STATIC_DIR = BUNDLE_DIR / "static"
DEFAULT_PORT = int(os.getenv("MATRX_PORT", "8000"))


def create_tray_image() -> Image.Image:
    icon_path = STATIC_DIR / "apple-touch-icon.png"
    if icon_path.exists():
        return Image.open(str(icon_path))
    img = Image.new("RGB", (64, 64), color=(59, 130, 246))
    return img


def start_server(port: int = DEFAULT_PORT) -> None:
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="info",
    )


def on_quit(icon: Icon, item: MenuItem) -> None:
    icon.stop()
    os._exit(0)


def setup_tray(port: int = DEFAULT_PORT) -> None:
    menu = Menu(
        MenuItem(f"Matrx Local (:{port})", lambda *_: None, enabled=False),
        Menu.SEPARATOR,
        MenuItem("Quit", on_quit),
    )
    icon = Icon("matrx_local", create_tray_image(), "Matrx Local", menu)
    icon.run()


def main() -> None:
    # Check for updates before starting the server
    try:
        from app.updater import check_for_updates
        needs_restart = check_for_updates()
        if needs_restart:
            logger.info("Update applied — restarting...")
            os.execv(sys.executable, [sys.executable] + sys.argv)
            return
    except Exception as e:
        logger.debug("Update check skipped: %s", e)

    port = DEFAULT_PORT
    logger.info("Starting Matrx Local on port %d", port)

    server_thread = threading.Thread(target=start_server, args=(port,), daemon=True)
    server_thread.start()

    setup_tray(port)


if __name__ == "__main__":
    main()
