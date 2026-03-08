"""First-run setup status & installation endpoints.

Provides:
- GET  /setup/status   → comprehensive check of what is installed / configured
- POST /setup/install  → SSE stream that installs missing components with live progress
- POST /setup/install-transcription → Install whisper-cpp-plus + ggml model (optional)
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
    status: str  # "ready" | "not_ready" | "installing" | "error" | "skipped"
    detail: str | None = None
    optional: bool = False
    size_hint: str | None = None  # e.g. "~280 MB"


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

def _browsers_path() -> str:
    return os.environ.get(
        "PLAYWRIGHT_BROWSERS_PATH",
        os.path.join(os.path.expanduser("~"), ".matrx", "playwright-browsers"),
    )


def _check_playwright_browsers() -> ComponentStatus:
    """Check if Playwright browser binaries (Chromium at minimum) are installed."""
    browsers_path = _browsers_path()
    markers = ("chromium-", "chromium_headless_shell-")
    found = False
    version = None

    if os.path.isdir(browsers_path):
        for entry in os.listdir(browsers_path):
            if any(entry.startswith(m) for m in markers):
                found = True
                # Try to extract version from dir name like "chromium-1140"
                parts = entry.split("-", 1)
                if len(parts) == 2:
                    version = parts[1]
                break

    if found:
        detail = f"Chromium {version}" if version else "Chromium installed"
        return ComponentStatus(
            id="browser_engine",
            label="Browser Engine",
            description="Chromium browser for web automation, scraping, and remote browser control",
            status="ready",
            detail=detail,
        )
    return ComponentStatus(
        id="browser_engine",
        label="Browser Engine",
        description="Chromium browser for web automation, scraping, and remote browser control",
        status="not_ready",
        detail="Chromium not found — will be downloaded automatically",
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
        # macOS — check for Apple Silicon (Metal GPU)
        if platform.machine() == "arm64":
            gpu_available = True
            gpu_name = "Apple Silicon (Metal)"
        else:
            # Intel Mac — no useful GPU for ML
            gpu_available = False
            gpu_name = None
    else:
        # Linux/Windows — check for NVIDIA GPU via nvidia-smi
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
    """Check if whisper-cpp-plus and a GGML model are available."""
    # Check for whisper-cpp-plus binary
    whisper_bin = shutil.which("whisper-cpp-plus") or shutil.which("whisper-cpp")
    model_dir = os.path.join(str(MATRX_HOME_DIR), "models")
    model_found = False
    model_name = None

    if os.path.isdir(model_dir):
        for f in os.listdir(model_dir):
            if f.startswith("ggml-") and f.endswith(".bin"):
                model_found = True
                model_name = f
                break

    if whisper_bin and model_found:
        return ComponentStatus(
            id="transcription",
            label="Audio Transcription",
            description="Local speech-to-text using whisper-cpp with GPU acceleration",
            status="ready",
            detail=f"Model: {model_name}",
            optional=True,
        )

    parts = []
    if not whisper_bin:
        parts.append("whisper-cpp-plus not installed")
    if not model_found:
        parts.append("No GGML model found")

    return ComponentStatus(
        id="transcription",
        label="Audio Transcription",
        description="Local speech-to-text using whisper-cpp with GPU acceleration",
        status="not_ready",
        detail="; ".join(parts),
        optional=True,
        size_hint="~150 MB (base.en model)",
    )


async def _check_permissions() -> ComponentStatus:
    """Check OS-level permissions (macOS TCC, etc.)."""
    system = platform.system()
    if system != "Darwin":
        return ComponentStatus(
            id="permissions",
            label="Device Permissions",
            description="OS-level access for microphone, screen recording, and accessibility",
            status="ready",
            detail="No special permissions required on this platform",
        )

    # On macOS, check key TCC permissions
    granted = 0
    total = 0
    try:
        from app.services.permissions.checker import check_all_permissions
        perms = await check_all_permissions()
        total = len(perms)
        granted = sum(1 for p in perms if p.get("status") == "granted")
    except Exception:
        return ComponentStatus(
            id="permissions",
            label="Device Permissions",
            description="OS-level access for microphone, screen recording, and accessibility",
            status="not_ready",
            detail="Could not check permissions — grant access in System Settings",
        )

    if granted == total:
        return ComponentStatus(
            id="permissions",
            label="Device Permissions",
            description="OS-level access for microphone, screen recording, and accessibility",
            status="ready",
            detail=f"All {total} permissions granted",
        )

    return ComponentStatus(
        id="permissions",
        label="Device Permissions",
        description="OS-level access for microphone, screen recording, and accessibility",
        status="not_ready",
        detail=f"{granted}/{total} permissions granted — some features may be limited",
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

    # Setup is "complete" if all non-optional components are ready
    setup_complete = all(
        c.status == "ready"
        for c in components
        if not c.optional
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


async def _install_playwright_browsers(browsers_path: str):
    """Install Playwright Chromium browser, yielding SSE progress events."""
    os.makedirs(browsers_path, exist_ok=True)

    yield await _sse_event("progress", {
        "component": "browser_engine",
        "status": "installing",
        "message": "Downloading Chromium browser...",
        "percent": 0,
    })

    try:
        from playwright._impl._driver import compute_driver_executable
        driver_exe = str(compute_driver_executable())
    except Exception as e:
        yield await _sse_event("progress", {
            "component": "browser_engine",
            "status": "error",
            "message": f"Could not locate Playwright driver: {e}",
            "percent": 0,
        })
        return

    env = {**os.environ, "PLAYWRIGHT_BROWSERS_PATH": browsers_path}

    proc = await asyncio.create_subprocess_exec(
        driver_exe, "install", "chromium",
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    import re as _re

    # Stream output lines as progress
    output_lines: list[str] = []
    try:
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="replace").strip()
            if text:
                output_lines.append(text)
                # Estimate progress from Playwright output patterns
                percent = 10
                if "downloading" in text.lower():
                    percent = 30
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
        # Client disconnected — kill the subprocess
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
        yield await _sse_event("progress", {
            "component": "browser_engine",
            "status": "error",
            "message": f"Installation failed (exit code {proc.returncode})",
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
    """Generator that orchestrates all installation steps and yields SSE events."""

    try:
        yield await _sse_event("started", {
            "message": "Starting setup...",
            "timestamp": time.time(),
        })

        # Step 1: Storage directories
        async for event in _create_storage_directories():
            yield event

        # Step 2: Core package verification
        status = _check_core_packages()
        yield await _sse_event("progress", {
            "component": "core_packages",
            "status": status.status,
            "message": status.detail or "Core packages verified",
            "percent": 100 if status.status == "ready" else 0,
        })

        # Step 3: Playwright browsers (the big one)
        browser_status = _check_playwright_browsers()
        if browser_status.status != "ready":
            async for event in _install_playwright_browsers(_browsers_path()):
                # Check if client disconnected
                if await request.is_disconnected():
                    yield await _sse_event("cancelled", {
                        "message": "Setup cancelled by user",
                    })
                    return
                yield event
        else:
            yield await _sse_event("progress", {
                "component": "browser_engine",
                "status": "ready",
                "message": browser_status.detail or "Already installed",
                "percent": 100,
            })

        # Step 4: Permissions check (informational only — can't auto-grant)
        try:
            perm_status = await _check_permissions()
        except Exception as e:
            logger.warning(f"Permission check failed during install: {e}")
            perm_status = ComponentStatus(
                id="permissions",
                label="Device Permissions",
                description="OS-level access for microphone, screen recording, and accessibility",
                status="not_ready",
                detail="Could not check permissions — this is non-blocking",
            )
        yield await _sse_event("progress", {
            "component": "permissions",
            "status": perm_status.status,
            "message": perm_status.detail or "Permissions checked",
            "percent": 100,
        })

        # Final status
        yield await _sse_event("complete", {
            "message": "Setup complete — Matrx Local is ready to use",
            "timestamp": time.time(),
        })

    except (asyncio.CancelledError, GeneratorExit):
        # Client disconnected mid-stream — expected, no error needed
        logger.info("Setup install stream cancelled by client")
    except Exception as e:
        logger.error(f"Setup install stream failed: {e}", exc_info=True)
        try:
            yield await _sse_event("progress", {
                "component": "_system",
                "status": "error",
                "message": f"Setup error: {str(e)}",
                "percent": 0,
            })
        except Exception:
            pass  # Stream may already be closed


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
# POST /setup/install-transcription — optional whisper-cpp + model install
# ---------------------------------------------------------------------------

class TranscriptionInstallRequest(BaseModel):
    model: str = "base.en"  # default to English base model


@router.post("/install-transcription")
async def install_transcription(req: TranscriptionInstallRequest, request: Request):
    """Install whisper-cpp-plus and download a GGML model. Returns SSE stream."""

    async def _stream():
        model_dir = os.path.join(str(MATRX_HOME_DIR), "models")
        os.makedirs(model_dir, exist_ok=True)
        model_file = f"ggml-{req.model}.bin"
        model_path = os.path.join(model_dir, model_file)

        # Check if model already exists
        if os.path.isfile(model_path):
            yield await _sse_event("progress", {
                "component": "transcription",
                "status": "ready",
                "message": f"Model {model_file} already downloaded",
                "percent": 100,
            })
            yield await _sse_event("complete", {
                "message": "Transcription engine ready",
            })
            return

        yield await _sse_event("progress", {
            "component": "transcription",
            "status": "installing",
            "message": f"Downloading {model_file}...",
            "percent": 10,
        })

        # Download the GGML model from Hugging Face
        model_url = f"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{model_file}"

        try:
            import httpx
            async with httpx.AsyncClient(follow_redirects=True, timeout=300) as client:
                async with client.stream("GET", model_url) as resp:
                    if resp.status_code != 200:
                        yield await _sse_event("progress", {
                            "component": "transcription",
                            "status": "error",
                            "message": f"Download failed: HTTP {resp.status_code}",
                            "percent": 0,
                        })
                        return

                    total = int(resp.headers.get("content-length", 0))
                    downloaded = 0

                    with open(model_path, "wb") as f:
                        async for chunk in resp.aiter_bytes(chunk_size=65536):
                            if await request.is_disconnected():
                                # Clean up partial download
                                f.close()
                                if os.path.exists(model_path):
                                    os.remove(model_path)
                                yield await _sse_event("cancelled", {
                                    "message": "Download cancelled",
                                })
                                return
                            f.write(chunk)
                            downloaded += len(chunk)
                            pct = int((downloaded / total * 90) + 10) if total > 0 else 50
                            if downloaded % (256 * 1024) < len(chunk):  # Update every ~256KB
                                mb_done = downloaded / (1024 * 1024)
                                mb_total = total / (1024 * 1024) if total > 0 else 0
                                yield await _sse_event("progress", {
                                    "component": "transcription",
                                    "status": "installing",
                                    "message": f"Downloading... {mb_done:.0f} / {mb_total:.0f} MB",
                                    "percent": min(pct, 99),
                                })

            yield await _sse_event("progress", {
                "component": "transcription",
                "status": "ready",
                "message": f"Model {model_file} installed successfully",
                "percent": 100,
            })
            yield await _sse_event("complete", {
                "message": "Transcription engine ready",
            })

        except Exception as e:
            # Clean up partial download
            if os.path.exists(model_path):
                os.remove(model_path)
            logger.error(f"Transcription model download failed: {e}", exc_info=True)
            yield await _sse_event("progress", {
                "component": "transcription",
                "status": "error",
                "message": f"Download failed: {str(e)}",
                "percent": 0,
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
