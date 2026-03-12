"""First-run setup status & installation endpoints.

Provides:
- GET  /setup/status   → comprehensive check of what is installed / configured
- POST /setup/install  → SSE stream that installs missing components with live progress
- POST /setup/install-transcription → Download a GGML whisper model (optional)
"""

from __future__ import annotations

import asyncio
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.common.system_logger import get_logger
from app.config import MATRX_HOME_DIR

logger = get_logger()
router = APIRouter(prefix="/setup", tags=["setup"])


# ---------------------------------------------------------------------------
# Status models
# ---------------------------------------------------------------------------

class ComponentStatus(BaseModel):
    id: str
    label: str
    description: str
    # "ready" | "not_ready" | "installing" | "error" | "skipped" | "warning"
    status: str
    detail: str | None = None
    optional: bool = False
    size_hint: str | None = None  # e.g. "~280 MB"
    deep_link: str | None = None  # macOS Settings URL or "x-apple.systempreferences:…"


class SetupStatus(BaseModel):
    setup_complete: bool
    components: list[ComponentStatus]
    platform: str
    architecture: str
    gpu_available: bool
    gpu_name: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Only these three components must be "ready" before setup is considered done.
# Permissions are advisory-only (can't be fixed by a subprocess on macOS TCC).
# Transcription is optional.
_BLOCKING_COMPONENTS = {"core_packages", "browser_engine", "storage_dirs"}


def _browsers_path() -> str:
    return os.environ.get(
        "PLAYWRIGHT_BROWSERS_PATH",
        os.path.join(os.path.expanduser("~"), ".matrx", "playwright-browsers"),
    )


def _check_playwright_package() -> bool:
    """Return True if the playwright Python package is importable."""
    try:
        __import__("playwright")
        return True
    except ImportError:
        return False


def _check_playwright_browsers() -> ComponentStatus:
    """Check that BOTH the Playwright Python package AND Chromium binary are present."""
    has_package = _check_playwright_package()

    browsers_path = _browsers_path()
    markers = ("chromium-", "chromium_headless_shell-")
    browser_found = False
    version = None

    if os.path.isdir(browsers_path):
        for entry in os.listdir(browsers_path):
            if any(entry.startswith(m) for m in markers):
                browser_found = True
                parts = entry.split("-", 1)
                if len(parts) == 2:
                    version = parts[1]
                break

    if has_package and browser_found:
        detail = f"Chromium {version}" if version else "Chromium installed"
        return ComponentStatus(
            id="browser_engine",
            label="Browser Engine",
            description="Chromium browser for web automation, scraping, and remote browser control",
            status="ready",
            detail=detail,
        )

    if not has_package and not browser_found:
        detail = "Playwright package and Chromium not found — will be installed automatically"
    elif not has_package:
        detail = "Playwright package not installed — will be installed automatically"
    else:
        detail = "Chromium binary not found — will be downloaded automatically"

    return ComponentStatus(
        id="browser_engine",
        label="Browser Engine",
        description="Chromium browser for web automation, scraping, and remote browser control",
        status="not_ready",
        detail=detail,
        size_hint="~280 MB",
    )


def _check_storage_directories() -> ComponentStatus:
    """Check if core storage directories exist."""
    from app.config import (
        MATRX_NOTES_DIR, MATRX_FILES_DIR, MATRX_CODE_DIR,
        MATRX_DATA_DIR, MATRX_WORKSPACES_DIR,
    )

    dirs = {
        "Notes": MATRX_NOTES_DIR,
        "Files": MATRX_FILES_DIR,
        "Code": MATRX_CODE_DIR,
        "Data": MATRX_DATA_DIR,
        "Workspaces": MATRX_WORKSPACES_DIR,
    }
    missing = [name for name, path in dirs.items() if not os.path.isdir(str(path))]

    if not missing:
        return ComponentStatus(
            id="storage_dirs",
            label="Storage Directories",
            description="Local folders for notes, files, code, and workspace data",
            status="ready",
            detail=f"All {len(dirs)} directories ready",
        )
    return ComponentStatus(
        id="storage_dirs",
        label="Storage Directories",
        description="Local folders for notes, files, code, and workspace data",
        status="not_ready",
        detail=f"{len(missing)} directories will be created: {', '.join(missing)}",
    )


