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
import re
import signal
import socket
import subprocess
import sys
import threading
from pathlib import Path

def _read_version() -> str:
    """Read version — tries importlib.metadata first (works in packaged binary),
    then falls back to parsing pyproject.toml (works in dev mode and PyInstaller)."""
    try:
        from importlib.metadata import version as _meta_version, PackageNotFoundError
        try:
            return _meta_version("matrx-local")
        except PackageNotFoundError:
            pass
    except ImportError:
        pass

    # Fallback: read pyproject.toml from several candidate locations.
    # sys._MEIPASS is the PyInstaller extraction dir where bundled datas land.
    try:
        candidates: list[Path] = []
        if hasattr(sys, "_MEIPASS"):
            candidates.append(Path(sys._MEIPASS) / "pyproject.toml")
        candidates += [
            Path(__file__).parent / "pyproject.toml",               # dev: run.py at project root
            Path(__file__).parent.parent / "pyproject.toml",        # edge case
        ]
        for candidate in candidates:
            if candidate.exists():
                text = candidate.read_text()
                m = re.search(r'^version\s*=\s*"([^"]+)"', text, re.MULTILINE)
                if m:
                    return m.group(1)
    except Exception:
        pass

    return "0.0.0"

_APP_VERSION = _read_version()

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
    """Return PIDs of all processes currently listening on *port* (localhost).

    Uses ``lsof`` on macOS/BSD and ``ss`` on Linux.  Falls back to the other
    tool if the primary one is not found.
    """
    pids: list[int] = []

    def _try_lsof(p: int) -> list[int]:
        result: list[int] = []
        try:
            out = subprocess.check_output(
                ["lsof", "-ti", f"tcp:{p}"],
                text=True,
                stderr=subprocess.DEVNULL,
            )
            for line in out.splitlines():
                line = line.strip()
                if line.isdigit():
                    result.append(int(line))
        except Exception:
            pass
        return result

    def _try_ss(p: int) -> list[int]:
        result: list[int] = []
        try:
            out = subprocess.check_output(
                ["ss", "-tlnp", f"sport = :{p}"],
                text=True,
                stderr=subprocess.DEVNULL,
            )
            for line in out.splitlines():
                for chunk in line.split("pid=")[1:]:
                    pid_str = chunk.split(",")[0]
                    if pid_str.isdigit():
                        result.append(int(pid_str))
        except Exception:
            pass
        return result

    if sys.platform == "darwin":
        pids = _try_lsof(port) or _try_ss(port)
    else:
        pids = _try_ss(port) or _try_lsof(port)

    return pids


