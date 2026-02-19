"""Matrx Local — entry point.

Starts the FastAPI server and a system tray icon.
On startup, checks for updates via tufup (if an update server is configured).

Port selection:
  1. MATRX_PORT env var (explicit override — fails hard if taken)
  2. Default port 22140 (chosen to avoid conflicts with common dev ports)
  3. Auto-scan: tries up to 20 consecutive ports until one is free

The chosen port is written to ~/.matrx/local.json so the web/mobile frontend
can discover it without configuration.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import sys
import threading
from pathlib import Path

import uvicorn
from PIL import Image
from pystray import Icon, Menu, MenuItem

from app.main import app

logger = logging.getLogger(__name__)

if getattr(sys, "frozen", False):
    BUNDLE_DIR = Path(sys.executable).parent
else:
    BUNDLE_DIR = Path(__file__).resolve().parent

STATIC_DIR = BUNDLE_DIR / "static"

DEFAULT_PORT = 22140
MAX_PORT_SCAN = 20
DISCOVERY_DIR = Path.home() / ".matrx"
DISCOVERY_FILE = DISCOVERY_DIR / "local.json"


def _is_port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.1)
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def find_available_port() -> int:
    """Find an available port for the server.

    If MATRX_PORT is set, uses that exact port (no fallback — user chose it).
    Otherwise tries DEFAULT_PORT, then scans up to MAX_PORT_SCAN consecutive
    ports from there.
    """
    env_port = os.environ.get("MATRX_PORT")
    if env_port:
        port = int(env_port)
        if _is_port_available(port):
            return port
        logger.error("MATRX_PORT=%d is already in use", port)
        raise SystemExit(f"Port {port} (from MATRX_PORT) is already in use")

    for offset in range(MAX_PORT_SCAN):
        candidate = DEFAULT_PORT + offset
        if _is_port_available(candidate):
            if offset > 0:
                logger.info("Default port %d in use, using %d instead", DEFAULT_PORT, candidate)
            return candidate

    raise SystemExit(
        f"No available port found in range {DEFAULT_PORT}-{DEFAULT_PORT + MAX_PORT_SCAN - 1}. "
        f"Set MATRX_PORT to a specific open port."
    )


def write_discovery_file(port: int) -> None:
    """Write the active port to ~/.matrx/local.json for frontend discovery."""
    try:
        DISCOVERY_DIR.mkdir(parents=True, exist_ok=True)
        payload = {
            "port": port,
            "host": "127.0.0.1",
            "url": f"http://127.0.0.1:{port}",
            "ws": f"ws://127.0.0.1:{port}/ws",
            "pid": os.getpid(),
            "version": "0.3.0",
        }
        DISCOVERY_FILE.write_text(json.dumps(payload, indent=2))
        logger.info("Discovery file written: %s", DISCOVERY_FILE)
    except Exception:
        logger.warning("Failed to write discovery file", exc_info=True)


def remove_discovery_file() -> None:
    try:
        DISCOVERY_FILE.unlink(missing_ok=True)
    except Exception:
        pass


def create_tray_image() -> Image.Image:
    icon_path = STATIC_DIR / "apple-touch-icon.png"
    if icon_path.exists():
        return Image.open(str(icon_path))
    return Image.new("RGB", (64, 64), color=(59, 130, 246))


def start_server(port: int) -> None:
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="info",
    )


def on_quit(icon: Icon, item: MenuItem) -> None:
    remove_discovery_file()
    icon.stop()
    os._exit(0)


def _has_system_tray() -> bool:
    """Check if a system tray is available (not available in WSL/headless)."""
    if sys.platform == "win32" or sys.platform == "darwin":
        return True
    display = os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")
    if not display:
        return False
    if "microsoft" in Path("/proc/version").read_text().lower() if Path("/proc/version").exists() else "":
        return False
    return True


def setup_tray(port: int) -> None:
    if not _has_system_tray():
        logger.info("No system tray available (WSL/headless) — running without tray icon")
        try:
            import signal
            signal.pause()
        except (AttributeError, KeyboardInterrupt):
            import time
            while True:
                time.sleep(3600)
        return

    menu = Menu(
        MenuItem(f"Matrx Local (:{port})", lambda *_: None, enabled=False),
        Menu.SEPARATOR,
        MenuItem("Quit", on_quit),
    )
    icon = Icon("matrx_local", create_tray_image(), "Matrx Local", menu)
    icon.run()


def main() -> None:
    try:
        from app.updater import check_for_updates
        needs_restart = check_for_updates()
        if needs_restart:
            logger.info("Update applied — restarting...")
            os.execv(sys.executable, [sys.executable] + sys.argv)
            return
    except Exception as e:
        logger.debug("Update check skipped: %s", e)

    port = find_available_port()
    logger.info("Starting Matrx Local on port %d", port)

    write_discovery_file(port)

    server_thread = threading.Thread(target=start_server, args=(port,), daemon=True)
    server_thread.start()

    setup_tray(port)


if __name__ == "__main__":
    main()
