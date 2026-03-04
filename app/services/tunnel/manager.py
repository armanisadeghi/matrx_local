"""Cloudflare Tunnel manager.

Manages a `cloudflared` subprocess that exposes the local engine
(127.0.0.1:{port}) to the internet via a Cloudflare Tunnel URL.

Two modes:
  - Quick tunnel (no token, default for all users): assigns a random
    *.trycloudflare.com URL per instance. URL changes on each restart.
    Zero config — no Cloudflare account, no token, no setup required.
    The URL is automatically stored in Supabase so remote devices can
    discover it via the /api/local-instances lookup.
  - Named tunnel (CLOUDFLARE_TUNNEL_TOKEN set): uses a pre-provisioned
    tunnel with a stable subdomain. URL survives restarts. Optional — for
    power users who want a permanent address.

The cloudflared binary is bundled with the installer. If not found, it is
downloaded on first use and cached at ~/.matrx/bin/cloudflared.
"""

from __future__ import annotations

import asyncio
import logging
import os
import platform
import re
import stat
import sys
import time
from pathlib import Path
from typing import Optional
from urllib.request import urlretrieve

from app.config import MATRX_HOME_DIR

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Binary download config
# ---------------------------------------------------------------------------

_CLOUDFLARED_VERSION = "2025.1.0"  # pin to a known-good release

_DOWNLOAD_URLS: dict[tuple[str, str], str] = {
    ("Darwin",  "arm64"):  f"https://github.com/cloudflare/cloudflared/releases/download/{_CLOUDFLARED_VERSION}/cloudflared-darwin-arm64",
    ("Darwin",  "x86_64"): f"https://github.com/cloudflare/cloudflared/releases/download/{_CLOUDFLARED_VERSION}/cloudflared-darwin-amd64",
    ("Linux",   "aarch64"):f"https://github.com/cloudflare/cloudflared/releases/download/{_CLOUDFLARED_VERSION}/cloudflared-linux-arm64",
    ("Linux",   "x86_64"): f"https://github.com/cloudflare/cloudflared/releases/download/{_CLOUDFLARED_VERSION}/cloudflared-linux-amd64",
    ("Windows", "AMD64"):  f"https://github.com/cloudflare/cloudflared/releases/download/{_CLOUDFLARED_VERSION}/cloudflared-windows-amd64.exe",
    ("Windows", "ARM64"):  f"https://github.com/cloudflare/cloudflared/releases/download/{_CLOUDFLARED_VERSION}/cloudflared-windows-arm64.exe",
}

# cloudflared prints the tunnel URL to stdout/stderr during startup.
#
# Quick tunnel log line looks like:
#   INF +----------------------------+
#   INF |  https://abc-def.trycloudflare.com  |
#   INF +----------------------------+
#
# Named tunnel log line looks like:
#   INF Registered tunnel connection ... url=https://your-subdomain.example.com
#
# _TUNNEL_URL_RE: matches the boxed URL line cloudflared prints for quick tunnels.
_TUNNEL_URL_RE = re.compile(
    r"\|\s*(https://[a-zA-Z0-9._-]+\.trycloudflare\.com[^\s|]*)"
)
# _NAMED_URL_RE: matches the url= field cloudflared logs for named tunnels.
_NAMED_URL_RE = re.compile(
    r'url=(https://[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}[^\s"]*)'
)
# _FALLBACK_URL_RE: broad fallback — any https URL on a line mentioning the tunnel.
# Catches any format cloudflare might use across versions.
_FALLBACK_URL_RE = re.compile(
    r"(https://[a-zA-Z0-9._-]+\.trycloudflare\.com[^\s]*)"
)


def _bin_dir() -> Path:
    return MATRX_HOME_DIR / "bin"


def _bin_path() -> Path:
    name = "cloudflared.exe" if platform.system() == "Windows" else "cloudflared"
    return _bin_dir() / name


