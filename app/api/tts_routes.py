"""Text-to-speech API routes (Kokoro-82M via ONNX Runtime)."""

from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from app.services.tts.service import get_tts_service

router = APIRouter(prefix="/tts", tags=["tts"])


# ── Request / Response schemas ────────────────────────────────────────────────

class TtsStatusResponse(BaseModel):
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
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
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


@router.post("/synthesize-stream")
async def synthesize_stream(req: SynthesizeRequest) -> StreamingResponse:
    """Stream speech as a sequence of WAV chunks separated by a 4-byte length prefix.

    Uses the kokoro-onnx native create_stream() which chunks at the phoneme-batch
    level (~510 phonemes, roughly 2-4 words per chunk).  This yields the first audio
    chunk in ~200-400ms instead of waiting for a complete sentence, giving near
    real-time playback start even for long texts.

    Wire format (repeated until EOF):
      4 bytes big-endian uint32  — byte length of the following WAV blob
      N bytes                    — complete self-contained WAV file for that chunk

    The client reads length + blob in a loop and enqueues each WAV for gapless
    sequential playback.
    """
    import struct as _struct

    svc = get_tts_service()

    load_result = await svc.ensure_loaded()
    if not load_result.get("success"):
        raise HTTPException(status_code=500, detail=load_result.get("error", "Failed to load model"))

    async def _generate() -> AsyncIterator[bytes]:
        async for wav_bytes in svc.synthesize_stream(
            text=req.text,
            voice_id=req.voice_id,
            speed=req.speed,
            lang=req.lang,
        ):
            yield _struct.pack(">I", len(wav_bytes))
            yield wav_bytes

    return StreamingResponse(
        _generate(),
        media_type="application/octet-stream",
        headers={
            "X-TTS-Voice": req.voice_id,
            "X-TTS-Format": "chunked-wav",
            "X-TTS-Chunk-Granularity": "phoneme-batch",
            "Cache-Control": "no-cache",
        },
    )


@router.post("/preview-voice")
async def preview_voice(req: PreviewVoiceRequest) -> Response:
    """Generate a short preview clip for a given voice."""
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