def _check_core_packages() -> ComponentStatus:
    """Verify core Python packages required by the engine are importable."""
    required = [
        ("playwright", "Browser automation"),
        ("psutil", "System monitoring"),
        ("zeroconf", "Network discovery"),
        ("sounddevice", "Audio I/O"),
        ("numpy", "Numeric computing"),
    ]
    missing = []
    for mod, label in required:
        try:
            __import__(mod)
        except ImportError:
            missing.append(label)

    if not missing:
        return ComponentStatus(
            id="core_packages",
            label="Core Engine Packages",
            description="Essential libraries for system monitoring, audio, and network features",
            status="ready",
            detail="All core packages verified",
        )
    return ComponentStatus(
        id="core_packages",
        label="Core Engine Packages",
        description="Essential libraries for system monitoring, audio, and network features",
        status="error",
        detail=f"Missing: {', '.join(missing)}. Engine may need reinstallation.",
    )


def _check_gpu() -> tuple[bool, str | None]:
    """Detect GPU availability (for transcription model recommendations)."""
    system = platform.system()
    gpu_name = None
    gpu_available = False

    if system == "Darwin":
        if platform.machine() == "arm64":
            gpu_available = True
            gpu_name = "Apple Silicon (Metal)"
    else:
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0 and result.stdout.strip():
                gpu_name = result.stdout.strip().split("\n")[0]
                gpu_available = True
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

    return gpu_available, gpu_name


def _check_transcription() -> ComponentStatus:
    """Check if a GGML model is available in the shared models directory.

    Note: whisper-cpp-plus is a Rust/Tauri binding — there is no PATH binary
    to check.  The Tauri side (get_voice_setup_status) is the authoritative
    source for whether the transcription engine itself is ready.  Here we only
    report whether a model file has been downloaded to the shared location so
    the Python setup route can show a meaningful status.
    """
    model_dir = os.path.join(str(MATRX_HOME_DIR), "models")
    model_found = False
    model_name = None

    if os.path.isdir(model_dir):
        for f in os.listdir(model_dir):
            if f.startswith("ggml-") and f.endswith(".bin") and "silero" not in f:
                model_found = True
                model_name = f
                break

    if model_found:
        return ComponentStatus(
            id="transcription",
            label="Audio Transcription",
            description="Local speech-to-text using whisper-cpp with GPU acceleration",
            status="ready",
            detail=f"Model: {model_name}",
            optional=True,
        )

    return ComponentStatus(
        id="transcription",
        label="Audio Transcription",
        description="Local speech-to-text using whisper-cpp with GPU acceleration",
        status="not_ready",
        detail="No GGML model found — click Install to download",
        optional=True,
        size_hint="~150 MB (base.en model)",
    )


