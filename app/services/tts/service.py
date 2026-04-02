"""Kokoro TTS service.

Uses kokoro-onnx for local text-to-speech via ONNX Runtime.  Both
kokoro-onnx and soundfile are core dependencies — always installed.

The service downloads the ONNX model + voice pack on first use, loads the
Kokoro instance once, and reuses it for all subsequent synthesis calls.
Synthesis runs in a thread-pool executor to avoid blocking the event loop.

Streaming mode: uses kokoro-onnx native create_stream() which splits at the
phoneme-batch level (~510 phonemes, ~2-4 words) and yields chunks immediately.

Voice blending: voices are (510, 1, 256) float32 numpy arrays stored in the
voices-v1.0.bin NpzFile.  Any weighted linear combination of those arrays is
itself a valid voice embedding and can be passed directly to create() /
create_stream() instead of a voice-id string.  Blended voices are saved as
.npy files in CUSTOM_VOICES_DIR for persistence.
"""

from __future__ import annotations

import asyncio
import io
import json
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

_SAFE_ID_RE = re.compile(r"[^a-z0-9_-]")


def _sanitize_voice_id(raw: str) -> str:
    """Convert arbitrary text to a filesystem-safe voice identifier."""
    cleaned = raw.lower().strip().replace(" ", "_")
    cleaned = _SAFE_ID_RE.sub("", cleaned)
    return cleaned[:64]


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
        return (
            model_path.is_file()
            and model_path.stat().st_size >= ONNX_MODEL_SIZE_BYTES * 0.99
            and voices_path.is_file()
            and voices_path.stat().st_size >= VOICES_BIN_SIZE_BYTES * 0.99
        )

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
        """Scan CUSTOM_VOICES_DIR for .npy blend files and any legacy .bin files."""
        if not CUSTOM_VOICES_DIR.is_dir():
            return []
        result: list[dict[str, Any]] = []
        seen: set[str] = set()

        # Primary format: .npy with optional .json sidecar
        for f in sorted(CUSTOM_VOICES_DIR.glob("*.npy")):
            vid = f.stem
            seen.add(vid)
            meta = self._read_voice_meta(vid)
            result.append({
                "voice_id": vid,
                "name": meta.get("name", vid.replace("_", " ").title()),
                "gender": meta.get("gender", "female"),
                "language": meta.get("language", "Custom"),
                "lang_code": meta.get("lang_code", "a"),
                "quality_grade": "Custom",
                "traits": meta.get("traits", ["blended"]),
                "is_custom": True,
                "is_default": False,
                "blend_recipe": meta.get("blend_recipe", []),
            })

        # Legacy .bin support
        for f in sorted(CUSTOM_VOICES_DIR.glob("*.bin")):
            vid = f.stem
            if vid in seen:
                continue
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
                "blend_recipe": [],
            })
        return result

    def _read_voice_meta(self, voice_id: str) -> dict[str, Any]:
        meta_path = CUSTOM_VOICES_DIR / f"{voice_id}.json"
        if meta_path.is_file():
            try:
                return json.loads(meta_path.read_text())
            except Exception:
                pass
        return {}

    def _write_voice_meta(self, voice_id: str, meta: dict[str, Any]) -> None:
        CUSTOM_VOICES_DIR.mkdir(parents=True, exist_ok=True)
        meta_path = CUSTOM_VOICES_DIR / f"{voice_id}.json"
        meta_path.write_text(json.dumps(meta, indent=2))

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
                if dest.is_file() and dest.stat().st_size >= expected_size * 0.99:
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

    def _resolve_voice_arg(self, voice_id: str):
        """Return (voice_arg, lang_code) where voice_arg is a str ID or numpy array.

        Builtin voices pass the str ID so kokoro-onnx resolves them from the
        loaded NpzFile.  Custom .npy voices are loaded as numpy arrays since
        kokoro-onnx only knows builtin IDs.
        """
        voice_info = VOICE_MAP.get(voice_id)
        if voice_info:
            lmeta = LANGUAGE_MAP.get(voice_info.lang_code)
            resolved_lang = lmeta.espeak_fallback if lmeta else "en-us"
            return voice_id, resolved_lang

        # Try custom .npy
        npy_path = CUSTOM_VOICES_DIR / f"{voice_id}.npy"
        if npy_path.is_file():
            import numpy as np
            emb = np.load(str(npy_path))
            meta = self._read_voice_meta(voice_id)
            lang_code = meta.get("lang_code", "a")
            lmeta = LANGUAGE_MAP.get(lang_code)
            resolved_lang = lmeta.espeak_fallback if lmeta else "en-us"
            return emb, resolved_lang

        # Legacy .bin custom
        bin_path = CUSTOM_VOICES_DIR / f"{voice_id}.bin"
        if bin_path.is_file():
            return voice_id, "en-us"

        return None, "en-us"

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

        voice_arg, resolved_lang = self._resolve_voice_arg(voice_id)
        if voice_arg is None:
            return SynthesisResult(success=False, error=f"Unknown voice: {voice_id}")
        if lang is not None:
            resolved_lang = lang

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            self._synthesize_sync,
            text,
            voice_arg,
            speed,
            resolved_lang,
            voice_id,
        )

    def _synthesize_sync(
        self,
        text: str,
        voice_arg: Any,  # str ID or numpy array
        speed: float,
        lang: str,
        voice_id: str = "",
    ) -> SynthesisResult:
        # Grab a reference under lock (does not hold the lock during inference —
        # the ONNX session is thread-safe and create_stream also runs executor
        # tasks concurrently, so holding the lock here would cause deadlocks).
        with self._lock:
            kokoro = self._kokoro
        if kokoro is None:
            return SynthesisResult(success=False, error="Model not loaded")

        try:
            t0 = time.monotonic()

            samples, sample_rate = kokoro.create(
                text,
                voice=voice_arg,
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

    async def synthesize_stream(
        self,
        text: str,
        voice_id: str = DEFAULT_VOICE_ID,
        speed: float = 1.0,
        lang: str | None = None,
    ) -> AsyncIterator[bytes]:
        """Yield WAV chunks using kokoro-onnx native create_stream().

        create_stream() splits text at the phoneme-batch level (~510 phonemes,
        roughly 2-4 words) and processes each batch concurrently in a thread
        executor.  This yields the first audio chunk in ~200-400ms instead of
        waiting for a full sentence, giving near-real-time playback start.

        Each yielded value is a complete, self-contained WAV blob so the client
        can decode and enqueue them independently for gapless playback.

        Supports both builtin voice IDs and custom .npy voices.
        """
        load_result = await self.ensure_loaded()
        if not load_result.get("success"):
            return

        if not text.strip():
            return

        voice_arg, resolved_lang = self._resolve_voice_arg(voice_id)
        if voice_arg is None:
            logger.error("[tts] Unknown voice '%s' for streaming", voice_id)
            return
        if lang is not None:
            resolved_lang = lang

        with self._lock:
            if self._kokoro is None:
                return
            kokoro = self._kokoro

        chunk_index = 0
        try:
            async for audio_chunk, sample_rate in kokoro.create_stream(
                text=text,
                voice=voice_arg,
                speed=speed,
                lang=resolved_lang,
            ):
                if audio_chunk is None or len(audio_chunk) == 0:
                    continue
                wav = _wav_bytes(audio_chunk, sample_rate)
                duration = len(audio_chunk) / sample_rate
                logger.debug(
                    "[tts] Stream chunk %d: %.2fs audio, %d bytes WAV",
                    chunk_index, duration, len(wav),
                )
                chunk_index += 1
                yield wav
        except Exception as exc:
            logger.error("[tts] Stream synthesis error at chunk %d: %s", chunk_index, exc, exc_info=True)

    # ── Voice blending & custom voice management ────────────────────────────

    def _get_builtin_embedding(self, voice_id: str):
        """Return the raw numpy embedding for a builtin voice from the .bin pack."""
        import numpy as np
        voices_path = TTS_DIR / VOICES_BIN_FILENAME
        if not voices_path.is_file():
            raise FileNotFoundError("voices.bin not found — download the model first")
        data = np.load(str(voices_path))
        if voice_id not in data:
            raise ValueError(f"Voice '{voice_id}' not found in builtin voices")
        return data[voice_id].copy()

    def _get_custom_embedding(self, voice_id: str):
        """Return the numpy embedding for a saved custom (blended) voice."""
        import numpy as np
        npy_path = CUSTOM_VOICES_DIR / f"{voice_id}.npy"
        if npy_path.is_file():
            return np.load(str(npy_path))
        raise FileNotFoundError(f"Custom voice '{voice_id}' not found")

    def _resolve_embedding(self, voice_id: str):
        """Get a voice embedding by ID — tries builtin first, then custom."""
        import numpy as np
        voices_path = TTS_DIR / VOICES_BIN_FILENAME
        if voices_path.is_file():
            data = np.load(str(voices_path))
            if voice_id in data:
                return data[voice_id].copy()
        return self._get_custom_embedding(voice_id)

    def blend_voices_sync(
        self,
        components: list[dict[str, Any]],  # [{"voice_id": str, "weight": float}]
    ):
        """Compute a weighted blend of voice embeddings.

        Weights are normalised to sum to 1.0.  Returns the blended numpy array.
        Each component voice can be a builtin or a previously saved custom voice.
        """
        import numpy as np

        if not components:
            raise ValueError("Need at least one component voice")

        embeddings = []
        weights = []
        for c in components:
            vid = c["voice_id"]
            w = float(c.get("weight", 1.0))
            if w <= 0:
                continue
            emb = self._resolve_embedding(vid)
            embeddings.append(emb)
            weights.append(w)

        if not embeddings:
            raise ValueError("All weights are zero")

        total = sum(weights)
        weights = [w / total for w in weights]

        blended = sum(e * w for e, w in zip(embeddings, weights))
        return blended.astype(np.float32)

    async def blend_and_preview(
        self,
        components: list[dict[str, Any]],
        speed: float = 1.0,
        lang: str = "en-us",
    ) -> SynthesisResult:
        """Blend voices and synthesize a preview clip without saving."""
        load_result = await self.ensure_loaded()
        if not load_result.get("success"):
            return SynthesisResult(success=False, error=load_result.get("error", "Model load failed"))

        loop = asyncio.get_running_loop()
        try:
            blended_emb = await loop.run_in_executor(None, self.blend_voices_sync, components)
        except Exception as exc:
            return SynthesisResult(success=False, error=str(exc))

        with self._lock:
            kokoro = self._kokoro
        if kokoro is None:
            return SynthesisResult(success=False, error="Model not loaded")

        def _synth():
            samples, sr = kokoro.create(PREVIEW_TEXT, voice=blended_emb, speed=speed, lang=lang)
            return samples, sr

        try:
            samples, sr = await loop.run_in_executor(None, _synth)
            if samples is None or len(samples) == 0:
                return SynthesisResult(success=False, error="Empty audio returned")
            audio_bytes = _wav_bytes(samples, sr)
            duration = len(samples) / sr
            return SynthesisResult(
                success=True,
                audio_bytes=audio_bytes,
                sample_rate=sr,
                duration_seconds=duration,
                voice_id="blend-preview",
                elapsed_seconds=0.0,
            )
        except Exception as exc:
            return SynthesisResult(success=False, error=str(exc))

    async def save_blended_voice(
        self,
        voice_id: str,
        name: str,
        components: list[dict[str, Any]],
        gender: str = "female",
        lang_code: str = "a",
    ) -> dict[str, Any]:
        """Blend voices and persist the result as a custom voice."""
        voice_id = _sanitize_voice_id(voice_id)
        if not voice_id:
            return {"success": False, "error": "Invalid voice ID"}

        loop = asyncio.get_running_loop()
        try:
            blended_emb = await loop.run_in_executor(None, self.blend_voices_sync, components)
        except Exception as exc:
            return {"success": False, "error": str(exc)}

        CUSTOM_VOICES_DIR.mkdir(parents=True, exist_ok=True)
        import numpy as np
        npy_path = CUSTOM_VOICES_DIR / f"{voice_id}.npy"
        np.save(str(npy_path), blended_emb)

        meta = {
            "name": name,
            "gender": gender,
            "language": "Custom",
            "lang_code": lang_code,
            "traits": ["blended"],
            "blend_recipe": components,
        }
        self._write_voice_meta(voice_id, meta)
        logger.info("[tts] Saved blended voice '%s' (%d components)", voice_id, len(components))
        return {"success": True, "voice_id": voice_id}

    async def import_voice_file(
        self,
        voice_id: str,
        name: str,
        data: bytes,
        file_ext: str,
        gender: str = "female",
        lang_code: str = "a",
    ) -> dict[str, Any]:
        """Import a voice embedding from uploaded bytes (.npy or .bin format)."""
        import numpy as np

        voice_id = _sanitize_voice_id(voice_id)
        if not voice_id:
            return {"success": False, "error": "Invalid voice ID"}

        CUSTOM_VOICES_DIR.mkdir(parents=True, exist_ok=True)

        try:
            buf = io.BytesIO(data)
            if file_ext == ".npy":
                emb = np.load(buf, allow_pickle=False)
            elif file_ext in (".bin", ".npz"):
                # Might be a single-key NpzFile
                npz = np.load(buf)
                keys = list(npz.files)
                if len(keys) == 1:
                    emb = npz[keys[0]]
                elif voice_id in npz:
                    emb = npz[voice_id]
                else:
                    emb = npz[keys[0]]
            else:
                return {"success": False, "error": f"Unsupported file format: {file_ext}"}

            # Validate shape — expected (510, 1, 256)
            if emb.ndim != 3 or emb.shape[1] != 1 or emb.shape[2] != 256:
                return {
                    "success": False,
                    "error": f"Unexpected embedding shape {emb.shape}; expected (N, 1, 256)",
                }

            npy_path = CUSTOM_VOICES_DIR / f"{voice_id}.npy"
            np.save(str(npy_path), emb.astype(np.float32))

            meta = {
                "name": name,
                "gender": gender,
                "language": "Custom",
                "lang_code": lang_code,
                "traits": ["imported"],
                "blend_recipe": [],
            }
            self._write_voice_meta(voice_id, meta)
            logger.info("[tts] Imported voice '%s' from %s bytes", voice_id, len(data))
            return {"success": True, "voice_id": voice_id}

        except Exception as exc:
            logger.error("[tts] Voice import failed: %s", exc, exc_info=True)
            return {"success": False, "error": str(exc)}

    async def rename_custom_voice(self, voice_id: str, new_name: str) -> dict[str, Any]:
        """Update the display name for a custom voice."""
        npy_path = CUSTOM_VOICES_DIR / f"{voice_id}.npy"
        bin_path = CUSTOM_VOICES_DIR / f"{voice_id}.bin"
        if not npy_path.is_file() and not bin_path.is_file():
            return {"success": False, "error": f"Custom voice '{voice_id}' not found"}
        meta = self._read_voice_meta(voice_id)
        meta["name"] = new_name
        self._write_voice_meta(voice_id, meta)
        return {"success": True}

    async def delete_custom_voice(self, voice_id: str) -> dict[str, Any]:
        """Delete a custom voice and its metadata."""
        deleted = False
        for ext in (".npy", ".bin", ".json"):
            p = CUSTOM_VOICES_DIR / f"{voice_id}{ext}"
            if p.is_file():
                p.unlink()
                deleted = True
        if not deleted:
            return {"success": False, "error": f"Custom voice '{voice_id}' not found"}
        logger.info("[tts] Deleted custom voice '%s'", voice_id)
        return {"success": True}

    async def synthesize_with_blend(
        self,
        text: str,
        components: list[dict[str, Any]],
        speed: float = 1.0,
        lang: str = "en-us",
    ) -> SynthesisResult:
        """Synthesize using a live (unsaved) blend — for one-shot blended playback."""
        load_result = await self.ensure_loaded()
        if not load_result.get("success"):
            return SynthesisResult(success=False, error=load_result.get("error", "Model load failed"))

        loop = asyncio.get_running_loop()
        try:
            blended_emb = await loop.run_in_executor(None, self.blend_voices_sync, components)
        except Exception as exc:
            return SynthesisResult(success=False, error=str(exc))

        with self._lock:
            kokoro = self._kokoro
        if kokoro is None:
            return SynthesisResult(success=False, error="Model not loaded")

        t0 = time.monotonic()

        def _synth():
            return kokoro.create(text, voice=blended_emb, speed=speed, lang=lang)

        try:
            samples, sr = await loop.run_in_executor(None, _synth)
            if samples is None or len(samples) == 0:
                return SynthesisResult(success=False, error="Empty audio returned")
            audio_bytes = _wav_bytes(samples, sr)
            duration = len(samples) / sr
            elapsed = time.monotonic() - t0
            return SynthesisResult(
                success=True,
                audio_bytes=audio_bytes,
                sample_rate=sr,
                duration_seconds=duration,
                voice_id="blend",
                elapsed_seconds=elapsed,
            )
        except Exception as exc:
            return SynthesisResult(success=False, error=str(exc))

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
