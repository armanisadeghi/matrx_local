"""Kokoro TTS service.

Uses kokoro-onnx for local text-to-speech via ONNX Runtime.  Both
kokoro-onnx and soundfile are core dependencies — always installed.

The service downloads the ONNX model + voice pack on first use, loads the
Kokoro instance once, and reuses it for all subsequent synthesis calls.
Synthesis runs in a thread-pool executor to avoid blocking the event loop.

Streaming mode: splits text at sentence boundaries and yields WAV chunks
as they're generated so the client can start playback almost immediately.
"""

from __future__ import annotations

import asyncio
import io
import re
import struct
import threading
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from app.common.system_logger import get_logger
from app.config import MATRX_HOME_DIR
from app.services.tts.models import (
    BUILTIN_VOICES,
    DEFAULT_VOICE_ID,
    LANGUAGE_MAP,
    ONNX_MODEL_FILENAME,
    ONNX_MODEL_SIZE_BYTES,
    ONNX_MODEL_URL,
    SAMPLE_RATE,
    VOICE_MAP,
    VOICES_BIN_FILENAME,
    VOICES_BIN_SIZE_BYTES,
    VOICES_BIN_URL,
)

logger = get_logger()

TTS_DIR = MATRX_HOME_DIR / "tts"
TTS_OUTPUT_DIR = TTS_DIR / "output"
CUSTOM_VOICES_DIR = TTS_DIR / "custom-voices"

PREVIEW_TEXT = "Hello! This is a preview of my voice. I hope you enjoy how I sound."


@dataclass
class SynthesisResult:
    success: bool
    audio_bytes: bytes | None = None
    sample_rate: int = SAMPLE_RATE
    duration_seconds: float = 0.0
    voice_id: str = ""
    elapsed_seconds: float = 0.0
    error: str | None = None


def _wav_bytes(samples, sample_rate: int) -> bytes:
    """Encode a numpy float32 array as a 16-bit PCM WAV in-memory."""
    import numpy as np

    pcm = (samples * 32767).astype(np.int16)
    buf = io.BytesIO()
    num_samples = pcm.shape[0]
    data_size = num_samples * 2  # 16-bit = 2 bytes per sample
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(pcm.tobytes())
    return buf.getvalue()