async def _check_permissions() -> ComponentStatus:
    """Check OS-level permissions — advisory only, never blocks setup_complete.

    Uses only fast, read-only TCC database probes — no AVFoundation, no
    CNContactStore, no ScreenCaptureKit. Those APIs trigger native OS dialogs
    when status is notDetermined. The full permission detail is available via
    GET /devices/permissions which the Permissions modal uses separately.
    """
    system = platform.system()
    PRIVACY_DEEP_LINK = (
        "x-apple.systempreferences:com.apple.preference.security?Privacy"
    )

    if system != "Darwin":
        return ComponentStatus(
            id="permissions",
            label="Device Permissions",
            description="OS-level access for microphone, screen recording, and accessibility",
            status="ready",
            detail="No special permissions required on this platform",
        )

    # Fast read-only check: probe TCC DB for the three most important services.
    # This never triggers any dialog.
    try:
        import asyncio as _asyncio
        from app.services.permissions.checker import _tcc_db_status

        loop = _asyncio.get_event_loop()
        mic, cam, screen = await _asyncio.gather(
            loop.run_in_executor(None, _tcc_db_status, "kTCCServiceMicrophone"),
            loop.run_in_executor(None, _tcc_db_status, "kTCCServiceCamera"),
            loop.run_in_executor(None, _tcc_db_status, "kTCCServiceScreenCapture"),
        )

        from app.services.permissions.checker import PermissionStatus
        checks = {"Microphone": mic, "Camera": cam, "Screen Recording": screen}
        not_granted = [name for name, s in checks.items() if s != PermissionStatus.GRANTED]

        if not not_granted:
            return ComponentStatus(
                id="permissions",
                label="Device Permissions",
                description="OS-level access for microphone, screen recording, and accessibility",
                status="ready",
                detail="Core permissions granted (microphone, camera, screen recording)",
            )

        return ComponentStatus(
            id="permissions",
            label="Device Permissions",
            description="OS-level access for microphone, screen recording, and accessibility",
            status="warning",
            detail=f"{', '.join(not_granted)} — click Review & Grant to set up permissions",
            deep_link=PRIVACY_DEEP_LINK,
        )
    except Exception:
        return ComponentStatus(
            id="permissions",
            label="Device Permissions",
            description="OS-level access for microphone, screen recording, and accessibility",
            status="warning",
            detail="Permissions can be reviewed in the Devices tab",
            deep_link=PRIVACY_DEEP_LINK,
        )


# ---------------------------------------------------------------------------
# GET /setup/status
# ---------------------------------------------------------------------------

@router.get("/status", response_model=SetupStatus)
async def get_setup_status() -> SetupStatus:
    """Return comprehensive installation/setup status."""
    gpu_available, gpu_name = _check_gpu()

    components = [
        _check_core_packages(),
        _check_playwright_browsers(),
        _check_storage_directories(),
        await _check_permissions(),
        _check_transcription(),
    ]

    # Only blocking components determine setup_complete
    setup_complete = all(
        c.status == "ready"
        for c in components
        if c.id in _BLOCKING_COMPONENTS
    )

    return SetupStatus(
        setup_complete=setup_complete,
        components=components,
        platform=platform.system(),
        architecture=platform.machine(),
        gpu_available=gpu_available,
        gpu_name=gpu_name,
    )


# ---------------------------------------------------------------------------
# POST /setup/install — SSE stream with real-time progress
# ---------------------------------------------------------------------------

async def _sse_event(event: str, data: dict[str, Any]) -> str:
    """Format a Server-Sent Event."""
    payload = json.dumps(data)
    return f"event: {event}\ndata: {payload}\n\n"


def _build_playwright_cmd() -> list[str]:
    """Return the command list to run `playwright install chromium`.

    compute_driver_executable() returns a (node_binary, cli.js) tuple.
    str()-ing it produces a broken path — we unpack it explicitly.
    Fall back to `python -m playwright install` when the driver binary is
    not available (e.g. inside a frozen PyInstaller binary).
    """
    try:
        from playwright._impl._driver import compute_driver_executable  # type: ignore[import]
        node_exe, cli_js = compute_driver_executable()
        if not os.path.isfile(node_exe):
            raise FileNotFoundError(f"Playwright node binary not found: {node_exe}")
        return [node_exe, cli_js, "install", "chromium"]
    except Exception as exc:
        logger.info(
            "[setup_routes] Playwright driver binary unavailable (%s) — "
            "using `python -m playwright install` fallback",
            exc,
        )
        return [sys.executable, "-m", "playwright", "install", "chromium"]


