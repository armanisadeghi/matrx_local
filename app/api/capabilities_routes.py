"""Optional capability detection and installation management.

Reports which optional packages are available in the engine's environment
and exposes an install endpoint so the UI can trigger installation without
requiring the user to touch a terminal.
"""

from __future__ import annotations

import importlib.metadata
import importlib.util
import subprocess
import sys
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.common.system_logger import get_logger

logger = get_logger()
router = APIRouter(prefix="/capabilities", tags=["capabilities"])


# ---------------------------------------------------------------------------
# Capability definitions
# ---------------------------------------------------------------------------

CapabilityStatus = Literal["installed", "not_installed", "checking"]


class Capability(BaseModel):
    id: str
    name: str
    description: str
    status: CapabilityStatus
    packages: list[str]
    install_extra: str | None = None
    size_warning: str | None = None
    docs_url: str | None = None


class CapabilitiesResponse(BaseModel):
    capabilities: list[Capability]


class InstallRequest(BaseModel):
    capability_id: str


class InstallResponse(BaseModel):
    success: bool
    message: str


# Map of capability_id → (display_name, description, probe_module, packages, extra, size_warning, docs_url)
CAPABILITY_SPECS: dict[str, dict] = {
    "browser_automation": {
        "name": "Browser Automation",
        "description": "Control a real browser (Chromium, Firefox, or WebKit) to navigate websites, click elements, fill forms, and take screenshots. Powers BrowserNavigate, BrowserClick, BrowserExtract, BrowserScreenshot, and BrowserEval tools.",
        "probe_module": "playwright",
        "packages": ["playwright"],
        "install_extra": None,
        "size_warning": None,
        "docs_url": "https://playwright.dev/python/",
    },
    "audio_recording": {
        "name": "Audio Recording & Playback",
        "description": "Record from microphone and play audio files. Powers the RecordAudio, PlayAudio, and ListAudioDevices tools.",
        "probe_module": "sounddevice",
        "packages": ["sounddevice", "numpy"],
        "install_extra": None,
        "size_warning": None,
        "docs_url": "https://python-sounddevice.readthedocs.io/",
    },
    "transcription": {
        "name": "Speech Transcription (Whisper)",
        "description": "Transcribe audio files to text using OpenAI Whisper running locally. Powers the TranscribeAudio tool. Requires PyTorch — large download.",
        "probe_module": "whisper",
        "packages": ["openai-whisper"],
        "install_extra": "transcription",
        "size_warning": "~2 GB download (includes PyTorch)",
        "docs_url": "https://github.com/openai/whisper",
    },
    "ocr": {
        "name": "OCR (Image Text Extraction)",
        "description": "Extract text from images using Tesseract. Powers the ImageOCR tool. Tesseract data files are bundled in the sidecar — no separate system install needed.",
        "probe_module": "pytesseract",
        "packages": ["pytesseract"],
        "install_extra": None,
        "size_warning": None,
        "docs_url": "https://github.com/madmaze/pytesseract",
    },
    "pdf_extraction": {
        "name": "PDF Extraction",
        "description": "Extract text, images, and metadata from PDF files. Powers the PdfExtract tool.",
        "probe_module": "fitz",
        "packages": ["PyMuPDF"],
        "install_extra": None,
        "size_warning": None,
        "docs_url": "https://pymupdf.readthedocs.io/",
    },
    "system_monitoring": {
        "name": "System Monitoring",
        "description": "Monitor CPU, RAM, disk usage, battery, and top processes. Powers the SystemResources, BatteryStatus, DiskUsage, and TopProcesses tools.",
        "probe_module": "psutil",
        "packages": ["psutil"],
        "install_extra": None,
        "size_warning": None,
        "docs_url": "https://psutil.readthedocs.io/",
    },
    "network_discovery": {
        "name": "Network Discovery (mDNS)",
        "description": "Discover devices and services on the local network via mDNS/Bonjour. Powers the MDNSDiscover tool.",
        "probe_module": "zeroconf",
        "packages": ["zeroconf"],
        "install_extra": None,
        "size_warning": None,
        "docs_url": "https://python-zeroconf.readthedocs.io/",
    },
    "media_download": {
        "name": "Media Downloading (yt-dlp)",
        "description": "Download videos/audio from YouTube, Twitter, Instagram, and 1000+ other sites. Powers the DownloadMedia tool. Bundled in the sidecar by default.",
        "probe_module": "yt_dlp",
        "packages": ["yt-dlp"],
        "install_extra": None,
        "size_warning": None,
        "docs_url": "https://github.com/yt-dlp/yt-dlp",
    },
    "video_processing": {
        "name": "Video Processing (ffmpeg)",
        "description": "Convert, trim, merge, and process audio/video files. Powers audio conversion and video extraction tools. Uses imageio-ffmpeg which bundles ffmpeg — no system install needed.",
        "probe_module": "imageio_ffmpeg",
        "packages": ["imageio-ffmpeg"],
        "install_extra": None,
        "size_warning": None,
        "docs_url": "https://github.com/imageio/imageio-ffmpeg",
    },
}