def _is_matrx_pid(pid: int, stale_pid: int | None) -> bool:
    """Return True if *pid* looks like a previous Matrx engine instance."""
    if pid == stale_pid:
        return True
    # Check /proc cmdline (Linux) or ps (macOS/BSD)
    try:
        if sys.platform != "darwin" and Path(f"/proc/{pid}/cmdline").exists():
            cmdline = Path(f"/proc/{pid}/cmdline").read_text().replace("\x00", " ")
            return "run.py" in cmdline or "matrx" in cmdline.lower()
        out = subprocess.check_output(
            ["ps", "-p", str(pid), "-o", "command="],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        return "run.py" in out or "matrx" in out.lower()
    except Exception:
        return False


def _kill_stale_instances() -> None:
    """Kill ALL stale Matrx engine processes across the full port scan range.

    Called once at startup before we try to bind a port.  This ensures that
    if the user has accumulated 2-3 dead instances (e.g. from multiple dev
    restarts without clean shutdown), they are all swept away and we always
    reclaim the default port rather than drifting to +1, +2, ...
    """
    stale_pid: int | None = None
    try:
        data = json.loads(DISCOVERY_FILE.read_text())
        stale_pid = int(data.get("pid", 0)) or None
    except Exception:
        pass

    killed: list[int] = []
    seen: set[int] = set()

    for offset in range(MAX_PORT_SCAN):
        port = DEFAULT_PORT + offset
        if _is_port_available(port):
            continue
        for pid in _pids_on_port(port):
            if pid == os.getpid() or pid in seen:
                continue
            seen.add(pid)
            if _is_matrx_pid(pid, stale_pid):
                logger.warning(
                    "Stale Matrx instance (pid=%d) holds port %d — terminating it",
                    pid,
                    port,
                )
                try:
                    os.kill(pid, signal.SIGTERM)
                except Exception as exc:
                    logger.debug("SIGTERM pid=%d failed: %s", pid, exc)
                killed.append(pid)

    if killed:
        import time
        time.sleep(0.6)
        for pid in killed:
            if _pid_is_alive(pid):
                logger.warning("pid=%d did not exit after SIGTERM — sending SIGKILL", pid)
                try:
                    os.kill(pid, signal.SIGKILL)
                except Exception:
                    pass
        time.sleep(0.2)
        logger.info("Swept %d stale Matrx instance(s): %s", len(killed), killed)


def _kill_stale_owner(port: int) -> bool:
    """If the port is still held after the global sweep, try one more time.

    Returns True if the port is now available.
    """
    if _is_port_available(port):
        return True

    stale_pid: int | None = None
    try:
        data = json.loads(DISCOVERY_FILE.read_text())
        stale_pid = int(data.get("pid", 0)) or None
    except Exception:
        pass

    for pid in _pids_on_port(port):
        if pid == os.getpid():
            continue
        if _is_matrx_pid(pid, stale_pid):
            logger.warning(
                "Residual Matrx instance (pid=%d) still holds port %d — killing",
                pid,
                port,
            )
            try:
                os.kill(pid, signal.SIGKILL)
            except Exception as exc:
                logger.debug("Could not kill pid %d: %s", pid, exc)

    import time
    time.sleep(0.2)
    return _is_port_available(port)


def find_available_port() -> int:
    """Find an available port for the server.

    If MATRX_PORT is set, uses that exact port (no fallback — user chose it).
    Otherwise:
      1. Sweeps the full scan range and kills ALL stale Matrx instances.
      2. Tries to bind DEFAULT_PORT (should now be free in the common case).
      3. Falls back to scanning consecutive ports if something else (not us)
         is holding the default port.
    """
    env_port = os.environ.get("MATRX_PORT")
    if env_port:
        port = int(env_port)
        if _is_port_available(port):
            return port
        logger.error("MATRX_PORT=%d is already in use", port)
        raise SystemExit(f"Port {port} (from MATRX_PORT) is already in use")

    # Sweep all stale Matrx instances across the entire port range first.
    _kill_stale_instances()

    # After the sweep, the default port should be free in the common case.
    if _is_port_available(DEFAULT_PORT):
        return DEFAULT_PORT

    # If it's still taken, try one targeted kill then fall back to scanning.
    if _kill_stale_owner(DEFAULT_PORT):
        return DEFAULT_PORT

    for offset in range(1, MAX_PORT_SCAN):
        candidate = DEFAULT_PORT + offset
        if _is_port_available(candidate):
            logger.warning(
                "Default port %d is held by a non-Matrx process — using %d instead",
                DEFAULT_PORT,
                candidate,
            )
            return candidate

    raise SystemExit(
        f"No available port found in range {DEFAULT_PORT}-{DEFAULT_PORT + MAX_PORT_SCAN - 1}. "
        f"Set MATRX_PORT to a specific open port."
    )


def write_discovery_file(port: int, tunnel_url: str | None = None) -> None:
    """Write the active port (and optional tunnel URL) to ~/.matrx/local.json."""
    try:
        DISCOVERY_DIR.mkdir(parents=True, exist_ok=True)
        payload: dict = {
            "port": port,
            "host": "127.0.0.1",
            "url": f"http://127.0.0.1:{port}",
            "ws": f"ws://127.0.0.1:{port}/ws",
            "pid": os.getpid(),
            "version": _APP_VERSION,
        }
        if tunnel_url:
            payload["tunnel_url"] = tunnel_url
            payload["tunnel_ws"] = tunnel_url.replace("https://", "wss://") + "/ws"
        DISCOVERY_FILE.write_text(json.dumps(payload, indent=2))
        logger.info("Discovery file written: %s", DISCOVERY_FILE)
    except Exception:
        logger.warning("Failed to write discovery file", exc_info=True)


def update_discovery_tunnel(tunnel_url: str | None) -> None:
    """Update only the tunnel fields in the discovery file (called after tunnel starts)."""
    try:
        if not DISCOVERY_FILE.exists():
            return
        data = json.loads(DISCOVERY_FILE.read_text())
        if tunnel_url:
            data["tunnel_url"] = tunnel_url
            data["tunnel_ws"] = tunnel_url.replace("https://", "wss://") + "/ws"
        else:
            data.pop("tunnel_url", None)
            data.pop("tunnel_ws", None)
        DISCOVERY_FILE.write_text(json.dumps(data, indent=2))
    except Exception:
        logger.debug("Failed to update tunnel in discovery file", exc_info=True)


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
    print("[phase:starting] Engine initializing...", flush=True)

    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_exit)
    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, _handle_exit)

    print("[phase:port] Finding available port...", flush=True)
    port = find_available_port()
    logger.info("Starting Matrx Local on port %d", port)
    print(f"[phase:port] Engine will bind to port {port}", flush=True)

    write_discovery_file(port)

    print("[phase:server] Starting server...", flush=True)
    server_thread = threading.Thread(target=start_server, args=(port,), daemon=True)
    server_thread.start()

    try:
        setup_tray(port)
    except (KeyboardInterrupt, SystemExit):
        remove_discovery_file()
        os._exit(0)


if __name__ == "__main__":
    main()