async def _install_playwright_browsers(browsers_path: str):
    """Install Playwright Python package (if missing) then Chromium binary, yielding SSE events."""
    os.makedirs(browsers_path, exist_ok=True)

    yield await _sse_event("progress", {
        "component": "browser_engine",
        "status": "installing",
        "message": "Preparing browser engine installation...",
        "percent": 0,
    })

    # Step 1: Install the playwright Python package if it isn't importable yet.
    if not _check_playwright_package():
        yield await _sse_event("progress", {
            "component": "browser_engine",
            "status": "installing",
            "message": "Installing Playwright Python package...",
            "percent": 5,
        })
        try:
            pkg_proc = await asyncio.create_subprocess_exec(
                sys.executable, "-m", "pip", "install", "playwright",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            pkg_out, _ = await pkg_proc.communicate()
            if pkg_proc.returncode != 0:
                out_text = pkg_out.decode("utf-8", errors="replace").strip() if pkg_out else "(no output)"
                yield await _sse_event("progress", {
                    "component": "browser_engine",
                    "status": "error",
                    "message": f"Failed to install Playwright package: {out_text[-500:]}",
                    "percent": 0,
                })
                return
        except Exception as e:
            yield await _sse_event("progress", {
                "component": "browser_engine",
                "status": "error",
                "message": f"Could not run pip install playwright: {e}",
                "percent": 0,
            })
            return

        yield await _sse_event("progress", {
            "component": "browser_engine",
            "status": "installing",
            "message": "Playwright package installed — downloading Chromium...",
            "percent": 15,
        })

    try:
        cmd = _build_playwright_cmd()
    except Exception as e:
        yield await _sse_event("progress", {
            "component": "browser_engine",
            "status": "error",
            "message": f"Could not locate Playwright installer: {e}",
            "percent": 0,
        })
        return

    yield await _sse_event("progress", {
        "component": "browser_engine",
        "status": "installing",
        "message": f"Running: {' '.join(cmd[:3])} ... install chromium",
        "percent": 20,
    })

    env = {**os.environ, "PLAYWRIGHT_BROWSERS_PATH": browsers_path}

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
    except Exception as e:
        yield await _sse_event("progress", {
            "component": "browser_engine",
            "status": "error",
            "message": f"Failed to launch installer: {e}",
            "percent": 0,
        })
        return

    import re as _re

    output_lines: list[str] = []
    try:
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="replace").strip()
            if text:
                output_lines.append(text)
                percent = 25
                if "downloading" in text.lower():
                    percent = 40
                if "%" in text:
                    m = _re.search(r"(\d+)%", text)
                    if m:
                        percent = min(int(m.group(1)), 95)
                if "extracting" in text.lower() or "unpack" in text.lower():
                    percent = 80
                yield await _sse_event("progress", {
                    "component": "browser_engine",
                    "status": "installing",
                    "message": text,
                    "percent": percent,
                })
    except (asyncio.CancelledError, GeneratorExit):
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        await proc.wait()
        return

    await proc.wait()

    if proc.returncode == 0:
        yield await _sse_event("progress", {
            "component": "browser_engine",
            "status": "ready",
            "message": "Chromium installed successfully",
            "percent": 100,
        })
    else:
        last_lines = "\n".join(output_lines[-5:]) if output_lines else "(no output)"
        yield await _sse_event("progress", {
            "component": "browser_engine",
            "status": "error",
            "message": f"Installation failed (exit {proc.returncode}). Last output: {last_lines}",
            "percent": 0,
        })


async def _create_storage_directories():
    """Create missing storage directories, yielding SSE progress events."""
    from app.config import (
        MATRX_NOTES_DIR, MATRX_FILES_DIR, MATRX_CODE_DIR,
        MATRX_DATA_DIR, MATRX_WORKSPACES_DIR,
    )

    dirs = {
        "Notes": MATRX_NOTES_DIR,
        "Files": MATRX_FILES_DIR,
        "Code": MATRX_CODE_DIR,
        "Data": MATRX_DATA_DIR,
        "Workspaces": MATRX_WORKSPACES_DIR,
    }

    yield await _sse_event("progress", {
        "component": "storage_dirs",
        "status": "installing",
        "message": "Creating storage directories...",
        "percent": 0,
    })

    total = len(dirs)
    for idx, (name, dir_path) in enumerate(dirs.items()):
        path = Path(str(dir_path))
        if not path.is_dir():
            try:
                path.mkdir(parents=True, exist_ok=True)
            except OSError as e:
                yield await _sse_event("progress", {
                    "component": "storage_dirs",
                    "status": "error",
                    "message": f"Failed to create {name}: {e}",
                    "percent": int(((idx + 1) / total) * 100),
                })
                continue
        pct = int(((idx + 1) / total) * 100)
        yield await _sse_event("progress", {
            "component": "storage_dirs",
            "status": "installing",
            "message": f"{name} directory ready",
            "percent": min(pct, 100),
        })

    yield await _sse_event("progress", {
        "component": "storage_dirs",
        "status": "ready",
        "message": f"All {total} directories ready",
        "percent": 100,
    })