def _check_module(module_name: str) -> bool:
    """Return True if the module can be found in the current interpreter."""
    # fitz (PyMuPDF) needs special handling — the package is PyMuPDF but the
    # module ships as `fitz`. We also need to distinguish it from the bogus
    # `fitz` stub package that matrx-utils historically pulled in.
    if module_name == "fitz":
        try:
            importlib.metadata.version("PyMuPDF")
            return True
        except importlib.metadata.PackageNotFoundError:
            return False
    return importlib.util.find_spec(module_name) is not None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=CapabilitiesResponse)
async def get_capabilities() -> CapabilitiesResponse:
    """Return the status of every optional capability."""
    caps: list[Capability] = []
    for cap_id, spec in CAPABILITY_SPECS.items():
        installed = _check_module(spec["probe_module"])
        caps.append(
            Capability(
                id=cap_id,
                name=spec["name"],
                description=spec["description"],
                status="installed" if installed else "not_installed",
                packages=spec["packages"],
                install_extra=spec.get("install_extra"),
                size_warning=spec.get("size_warning"),
                docs_url=spec.get("docs_url"),
            )
        )
    return CapabilitiesResponse(capabilities=caps)


@router.post("/install", response_model=InstallResponse)
async def install_capability(req: InstallRequest) -> InstallResponse:
    """Install an optional capability by running pip in the current venv."""
    spec = CAPABILITY_SPECS.get(req.capability_id)
    if not spec:
        raise HTTPException(
            status_code=404, detail=f"Unknown capability: {req.capability_id}"
        )

    packages = spec["packages"]
    logger.info(f"Installing capability '{req.capability_id}': {packages}")

    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", *packages],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode != 0:
            logger.error(f"pip install failed: {result.stderr}")
            return InstallResponse(
                success=False,
                message=result.stderr.strip() or "Installation failed.",
            )

        # For Playwright, also install all browsers
        if req.capability_id == "browser_automation":
            browser_result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "playwright",
                    "install",
                    "chromium",
                    "firefox",
                    "webkit",
                ],
                capture_output=True,
                text=True,
                timeout=600,  # Larger timeout — 3 browsers to download
            )
            if browser_result.returncode != 0:
                return InstallResponse(
                    success=False,
                    message=f"Playwright installed but browser download failed: {browser_result.stderr.strip()}",
                )

        logger.info(f"Capability '{req.capability_id}' installed successfully")
        return InstallResponse(
            success=True, message=f"Installed: {', '.join(packages)}"
        )

    except subprocess.TimeoutExpired:
        return InstallResponse(
            success=False, message="Installation timed out after 5 minutes."
        )
    except Exception as exc:
        logger.exception(f"Unexpected error installing '{req.capability_id}'")
        return InstallResponse(success=False, message=str(exc))
