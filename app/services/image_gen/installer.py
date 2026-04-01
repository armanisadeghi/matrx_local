"""Image generation package installer.

Handles on-demand installation of torch, diffusers, transformers, accelerate
into a dedicated user-writable directory alongside the frozen binary.  This
keeps the sidecar binary small (no PyTorch bundled) while letting consumers
install image generation with a single in-app click — no terminal, no uv,
no developer knowledge required.

The packages are installed into:
  macOS / Linux  →  ~/.matrx/image-gen-packages/
  Windows        →  %LOCALAPPDATA%\\AI Matrx\\image-gen-packages\\

The runtime_hook.py adds this directory to sys.path on every engine start
once the install is complete, so the frozen binary can import them.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import AsyncIterator

from app.common.system_logger import get_logger

logger = get_logger()

# ── Package list ──────────────────────────────────────────────────────────────

# CPU-only torch keeps the download to ~250 MB instead of ~2 GB (CUDA build).
# For GPU support users can manually override later; the library auto-selects
# CUDA if available regardless of how it was installed.
_TORCH_INDEX_URL = "https://download.pytorch.org/whl/cpu"

IMAGE_GEN_PACKAGES = [
    "torch",
    "torchvision",
    "diffusers>=0.32.0",
    "transformers>=4.45.0",
    "accelerate>=0.33.0",
    "sentencepiece>=0.2.0",
    "protobuf>=3.20.0",
    "huggingface_hub[hf_transfer]>=0.22.0",
]

_TORCH_PACKAGES = {"torch", "torchvision", "torchaudio"}


# ── Install directory ─────────────────────────────────────────────────────────

def get_image_gen_packages_dir() -> Path:
    """Platform-appropriate directory for image-gen packages."""
    system = sys.platform
    if system == "win32":
        base = Path(os.getenv("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        return base / "AI Matrx" / "image-gen-packages"
    # macOS and Linux
    return Path.home() / ".matrx" / "image-gen-packages"


def is_image_gen_installed() -> bool:
    """True if our managed image-gen packages directory exists and appears complete."""
    pkg_dir = get_image_gen_packages_dir()
    marker = pkg_dir / ".install-complete"
    return marker.exists()


def inject_image_gen_path() -> bool:
    """Add the managed packages dir to sys.path if the install is complete.

    Called from runtime_hook.py and at engine startup.
    Returns True if path was injected, False if packages not yet installed.
    """
    if not is_image_gen_installed():
        return False
    pkg_dir = str(get_image_gen_packages_dir())
    if pkg_dir not in sys.path:
        sys.path.insert(0, pkg_dir)
        logger.debug("[image_gen_installer] Injected %s into sys.path", pkg_dir)
    return True


# ── Installer ─────────────────────────────────────────────────────────────────

class InstallProgress:
    """Mutable state bag shared between installer thread and SSE stream."""

    def __init__(self) -> None:
        self.status: str = "idle"        # idle | running | complete | error
        self.stage: str = ""
        self.percent: float = 0.0
        self.message: str = ""
        self.error: str | None = None
        self._queue: asyncio.Queue[dict] = asyncio.Queue()
        self._loop: asyncio.AbstractEventLoop | None = None

    def _emit(self, event: dict) -> None:
        if self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(self._queue.put(event), self._loop)

    def update(self, stage: str, percent: float, message: str) -> None:
        self.stage = stage
        self.percent = percent
        self.message = message
        logger.info("[image_gen_installer] %s (%.0f%%) %s", stage, percent, message)
        self._emit({"stage": stage, "percent": percent, "message": message, "status": self.status})

    def finish(self) -> None:
        self.status = "complete"
        self.percent = 100.0
        self._emit({"stage": "done", "percent": 100.0, "message": "Installation complete", "status": "complete"})

    def fail(self, error: str) -> None:
        self.status = "error"
        self.error = error
        logger.error("[image_gen_installer] FAILED: %s", error)
        self._emit({"stage": "error", "percent": self.percent, "message": error, "status": "error"})

    async def events(self) -> AsyncIterator[dict]:
        """Async generator yielding progress events. Terminates on complete or error."""
        while True:
            event = await asyncio.wait_for(self._queue.get(), timeout=120)
            yield event
            if event.get("status") in ("complete", "error"):
                break


# Global singleton — only one install at a time
_active_progress: InstallProgress | None = None


def get_active_progress() -> InstallProgress | None:
    return _active_progress


def _pip_install(packages: list[str], target: Path, extra_index: str | None = None) -> subprocess.CompletedProcess:
    cmd = [
        sys.executable, "-m", "pip", "install",
        "--target", str(target),
        "--no-deps" if False else None,   # install deps
        "--upgrade",
        "--quiet",
        "--disable-pip-version-check",
    ]
    cmd = [c for c in cmd if c is not None]
    if extra_index:
        cmd += ["--extra-index-url", extra_index]
    cmd += packages
    return subprocess.run(cmd, capture_output=True, text=True)


def _do_install(progress: InstallProgress) -> None:
    """Blocking installer — runs in a thread pool to avoid blocking the event loop."""
    import platform as _platform

    pkg_dir = get_image_gen_packages_dir()
    pkg_dir.mkdir(parents=True, exist_ok=True)

    # Remove stale marker so a re-install is idempotent
    marker = pkg_dir / ".install-complete"
    marker.unlink(missing_ok=True)

    # On macOS Apple Silicon, torch provides native ARM wheels via the standard index.
    # On Linux / Windows CPU-only we use the PyTorch CPU extra index.
    arch = _platform.machine().lower()
    use_torch_index = not (sys.platform == "darwin" and arch in ("arm64", "aarch64"))

    try:
        progress.update("preparing", 2.0, "Preparing installation directory…")

        # Step 1: torch (largest download first for better progress feedback)
        progress.update("downloading", 5.0, "Downloading PyTorch (CPU). This is ~250 MB — please wait…")
        torch_packages = [p for p in IMAGE_GEN_PACKAGES if any(p.startswith(t) for t in _TORCH_PACKAGES)]
        result = _pip_install(
            torch_packages,
            pkg_dir,
            extra_index=_TORCH_INDEX_URL if use_torch_index else None,
        )
        if result.returncode != 0:
            raise RuntimeError(f"torch install failed:\n{result.stderr[-2000:]}")
        progress.update("downloading", 40.0, "PyTorch installed.")

        # Step 2: diffusers + transformers + accelerate
        progress.update("downloading", 42.0, "Downloading diffusers, transformers, accelerate…")
        rest_packages = [p for p in IMAGE_GEN_PACKAGES if not any(p.startswith(t) for t in _TORCH_PACKAGES)]
        result = _pip_install(rest_packages, pkg_dir)
        if result.returncode != 0:
            raise RuntimeError(f"diffusers install failed:\n{result.stderr[-2000:]}")
        progress.update("installing", 90.0, "All packages installed, verifying…")

        # Step 3: verify imports
        env = os.environ.copy()
        env["PYTHONPATH"] = str(pkg_dir) + os.pathsep + env.get("PYTHONPATH", "")
        check = subprocess.run(
            [sys.executable, "-c",
             "import torch, diffusers, transformers, accelerate; print('ok')"],
            capture_output=True, text=True, env=env,
        )
        if check.returncode != 0 or "ok" not in check.stdout:
            raise RuntimeError(f"Post-install verification failed:\n{check.stderr[-2000:]}")

        # Write completion marker
        marker.write_text(json.dumps({"packages": IMAGE_GEN_PACKAGES}))
        progress.update("done", 98.0, "Verifying…")

        # Inject into live process
        inject_image_gen_path()

        # Reload availability check in service
        try:
            from app.services.image_gen import service as _svc_mod
            _svc_mod.DEPS_AVAILABLE, _svc_mod.DEPS_REASON = _svc_mod._check_deps()
            logger.info("[image_gen_installer] Service deps reloaded: available=%s", _svc_mod.DEPS_AVAILABLE)
        except Exception as e:
            logger.warning("[image_gen_installer] Could not reload service deps: %s", e)

        progress.finish()

    except Exception as exc:
        progress.fail(str(exc))
    finally:
        global _active_progress
        # Keep the finished/failed progress around for the last poll; caller clears it
        pass


async def start_install() -> InstallProgress:
    """Start a background install.  Raises RuntimeError if one is already in progress."""
    global _active_progress
    if _active_progress is not None and _active_progress.status == "running":
        raise RuntimeError("Installation already in progress")

    progress = InstallProgress()
    progress.status = "running"
    progress._loop = asyncio.get_running_loop()
    _active_progress = progress

    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, _do_install, progress)
    return progress