async def _install_stream(request: Request):
    """Generator that orchestrates all installation steps and yields SSE events.

    Guarantees: always emits a 'complete' event at the end (even if some
    components failed), so the frontend never sees 'stream ended unexpectedly'.
    """
    had_error = False
    error_summary: list[str] = []

    try:
        yield await _sse_event("started", {
            "component": "_system",
            "message": "Starting setup...",
            "timestamp": time.time(),
            "percent": 0,
        })

        # Step 1: Storage directories
        async for event in _create_storage_directories():
            if await request.is_disconnected():
                yield await _sse_event("cancelled", {"message": "Setup cancelled by user"})
                return
            yield event

        # Step 2: Core package verification
        status = _check_core_packages()
        yield await _sse_event("progress", {
            "component": "core_packages",
            "status": status.status,
            "message": status.detail or "Core packages verified",
            "percent": 100 if status.status == "ready" else 0,
        })
        if status.status != "ready":
            had_error = True
            error_summary.append(f"core_packages: {status.detail}")

        # Step 3: Playwright browsers (the big one)
        browser_status = _check_playwright_browsers()
        if browser_status.status != "ready":
            async for event in _install_playwright_browsers(_browsers_path()):
                if await request.is_disconnected():
                    yield await _sse_event("cancelled", {"message": "Setup cancelled by user"})
                    return
                yield event
                # Track whether browser install errored
                try:
                    parsed = json.loads(event.split("data: ", 1)[1].split("\n")[0])
                    if parsed.get("status") == "error":
                        had_error = True
                        error_summary.append(f"browser_engine: {parsed.get('message', '')}")
                except Exception:
                    pass
        else:
            yield await _sse_event("progress", {
                "component": "browser_engine",
                "status": "ready",
                "message": browser_status.detail or "Already installed",
                "percent": 100,
            })

        # Step 4: Permissions check (informational only — "warning" status, not blocking)
        try:
            perm_status = await _check_permissions()
        except Exception as e:
            logger.warning(f"Permission check failed during install: {e}")
            perm_status = ComponentStatus(
                id="permissions",
                label="Device Permissions",
                description="OS-level access for microphone, screen recording, and accessibility",
                status="warning",
                detail="Could not check permissions — this is non-blocking",
                deep_link="x-apple.systempreferences:com.apple.preference.security?Privacy",
            )
        yield await _sse_event("progress", {
            "component": "permissions",
            "status": perm_status.status,
            "message": perm_status.detail or "Permissions checked",
            "percent": 100,
            "deep_link": perm_status.deep_link,
        })

    except (asyncio.CancelledError, GeneratorExit):
        logger.info("Setup install stream cancelled by client")
        return
    except Exception as e:
        logger.error(f"Setup install stream failed: {e}", exc_info=True)
        had_error = True
        error_summary.append(str(e))
        try:
            yield await _sse_event("progress", {
                "component": "_system",
                "status": "error",
                "message": f"Setup error: {str(e)}",
                "percent": 0,
            })
        except Exception:
            pass

    # Always emit 'complete' so the frontend never triggers 'stream ended unexpectedly'
    try:
        if had_error:
            yield await _sse_event("complete", {
                "message": "Setup finished with some errors — see component details above",
                "had_errors": True,
                "errors": error_summary,
                "timestamp": time.time(),
            })
        else:
            yield await _sse_event("complete", {
                "message": "Setup complete — Matrx Local is ready to use",
                "had_errors": False,
                "errors": [],
                "timestamp": time.time(),
            })
    except Exception:
        pass


