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
import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import AsyncIterator

from app.common.system_logger import get_logger

logger = get_logger()

# ── Package list ──────────────────────────────────────────────────────────────

# CPU-only torch keeps the download to ~250 MB instead of ~2 GB (CUDA build).
# On Apple Silicon (arm64/aarch64) torch ships native ARM wheels on the
# standard PyPI index; the CPU extra index is only needed on x86 Linux/Windows.
_TORCH_CPU_INDEX_URL = "https://download.pytorch.org/whl/cpu"

# All packages to install (order matters — torch first so its deps land before
# the diffusers wheel asks for them).
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
    if sys.platform == "win32":
        base = Path(os.getenv("LOCALAPPDATA", str(Path.home() / "AppData" / "Local")))
        return base / "AI Matrx" / "image-gen-packages"
    # macOS and Linux
    return Path.home() / ".matrx" / "image-gen-packages"


def is_image_gen_installed() -> bool:
    """True if the managed image-gen packages directory is complete."""
    return (get_image_gen_packages_dir() / ".install-complete").exists()


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


# ── Progress tracker ──────────────────────────────────────────────────────────

class InstallProgress:
    """Thread-safe progress bag shared between the installer thread and SSE stream."""

    def __init__(self) -> None:
        self.status: str = "idle"        # idle | running | complete | error
        self.stage: str = ""
        self.percent: float = 0.0
        self.message: str = ""
        self.log_lines: list[str] = []
        self.error: str | None = None
        self._lock = threading.Lock()
        self._queue: asyncio.Queue[dict] = asyncio.Queue()
        self._loop: asyncio.AbstractEventLoop | None = None

    def _emit(self, event: dict) -> None:
        """Thread-safe: schedule queue.put on the asyncio event loop."""
        loop = self._loop
        if loop and loop.is_running():
            asyncio.run_coroutine_threadsafe(self._queue.put(event), loop)

    def update(self, stage: str, percent: float, message: str) -> None:
        with self._lock:
            self.stage = stage
            self.percent = percent
            self.message = message
        logger.info("[image_gen_installer] [%.0f%%] %s — %s", percent, stage, message)
        self._emit({
            "status": self.status,
            "stage": stage,
            "percent": percent,
            "message": message,
        })

    def log(self, line: str) -> None:
        """Forward a raw pip output line to the SSE stream and engine log."""
        with self._lock:
            self.log_lines.append(line)
            if len(self.log_lines) > 500:
                self.log_lines = self.log_lines[-500:]
        logger.debug("[pip] %s", line)
        self._emit({
            "status": self.status,
            "stage": self.stage,
            "percent": self.percent,
            "message": line,
            "log": True,
        })

    def finish(self) -> None:
        with self._lock:
            self.status = "complete"
            self.percent = 100.0
        logger.info("[image_gen_installer] Installation complete ✓")
        self._emit({
            "status": "complete",
            "stage": "done",
            "percent": 100.0,
            "message": "Installation complete — Image generation is ready!",
        })

    def fail(self, error: str) -> None:
        with self._lock:
            self.status = "error"
            self.error = error
        logger.error("[image_gen_installer] FAILED: %s", error)
        self._emit({
            "status": "error",
            "stage": "error",
            "percent": self.percent,
            "message": error,
        })

    async def events(self) -> AsyncIterator[dict]:
        """Async generator — yields progress events until complete or error."""
        while True:
            try:
                event = await asyncio.wait_for(self._queue.get(), timeout=300)
            except asyncio.TimeoutError:
                yield {"status": "error", "message": "Installer timed out (5 min with no output)"}
                return
            yield event
            if event.get("status") in ("complete", "error"):
                return


# ── Global singleton ──────────────────────────────────────────────────────────

_active_progress: InstallProgress | None = None


def get_active_progress() -> InstallProgress | None:
    return _active_progress


# ── Subprocess runner with live output ────────────────────────────────────────