class TtsService:
    """Singleton service wrapping the Kokoro ONNX TTS model.

    Loads the model once and reuses it.  All blocking work runs in a
    thread-pool executor.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._kokoro: Any = None
        self._model_loaded = False
        self._is_downloading = False
        self._download_progress: float = 0.0

    @property
    def model_downloaded(self) -> bool:
        model_path = TTS_DIR / ONNX_MODEL_FILENAME
        voices_path = TTS_DIR / VOICES_BIN_FILENAME
        return model_path.is_file() and voices_path.is_file()

    @property
    def model_loaded(self) -> bool:
        return self._model_loaded

    def get_status(self) -> dict[str, Any]:
        return {
            "model_downloaded": self.model_downloaded,
            "model_loaded": self._model_loaded,
            "is_downloading": self._is_downloading,
            "download_progress": self._download_progress,
            "model_dir": str(TTS_DIR),
            "voice_count": len(BUILTIN_VOICES),
        }

    def list_voices(self) -> list[dict[str, Any]]:
        voices: list[dict[str, Any]] = []
        for v in BUILTIN_VOICES:
            voices.append({
                "voice_id": v.voice_id,
                "name": v.name,
                "gender": v.gender,
                "language": v.language,
                "lang_code": v.lang_code,
                "quality_grade": v.quality_grade,
                "traits": v.traits,
                "is_custom": v.is_custom,
                "is_default": v.is_default,
            })
        custom = self._load_custom_voices()
        voices.extend(custom)
        return voices

    def _load_custom_voices(self) -> list[dict[str, Any]]:
        """Scan custom-voices dir for user-created voice files."""
        if not CUSTOM_VOICES_DIR.is_dir():
            return []
        result: list[dict[str, Any]] = []
        for f in sorted(CUSTOM_VOICES_DIR.glob("*.bin")):
            vid = f.stem
            result.append({
                "voice_id": vid,
                "name": vid.replace("_", " ").title(),
                "gender": "female",
                "language": "Custom",
                "lang_code": "a",
                "quality_grade": "Custom",
                "traits": ["custom"],
                "is_custom": True,
                "is_default": False,
            })
        return result

    async def download_model(self) -> dict[str, Any]:
        """Download the ONNX model and voices pack.  Idempotent."""
        if self.model_downloaded:
            return {"success": True, "already_downloaded": True}

        if self._is_downloading:
            return {"success": False, "error": "Download already in progress"}

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._download_model_sync)

    def _emit_dm_progress(
        self,
        dl_id: str,
        display_name: str,
        status: str,
        bytes_done: int,
        total_bytes: int,
    ) -> None:
        """Emit a progress event to the universal download manager (best-effort, sync-safe)."""
        try:
            import asyncio as _asyncio
            from app.services.downloads.manager import get_download_manager, ProgressEvent
            dm = get_download_manager()

            async def _push() -> None:
                percent = (bytes_done / total_bytes * 100) if total_bytes > 0 else 0.0
                evt = ProgressEvent(
                    id=dl_id,
                    category="tts",
                    filename="kokoro-82m.onnx",
                    display_name=display_name,
                    status=status,
                    bytes_done=bytes_done,
                    total_bytes=total_bytes,
                    percent=percent,
                    part_current=1,
                    part_total=1,
                )
                await dm._broadcast(evt)

            try:
                loop = _asyncio.get_event_loop()
                if loop.is_running():
                    _asyncio.run_coroutine_threadsafe(_push(), loop)
            except Exception:
                pass
        except Exception:
            pass

    def _download_model_sync(self) -> dict[str, Any]:
        import httpx

        self._is_downloading = True
        self._download_progress = 0.0
        TTS_DIR.mkdir(parents=True, exist_ok=True)

        total_bytes = ONNX_MODEL_SIZE_BYTES + VOICES_BIN_SIZE_BYTES
        downloaded = 0
        dl_id = "tts-kokoro-model"
        self._emit_dm_progress(dl_id, "Kokoro TTS Model", "active", 0, total_bytes)

        try:
            for url, filename, expected_size in [
                (ONNX_MODEL_URL, ONNX_MODEL_FILENAME, ONNX_MODEL_SIZE_BYTES),
                (VOICES_BIN_URL, VOICES_BIN_FILENAME, VOICES_BIN_SIZE_BYTES),
            ]:
                dest = TTS_DIR / filename
                if dest.is_file() and dest.stat().st_size > 1000:
                    downloaded += expected_size
                    self._download_progress = (downloaded / total_bytes) * 100
                    self._emit_dm_progress(dl_id, "Kokoro TTS Model", "active", downloaded, total_bytes)
                    logger.info("[tts] %s already exists, skipping", filename)
                    continue

                logger.info("[tts] Downloading %s from %s", filename, url)
                tmp = dest.with_suffix(".tmp")

                with httpx.stream("GET", url, follow_redirects=True, timeout=300) as resp:
                    resp.raise_for_status()
                    last_emit = 0
                    with open(tmp, "wb") as f:
                        for chunk in resp.iter_bytes(chunk_size=1_048_576):
                            f.write(chunk)
                            downloaded += len(chunk)
                            self._download_progress = (downloaded / total_bytes) * 100
                            # Emit every 2 MB to avoid flooding
                            if downloaded - last_emit >= 2 * 1024 * 1024:
                                last_emit = downloaded
                                self._emit_dm_progress(dl_id, "Kokoro TTS Model", "active", downloaded, total_bytes)

                import shutil
                shutil.move(str(tmp), str(dest))
                logger.info("[tts] Downloaded %s (%.1f MB)", filename, dest.stat().st_size / 1_048_576)

            self._download_progress = 100.0
            self._emit_dm_progress(dl_id, "Kokoro TTS Model", "completed", total_bytes, total_bytes)
            return {"success": True}

        except Exception as exc:
            logger.error("[tts] Model download failed: %s", exc, exc_info=True)
            self._emit_dm_progress(dl_id, "Kokoro TTS Model", "failed", downloaded, total_bytes)
            return {"success": False, "error": str(exc)}
        finally:
            self._is_downloading = False

    async def ensure_loaded(self) -> dict[str, Any]:
        """Ensure model is downloaded and loaded.  Returns status dict."""
        if self._model_loaded and self._kokoro is not None:
            return {"success": True, "already_loaded": True}

        if not self.model_downloaded:
            dl = await self.download_model()
            if not dl.get("success"):
                return dl

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._load_model_sync)

    def _load_model_sync(self) -> dict[str, Any]:
        with self._lock:
            if self._model_loaded and self._kokoro is not None:
                return {"success": True, "already_loaded": True}

            try:
                from kokoro_onnx import Kokoro

                model_path = str(TTS_DIR / ONNX_MODEL_FILENAME)
                voices_path = str(TTS_DIR / VOICES_BIN_FILENAME)

                logger.info("[tts] Loading Kokoro model from %s", model_path)
                t0 = time.monotonic()
                self._kokoro = Kokoro(model_path, voices_path)
                elapsed = time.monotonic() - t0
                self._model_loaded = True
                logger.info("[tts] Model loaded in %.1fs", elapsed)
                return {"success": True, "load_time_seconds": elapsed}

            except Exception as exc:
                logger.error("[tts] Failed to load model: %s", exc, exc_info=True)
                self._kokoro = None
                self._model_loaded = False
                return {"success": False, "error": str(exc)}

    async def synthesize(
        self,
        text: str,
        voice_id: str = DEFAULT_VOICE_ID,
        speed: float = 1.0,
        lang: str | None = None,
    ) -> SynthesisResult:
        """Synthesize speech from text.  Returns WAV bytes."""
        load_result = await self.ensure_loaded()
        if not load_result.get("success"):
            return SynthesisResult(
                success=False,
                error=load_result.get("error", "Failed to load model"),
            )

        voice_info = VOICE_MAP.get(voice_id)
        if not voice_info and not (CUSTOM_VOICES_DIR / f"{voice_id}.bin").is_file():
            return SynthesisResult(
                success=False,
                error=f"Unknown voice: {voice_id}",
            )

        resolved_lang = lang
        if resolved_lang is None and voice_info:
            lmeta = LANGUAGE_MAP.get(voice_info.lang_code)
            resolved_lang = lmeta.espeak_fallback if lmeta else "en-us"
        elif resolved_lang is None:
            resolved_lang = "en-us"

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            self._synthesize_sync,
            text,
            voice_id,
            speed,
            resolved_lang,
        )

    def _synthesize_sync(
        self,
        text: str,
        voice_id: str,
        speed: float,
        lang: str,
    ) -> SynthesisResult:
        with self._lock:
            if self._kokoro is None:
                return SynthesisResult(success=False, error="Model not loaded")

            try:
                t0 = time.monotonic()

                samples, sample_rate = self._kokoro.create(
                    text,
                    voice=voice_id,
                    speed=speed,
                    lang=lang,
                )

                if samples is None or len(samples) == 0:
                    return SynthesisResult(
                        success=False,
                        error="Model returned empty audio — text may be too short or unsupported",
                    )

                audio_bytes = _wav_bytes(samples, sample_rate)
                duration = len(samples) / sample_rate
                elapsed = time.monotonic() - t0

                logger.info(
                    "[tts] Synthesized %.1fs audio in %.2fs (%.1fx real-time) voice=%s",
                    duration, elapsed, duration / max(elapsed, 0.001), voice_id,
                )

                return SynthesisResult(
                    success=True,
                    audio_bytes=audio_bytes,
                    sample_rate=sample_rate,
                    duration_seconds=duration,
                    voice_id=voice_id,
                    elapsed_seconds=elapsed,
                )

            except Exception as exc:
                logger.error("[tts] Synthesis failed: %s", exc, exc_info=True)
                return SynthesisResult(success=False, error=str(exc))

    # ── Streaming synthesis ─────────────────────────────────────────────────

    _SENTENCE_RE = re.compile(
        r'(?<=[.!?;])\s+'          # split after . ! ? ;
        r'|(?<=\n)\s*'             # or after newlines
        r'|(?<=[:])(?=\s+[A-Z])'  # or after colon when followed by capital
    )

    @staticmethod
    def _split_sentences(text: str, min_len: int = 20, max_len: int = 400) -> list[str]:
        """Split text into sentence-ish chunks suitable for incremental TTS."""
        raw_parts = TtsService._SENTENCE_RE.split(text)
        chunks: list[str] = []
        buf = ""
        for part in raw_parts:
            part = part.strip()
            if not part:
                continue
            candidate = f"{buf} {part}".strip() if buf else part
            if len(candidate) > max_len and buf:
                chunks.append(buf)
                buf = part
            else:
                buf = candidate
            if len(buf) >= min_len and buf[-1] in ".!?;\n":
                chunks.append(buf)
                buf = ""
        if buf.strip():
            chunks.append(buf.strip())
        return chunks

    async def synthesize_stream(
        self,
        text: str,
        voice_id: str = DEFAULT_VOICE_ID,
        speed: float = 1.0,
        lang: str | None = None,
    ) -> AsyncIterator[bytes]:
        """Yield WAV chunks for each sentence.

        Each chunk is a complete, playable WAV so the client can decode
        and enqueue them independently for gapless playback.
        """
        load_result = await self.ensure_loaded()
        if not load_result.get("success"):
            return

        voice_info = VOICE_MAP.get(voice_id)
        resolved_lang = lang
        if resolved_lang is None and voice_info:
            lmeta = LANGUAGE_MAP.get(voice_info.lang_code)
            resolved_lang = lmeta.espeak_fallback if lmeta else "en-us"
        elif resolved_lang is None:
            resolved_lang = "en-us"

        chunks = self._split_sentences(text)
        if not chunks:
            return

        loop = asyncio.get_running_loop()
        for chunk_text in chunks:
            result = await loop.run_in_executor(
                None, self._synthesize_sync, chunk_text, voice_id, speed, resolved_lang,
            )
            if result.success and result.audio_bytes:
                yield result.audio_bytes

    async def preview_voice(self, voice_id: str) -> SynthesisResult:
        """Generate a short preview clip for a voice."""
        return await self.synthesize(
            text=PREVIEW_TEXT,
            voice_id=voice_id,
            speed=1.0,
        )

    async def unload(self) -> dict[str, Any]:
        """Unload the model to free memory."""
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._unload_sync)
        return {"success": True}

    def _unload_sync(self) -> None:
        with self._lock:
            if self._kokoro is not None:
                del self._kokoro
                self._kokoro = None
                self._model_loaded = False
                logger.info("[tts] Model unloaded")


_service: TtsService | None = None


def get_tts_service() -> TtsService:
    global _service
    if _service is None:
        _service = TtsService()
    return _service