@router.post("/install")
async def run_install(request: Request):
    """Run the setup installation as an SSE stream with real-time progress."""
    return StreamingResponse(
        _install_stream(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# POST /setup/install-transcription — optional whisper GGML model download
# ---------------------------------------------------------------------------

class TranscriptionInstallRequest(BaseModel):
    model: str = "base.en"  # default to English base model


@router.post("/install-transcription")
async def install_transcription(req: TranscriptionInstallRequest, request: Request):
    """Download a GGML whisper model to ~/.matrx/models/. Returns SSE stream."""

    async def _stream():
        model_dir = os.path.join(str(MATRX_HOME_DIR), "models")
        os.makedirs(model_dir, exist_ok=True)
        model_file = f"ggml-{req.model}.bin"
        model_path = os.path.join(model_dir, model_file)

        if os.path.isfile(model_path):
            yield await _sse_event("progress", {
                "component": "transcription",
                "status": "ready",
                "message": f"Model {model_file} already downloaded",
                "percent": 100,
            })
            yield await _sse_event("complete", {
                "message": "Transcription engine ready",
                "had_errors": False,
                "errors": [],
            })
            return

        yield await _sse_event("progress", {
            "component": "transcription",
            "status": "installing",
            "message": f"Downloading {model_file} from HuggingFace...",
            "percent": 5,
        })

        model_url = f"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{model_file}"

        try:
            import httpx
            async with httpx.AsyncClient(follow_redirects=True, timeout=300) as client:
                async with client.stream("GET", model_url) as resp:
                    if resp.status_code != 200:
                        yield await _sse_event("progress", {
                            "component": "transcription",
                            "status": "error",
                            "message": f"Download failed: HTTP {resp.status_code} from {model_url}",
                            "percent": 0,
                        })
                        yield await _sse_event("complete", {
                            "message": "Transcription download failed",
                            "had_errors": True,
                            "errors": [f"HTTP {resp.status_code}"],
                        })
                        return

                    total = int(resp.headers.get("content-length", 0))
                    downloaded = 0

                    with open(model_path, "wb") as f:
                        async for chunk in resp.aiter_bytes(chunk_size=65536):
                            if await request.is_disconnected():
                                f.close()
                                if os.path.exists(model_path):
                                    os.remove(model_path)
                                yield await _sse_event("cancelled", {
                                    "message": "Download cancelled by user",
                                })
                                return
                            f.write(chunk)
                            downloaded += len(chunk)
                            pct = int((downloaded / total * 90) + 5) if total > 0 else 50
                            if downloaded % (256 * 1024) < len(chunk):
                                mb_done = downloaded / (1024 * 1024)
                                mb_total = total / (1024 * 1024) if total > 0 else 0
                                yield await _sse_event("progress", {
                                    "component": "transcription",
                                    "status": "installing",
                                    "message": (
                                        f"Downloading {model_file}: "
                                        f"{mb_done:.1f} / {mb_total:.0f} MB"
                                    ),
                                    "percent": min(pct, 99),
                                    "bytes_downloaded": downloaded,
                                    "total_bytes": total,
                                })

            yield await _sse_event("progress", {
                "component": "transcription",
                "status": "ready",
                "message": f"Model {model_file} installed successfully",
                "percent": 100,
            })
            yield await _sse_event("complete", {
                "message": "Transcription model ready",
                "had_errors": False,
                "errors": [],
            })

        except Exception as e:
            if os.path.exists(model_path):
                os.remove(model_path)
            logger.error(f"Transcription model download failed: {e}", exc_info=True)
            yield await _sse_event("progress", {
                "component": "transcription",
                "status": "error",
                "message": f"Download failed: {str(e)}",
                "percent": 0,
            })
            yield await _sse_event("complete", {
                "message": "Transcription download failed",
                "had_errors": True,
                "errors": [str(e)],
            })

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