def _get_download_url() -> str:
    system = platform.system()
    machine = platform.machine()
    # Normalise arm64 aliases
    if machine in ("arm64", "aarch64", "ARM64"):
        machine = "aarch64" if system == "Linux" else "arm64"
    if machine == "amd64":
        machine = "x86_64"
    key = (system, machine)
    url = _DOWNLOAD_URLS.get(key)
    if not url:
        raise RuntimeError(
            f"No cloudflared binary available for {system}/{machine}. "
            "Download manually from https://github.com/cloudflare/cloudflared/releases "
            f"and place it at {_bin_path()}"
        )
    return url


def _find_preinstalled_cloudflared() -> Path | None:
    """Look for cloudflared in:
    1. Tauri resource directory (bundled in the .app / installer)
    2. ~/.matrx/bin/ (previously downloaded by us)
    3. System PATH / well-known locations (Homebrew, package manager)

    Returns the first found binary, or None if not available anywhere.
    This function intentionally does NOT download — that's _ensure_binary().
    """
    import shutil

    # 1. Tauri resource dir: the frozen Python sidecar runs from a Resources/ folder.
    #    When we bundle cloudflared as a Tauri resource it lands next to the engine binary.
    resource_candidates = [
        Path(sys.executable).parent / "cloudflared",            # macOS/Linux sidecar
        Path(sys.executable).parent / "cloudflared.exe",        # Windows sidecar
        Path(sys.executable).with_name("cloudflared"),          # same dir as binary
        Path(sys.executable).with_name("cloudflared.exe"),
    ]
    for p in resource_candidates:
        if p.exists() and p.is_file():
            logger.debug("Found bundled cloudflared at %s", p)
            return p

    # 2. Our own cached download
    cached = _bin_path()
    if cached.exists():
        return cached

    # 3. System install (Homebrew, apt, MSI installer, etc.)
    system_candidates = [
        "/opt/homebrew/bin/cloudflared",          # macOS Apple Silicon (Homebrew)
        "/usr/local/bin/cloudflared",              # macOS Intel (Homebrew) / Linux
        "/usr/bin/cloudflared",                    # Linux package manager
        "C:\\Program Files\\cloudflared\\cloudflared.exe",  # Windows MSI
    ]
    for path_str in system_candidates:
        p = Path(path_str)
        if p.exists() and p.is_file():
            logger.debug("Found system cloudflared at %s", p)
            return p

    # Also check PATH
    found = shutil.which("cloudflared")
    if found:
        return Path(found)

    return None


