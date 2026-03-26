"""Text-to-speech API routes (Kokoro-82M via ONNX Runtime).

All imports of the optional kokoro-onnx package are behind the service
boundary — this module is safe to import even when those packages are not
installed.  Endpoints return HTTP 503 with a clear installation message
when the optional dependencies are absent.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.services.tts.service import get_tts_service

router = APIRouter(prefix="/tts", tags=["tts"])


# ── Request / Response schemas ────────────────────────────────────────────────

class TtsStatusResponse(BaseModel):
    available: bool
    unavailable_reason: str | None = None
    model_downloaded: bool
    model_loaded: bool
    is_downloading: bool
    download_progress: float
    model_dir: str
    voice_count: int


class TtsVoiceInfo(BaseModel):
    voice_id: str
    name: str
    gender: str
    language: str
    lang_code: str
    quality_grade: str
    traits: list[str] = []
    is_custom: bool = False
    is_default: bool = False


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=50_000)
    voice_id: str = Field(default="af_heart")
    speed: float = Field(default=1.0, ge=0.25, le=4.0)
    lang: str | None = Field(default=None, description="Override espeak language code (e.g. 'en-us')")


class SynthesizeResponse(BaseModel):
    success: bool
    duration_seconds: float = 0.0
    voice_id: str = ""
    elapsed_seconds: float = 0.0
    sample_rate: int = 24000
    error: str | None = None


class PreviewVoiceRequest(BaseModel):
    voice_id: str


class DownloadResponse(BaseModel):
    success: bool
    already_downloaded: bool = False
    error: str | None = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

def _require_available() -> None:
    svc = get_tts_service()
    if not svc.available:
        raise HTTPException(
            status_code=503,
            detail=f"Text-to-speech not available: {svc.unavailable_reason}",
        )


@router.get("/status", response_model=TtsStatusResponse)
async def tts_status() -> TtsStatusResponse:
    svc = get_tts_service()
    return TtsStatusResponse(**svc.get_status())


@router.get("/voices", response_model=list[TtsVoiceInfo])
async def list_voices() -> list[TtsVoiceInfo]:
    svc = get_tts_service()
    return [TtsVoiceInfo(**v) for v in svc.list_voices()]


@router.post("/download-model", response_model=DownloadResponse)
async def download_model() -> DownloadResponse:
    _require_available()
    svc = get_tts_service()
    result = await svc.download_model()
    return DownloadResponse(**result)


@router.post("/synthesize")
async def synthesize(req: SynthesizeRequest) -> Response:
    """Generate speech from text.

    Returns audio/wav bytes directly (not JSON).  The Content-Type is
    ``audio/wav`` so the browser / frontend can play it with <audio> or
    the Web Audio API.
    """
    _require_available()
    svc = get_tts_service()
    result = await svc.synthesize(
        text=req.text,
        voice_id=req.voice_id,
        speed=req.speed,
        lang=req.lang,
    )
    if not result.success or result.audio_bytes is None:
        raise HTTPException(status_code=500, detail=result.error or "Synthesis failed")

    return Response(
        content=result.audio_bytes,
        media_type="audio/wav",
        headers={
            "X-TTS-Duration": str(result.duration_seconds),
            "X-TTS-Voice": result.voice_id,
            "X-TTS-Elapsed": str(result.elapsed_seconds),
            "X-TTS-Sample-Rate": str(result.sample_rate),
        },
    )


@router.post("/synthesize-json", response_model=SynthesizeResponse)
async def synthesize_json(req: SynthesizeRequest) -> SynthesizeResponse:
    """Generate speech — returns metadata only (no audio bytes).

    Use /synthesize for actual audio.  This endpoint is for checking
    synthesis feasibility or getting timing data.
    """
    _require_available()
    svc = get_tts_service()
    result = await svc.synthesize(
        text=req.text,
        voice_id=req.voice_id,
        speed=req.speed,
        lang=req.lang,
    )
    return SynthesizeResponse(
        success=result.success,
        duration_seconds=result.duration_seconds,
        voice_id=result.voice_id,
        elapsed_seconds=result.elapsed_seconds,
        sample_rate=result.sample_rate,
        error=result.error,
    )


@router.post("/preview-voice")
async def preview_voice(req: PreviewVoiceRequest) -> Response:
    """Generate a short preview clip for a given voice."""
    _require_available()
    svc = get_tts_service()
    result = await svc.preview_voice(req.voice_id)
    if not result.success or result.audio_bytes is None:
        raise HTTPException(status_code=500, detail=result.error or "Preview failed")

    return Response(
        content=result.audio_bytes,
        media_type="audio/wav",
        headers={
            "X-TTS-Duration": str(result.duration_seconds),
            "X-TTS-Voice": result.voice_id,
        },
    )


@router.delete("/unload")
async def unload() -> dict:
    svc = get_tts_service()
    return await svc.unload()
