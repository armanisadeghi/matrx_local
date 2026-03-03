"""Matrx Local — entry point.

Starts the FastAPI server.  When running standalone (outside the Tauri desktop
shell) also creates a pystray system-tray icon for port display / quit.

When spawned by Tauri as a sidecar (TAURI_SIDECAR=1), the tray icon is
**skipped** — Tauri already manages one system-tray icon that represents the
entire application.  Letting Python also create a tray icon would produce two
(or three) icons in the user's system tray.

Port selection:
  1. MATRX_PORT env var (explicit override — fails hard if taken)
  2. Default port 22140 (chosen to avoid conflicts with common dev ports)
  3. If default port is held by a dead/stale previous instance of ourselves,
     we kill the stale process and reclaim the port rather than drifting.
  4. Auto-scan: tries up to 20 consecutive ports until one is free (last resort)

The chosen port is written to ~/.matrx/local.json so the web/mobile frontend
can discover it without configuration.
"""

from __future__ import annotations

import json
import logging
import os
import signal
import socket
import subprocess
import sys
import threading
from pathlib import Path

import uvicorn
from PIL import Image
from pystray import Icon, Menu, MenuItem

from app.main import app
from app.config import MATRX_HOME_DIR

logger = logging.getLogger(__name__)

if getattr(sys, "frozen", False):
    BUNDLE_DIR = Path(sys.executable).parent
else:
    BUNDLE_DIR = Path(__file__).resolve().parent

STATIC_DIR = BUNDLE_DIR / "static"

DEFAULT_PORT = 22140
MAX_PORT_SCAN = 20
DISCOVERY_DIR = MATRX_HOME_DIR
DISCOVERY_FILE = DISCOVERY_DIR / "local.json"