def _ensure_binary() -> Path:
    """Return path to a working cloudflared binary.

    Priority:
    1. Bundled (Tauri resource) or system-installed binary — no download needed.
    2. Previously cached download in ~/.matrx/bin/.
    3. Fresh download from GitHub Releases (first-run only, ~18 MB).
    """
    existing = _find_preinstalled_cloudflared()
    if existing:
        return existing

    # Nothing found locally — download once and cache it.
    dest = _bin_path()
    url = _get_download_url()
    logger.info("cloudflared not found locally — downloading from %s → %s", url, dest)
    dest.parent.mkdir(parents=True, exist_ok=True)

    try:
        urlretrieve(url, dest)
    except Exception as exc:
        dest.unlink(missing_ok=True)
        raise RuntimeError(f"Failed to download cloudflared: {exc}") from exc

    if platform.system() != "Windows":
        dest.chmod(dest.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    logger.info("cloudflared downloaded ✓ (%s)", dest)
    return dest


# ---------------------------------------------------------------------------
# TunnelManager
# ---------------------------------------------------------------------------


class TunnelManager:
    """Manages the cloudflared subprocess for inbound tunnel access."""

    def __init__(self) -> None:
        self._process: Optional[asyncio.subprocess.Process] = None
        self._url: Optional[str] = None
        self._ws_url: Optional[str] = None
        self._started_at: Optional[float] = None
        self._reader_task: Optional[asyncio.Task] = None
        self._url_ready: asyncio.Event = asyncio.Event()
        self._token: str = os.getenv("CLOUDFLARE_TUNNEL_TOKEN", "")
        self._port: int = 0

    # ── public API ──────────────────────────────────────────────────────────

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    @property
    def url(self) -> Optional[str]:
        return self._url

    @property
    def ws_url(self) -> Optional[str]:
        return self._ws_url

    @property
    def uptime_seconds(self) -> float:
        if self._started_at is None:
            return 0.0
        return round(time.time() - self._started_at, 1)

    async def start(self, port: int) -> Optional[str]:
        """Start the tunnel subprocess. Returns the public URL when ready."""
        if self.running:
            logger.warning("TunnelManager.start() called while already running")
            return self._url

        self._port = port
        self._url = None
        self._ws_url = None
        self._url_ready.clear()

        try:
            bin_path = await asyncio.get_event_loop().run_in_executor(
                None, _ensure_binary
            )
        except Exception as exc:
            logger.error("Failed to acquire cloudflared binary: %s", exc)
            return None

        cmd = self._build_command(bin_path, port)
        logger.info("Starting cloudflared: %s", " ".join(str(c) for c in cmd))

        try:
            self._process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
        except Exception as exc:
            logger.error("Failed to launch cloudflared: %s", exc)
            return None

        self._started_at = time.time()
        self._reader_task = asyncio.create_task(self._read_output())

        # Wait up to 30s for the URL to appear in output
        try:
            await asyncio.wait_for(self._url_ready.wait(), timeout=30.0)
        except asyncio.TimeoutError:
            logger.warning("cloudflared did not emit a tunnel URL within 30s")

        if self._url:
            logger.info("Tunnel active: %s", self._url)
        return self._url

    async def stop(self) -> None:
        """Stop the tunnel subprocess."""
        if self._reader_task and not self._reader_task.done():
            self._reader_task.cancel()
            try:
                await self._reader_task
            except asyncio.CancelledError:
                pass

        if self._process and self._process.returncode is None:
            try:
                self._process.terminate()
                await asyncio.wait_for(self._process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self._process.kill()
            except Exception as exc:
                logger.debug("cloudflared stop error: %s", exc)

        self._process = None
        self._url = None
        self._ws_url = None
        self._started_at = None
        logger.info("Tunnel stopped")

    def get_status(self) -> dict:
        return {
            "running": self.running,
            "url": self._url,
            "ws_url": self._ws_url,
            "uptime_seconds": self.uptime_seconds,
            "port": self._port,
            "mode": "named" if self._token else "quick",
        }

    # ── internal helpers ────────────────────────────────────────────────────

    def _build_command(self, bin_path: Path, port: int) -> list[str]:
        if self._token:
            # Named tunnel mode — token was pre-provisioned, URL is stable.
            return [str(bin_path), "tunnel", "--no-autoupdate", "run", "--token", self._token]
        else:
            # Quick tunnel mode — random URL, changes on restart.
            return [
                str(bin_path), "tunnel", "--no-autoupdate",
                "--url", f"http://127.0.0.1:{port}",
            ]

    async def _read_output(self) -> None:
        """Read cloudflared stdout/stderr and extract the tunnel URL."""
        if not self._process or not self._process.stdout:
            return

        try:
            async for raw_line in self._process.stdout:
                line = raw_line.decode("utf-8", errors="replace").rstrip()
                if line:
                    logger.debug("[cloudflared] %s", line)

                # Try patterns in order: boxed quick-tunnel URL, named tunnel url= field, broad fallback
                match = _TUNNEL_URL_RE.search(line) or _NAMED_URL_RE.search(line) or _FALLBACK_URL_RE.search(line)
                if match and not self._url:
                    url = match.group(1).rstrip("/")
                    self._url = url
                    # Convert https → wss for WebSocket
                    self._ws_url = url.replace("https://", "wss://") + "/ws"
                    self._url_ready.set()
                    logger.info("Tunnel URL captured: %s", url)

        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.debug("cloudflared output reader error: %s", exc)


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_tunnel_manager: Optional[TunnelManager] = None


def get_tunnel_manager() -> TunnelManager:
    global _tunnel_manager
    if _tunnel_manager is None:
        _tunnel_manager = TunnelManager()
    return _tunnel_manager