def _run_pip_streaming(
    packages: list[str],
    target: Path,
    progress: InstallProgress,
    extra_index: str | None = None,
) -> None:
    """Run pip install, forwarding each output line to `progress.log` in real time.

    Raises RuntimeError on non-zero exit.
    """
    cmd = [
        sys.executable, "-m", "pip", "install",
        "--target", str(target),
        "--upgrade",
        "--no-cache-dir",           # avoid stale cache masking download progress
        "--progress-bar", "off",    # machine-readable output without ANSI bars
        "--disable-pip-version-check",
    ]
    if extra_index:
        cmd += ["--extra-index-url", extra_index]
    cmd += packages

    logger.info("[image_gen_installer] Running: %s", " ".join(cmd))

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,   # merge stderr into stdout for unified stream
        text=True,
        bufsize=1,                  # line-buffered
    )

    assert proc.stdout is not None
    for raw_line in proc.stdout:
        line = raw_line.rstrip("\n").rstrip("\r")
        if line:
            progress.log(line)

    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(
            f"pip exited with code {proc.returncode} while installing {packages}"
        )


# ── Main installer (runs in a thread) ────────────────────────────────────────

def _do_install(progress: InstallProgress) -> None:
    """Blocking installer — called from a thread pool executor."""
    import platform as _platform

    pkg_dir = get_image_gen_packages_dir()
    pkg_dir.mkdir(parents=True, exist_ok=True)

    marker = pkg_dir / ".install-complete"
    marker.unlink(missing_ok=True)

    arch = _platform.machine().lower()
    use_torch_cpu_index = not (sys.platform == "darwin" and arch in ("arm64", "aarch64"))

    try:
        progress.update("preparing", 2.0, "Preparing installation directory…")

        # ── Step 1: PyTorch ───────────────────────────────────────────────────
        torch_packages = [
            p for p in IMAGE_GEN_PACKAGES
            if any(p.lower().startswith(t) for t in _TORCH_PACKAGES)
        ]
        progress.update(
            "downloading", 5.0,
            "Downloading PyTorch… this is the big one (~400–800 MB). "
            "You'll see download lines appear below as it progresses.",
        )
        _run_pip_streaming(
            torch_packages,
            pkg_dir,
            progress,
            extra_index=_TORCH_CPU_INDEX_URL if use_torch_cpu_index else None,
        )
        progress.update("downloading", 45.0, "PyTorch installed ✓")

        # ── Step 2: diffusers + supporting packages ───────────────────────────
        rest_packages = [
            p for p in IMAGE_GEN_PACKAGES
            if not any(p.lower().startswith(t) for t in _TORCH_PACKAGES)
        ]
        progress.update("downloading", 47.0, "Downloading diffusers, transformers, accelerate…")
        _run_pip_streaming(rest_packages, pkg_dir, progress)
        progress.update("installing", 90.0, "All packages downloaded and installed ✓")

        # ── Step 3: verify imports in a clean subprocess ──────────────────────
        progress.update("verifying", 92.0, "Verifying installation…")
        env = os.environ.copy()
        env["PYTHONPATH"] = str(pkg_dir) + os.pathsep + env.get("PYTHONPATH", "")
        check = subprocess.run(
            [sys.executable, "-c",
             "import torch, diffusers, transformers, accelerate; print('ok')"],
            capture_output=True, text=True, env=env, timeout=60,
        )
        if check.returncode != 0 or "ok" not in check.stdout:
            raise RuntimeError(
                f"Post-install import check failed:\n{check.stderr[-2000:]}"
            )
        progress.update("verifying", 97.0, "All imports verified ✓")

        # ── Step 4: write marker + inject path ────────────────────────────────
        marker.write_text(json.dumps({"packages": IMAGE_GEN_PACKAGES}))
        inject_image_gen_path()

        # Reload availability in the running service
        try:
            from app.services.image_gen import service as _svc_mod
            _svc_mod.DEPS_AVAILABLE, _svc_mod.DEPS_REASON = _svc_mod._check_deps()
            logger.info(
                "[image_gen_installer] Service deps reloaded: available=%s",
                _svc_mod.DEPS_AVAILABLE,
            )
        except Exception as reload_err:
            logger.warning("[image_gen_installer] Could not reload service deps: %s", reload_err)

        progress.finish()

    except Exception as exc:
        progress.fail(str(exc))


# ── Public API ────────────────────────────────────────────────────────────────

async def start_install() -> InstallProgress:
    """Start a background install.  Returns immediately with a progress object.

    Raises RuntimeError if an install is already running.
    """
    global _active_progress
    if _active_progress is not None and _active_progress.status == "running":
        raise RuntimeError("Installation already in progress")

    progress = InstallProgress()
    progress.status = "running"
    progress._loop = asyncio.get_running_loop()
    _active_progress = progress

    asyncio.get_running_loop().run_in_executor(None, _do_install, progress)
    return progress