def _is_port_available(port: int) -> bool:
    """Check if a port is available for binding.

    Uses SO_REUSEADDR so that TIME_WAIT sockets (left by a recently-stopped
    server) do not falsely report the port as busy.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.settimeout(0.1)
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def _pid_is_alive(pid: int) -> bool:
    """Return True if a process with the given PID exists and is running."""
    try:
        os.kill(pid, 0)  # signal 0 = just check existence
        return True
    except (ProcessLookupError, PermissionError):
        return False


def _pids_on_port(port: int) -> list[int]:
    """Return PIDs of all processes currently listening on *port* (localhost)."""
    pids: list[int] = []
    try:
        out = subprocess.check_output(
            ["ss", "-tlnp", f"sport = :{port}"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        for line in out.splitlines():
            # ss output: ...users:(("prog",pid=1234,fd=5))
            for chunk in line.split("pid=")[1:]:
                pid_str = chunk.split(",")[0]
                if pid_str.isdigit():
                    pids.append(int(pid_str))
    except Exception:
        pass
    return pids


def _kill_stale_owner(port: int) -> bool:
    """If the port is held by a dead or stale previous instance of ourselves,
    kill it so we can reclaim our default port instead of drifting to +1, +2…

    Returns True if the port was successfully reclaimed.
    """
    if _is_port_available(port):
        return True  # already free, nothing to do

    # Read the last known PID we wrote to the discovery file
    stale_pid: int | None = None
    try:
        data = json.loads(DISCOVERY_FILE.read_text())
        stale_pid = int(data.get("pid", 0)) or None
    except Exception:
        pass

    pids = _pids_on_port(port)
    if not pids:
        # OS-level TIME_WAIT — no process holds it, SO_REUSEADDR should handle it
        return _is_port_available(port)

    our_script = Path(__file__).resolve()
    for pid in pids:
        if pid == os.getpid():
            continue  # shouldn't happen, but be safe

        # Only kill if it looks like a previous instance of us:
        # either it matches our discovery-file PID, or it's running our script.
        is_ours = pid == stale_pid
        if not is_ours:
            try:
                cmdline_path = Path(f"/proc/{pid}/cmdline")
                cmdline = (
                    cmdline_path.read_text().replace("\x00", " ")
                    if cmdline_path.exists()
                    else ""
                )
                is_ours = str(our_script) in cmdline or "run.py" in cmdline
            except Exception:
                pass

        if is_ours:
            logger.warning(
                "Stale Matrx instance (pid=%d) holds port %d — terminating it",
                pid,
                port,
            )
            try:
                os.kill(pid, signal.SIGTERM)
                import time

                time.sleep(0.5)
                if _pid_is_alive(pid):
                    os.kill(pid, signal.SIGKILL)
                    time.sleep(0.2)
            except Exception as exc:
                logger.debug("Could not kill pid %d: %s", pid, exc)

    return _is_port_available(port)


def find_available_port() -> int:
    """Find an available port for the server.

    If MATRX_PORT is set, uses that exact port (no fallback — user chose it).
    Otherwise tries to reclaim DEFAULT_PORT (killing stale self-owned processes
    if needed), then scans up to MAX_PORT_SCAN consecutive ports as a last resort.
    """
    env_port = os.environ.get("MATRX_PORT")
    if env_port:
        port = int(env_port)
        if _is_port_available(port):
            return port
        logger.error("MATRX_PORT=%d is already in use", port)
        raise SystemExit(f"Port {port} (from MATRX_PORT) is already in use")

    # Try to reclaim the default port from a stale previous instance first
    if _kill_stale_owner(DEFAULT_PORT):
        return DEFAULT_PORT

    # Fall back to scanning — but only if the blocker is something we don't own
    for offset in range(1, MAX_PORT_SCAN):
        candidate = DEFAULT_PORT + offset
        if _is_port_available(candidate):
            logger.warning(
                "Default port %d is held by another process — using %d instead",
                DEFAULT_PORT,
                candidate,
            )
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
            "version": "1.0.21",
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


def _build_log_config() -> dict:
    """Build uvicorn log_config.

    - uvicorn.error  → our console format (startup/shutdown messages)
    - uvicorn.access → suppressed entirely (our middleware already logs every request)
    """
    from app.config import LOCAL_DEV

    fmt = "%(levelname)s - %(message)s" if LOCAL_DEV else "%(asctime)s - %(levelname)s - %(message)s"
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "default": {"format": fmt},
        },
        "handlers": {
            "default": {"class": "logging.StreamHandler", "stream": "ext://sys.stdout", "formatter": "default"},
            "null":    {"class": "logging.NullHandler"},
        },
        "loggers": {
            "uvicorn":        {"handlers": ["default"], "level": "INFO",  "propagate": False},
            "uvicorn.error":  {"handlers": ["default"], "level": "INFO",  "propagate": False},
            "uvicorn.access": {"handlers": ["null"],    "level": "INFO",  "propagate": False},
        },
    }


def start_server(port: int) -> None:
    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        log_level="info",
        log_config=_build_log_config(),
    )
    server = uvicorn.Server(config)
    server.run()


def on_quit(icon: Icon, item: MenuItem) -> None:
    remove_discovery_file()
    icon.stop()
    os._exit(0)


def _is_tauri_sidecar() -> bool:
    """Return True when this process was launched by the Tauri desktop shell.

    Tauri sets TAURI_SIDECAR=1 before spawning the engine.  When this flag is
    present we must NOT create a pystray tray icon — Tauri already owns the
    single tray icon that represents the entire application to the user.
    """
    return os.environ.get("TAURI_SIDECAR", "") == "1"


def _has_system_tray() -> bool:
    """Check if a system tray is available (not available in WSL/headless)."""
    if sys.platform == "win32" or sys.platform == "darwin":
        return True
    display = os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")
    if not display:
        return False
    if (
        "microsoft" in Path("/proc/version").read_text().lower()
        if Path("/proc/version").exists()
        else ""
    ):
        return False
    return True


def _wait_forever() -> None:
    """Block the main thread until Ctrl-C or SIGTERM."""
    import time

    try:
        while True:
            time.sleep(1)
    except (KeyboardInterrupt, SystemExit):
        remove_discovery_file()
        os._exit(0)


def setup_tray(port: int) -> None:
    """Show a pystray system-tray icon (standalone / non-Tauri mode only).

    When running as a Tauri sidecar the tray icon is intentionally skipped;
    instead we just block the main thread so the server keeps running.
    The Tauri shell already has its own tray icon for the whole app.
    """
    if _is_tauri_sidecar():
        logger.info(
            "Running as Tauri sidecar — skipping pystray tray icon "
            "(Tauri manages the system tray for this app)"
        )
        _wait_forever()
        return

    if not _has_system_tray():
        logger.info(
            "No system tray available (WSL/headless) — running without tray icon"
        )
        _wait_forever()
        return

    menu = Menu(
        MenuItem(f"Matrx Local (:{port})", lambda *_: None, enabled=False),
        Menu.SEPARATOR,
        MenuItem("Quit", on_quit),
    )
    icon = Icon("matrx_local", create_tray_image(), "Matrx Local", menu)
    icon.run()


def _handle_exit(signum: int, frame: object) -> None:  # noqa: ARG001
    """Graceful shutdown: clean up the discovery file then exit.

    Uses os._exit() to guarantee the process terminates immediately — sys.exit()
    raises SystemExit which can be swallowed by loops or background threads.
    """
    remove_discovery_file()
    os._exit(0)


def main() -> None:
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_exit)
    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, _handle_exit)

    try:
        from app.updater import check_for_updates

        needs_restart = check_for_updates()
        if needs_restart:
            logger.info("Update applied — restarting...")
            remove_discovery_file()
            os.execv(sys.executable, [sys.executable] + sys.argv)
            return
    except Exception as e:
        logger.debug("Update check skipped: %s", e)

    port = find_available_port()
    logger.info("Starting Matrx Local on port %d", port)

    write_discovery_file(port)

    server_thread = threading.Thread(target=start_server, args=(port,), daemon=True)
    server_thread.start()

    try:
        setup_tray(port)
    except (KeyboardInterrupt, SystemExit):
        remove_discovery_file()
        os._exit(0)


if __name__ == "__main__":
    main()
