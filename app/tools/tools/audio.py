"""Audio tools — device listing, recording, playback, and transcription."""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import platform
import subprocess
import uuid
from pathlib import Path

from app.config import TEMP_DIR
from app.tools.session import ToolSession
from app.tools.types import ToolResult, ToolResultType

logger = logging.getLogger(__name__)

IS_WINDOWS = platform.system() == "Windows"
IS_MACOS = platform.system() == "Darwin"

AUDIO_DIR = TEMP_DIR / "audio"


def _ensure_audio_dir() -> Path:
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    return AUDIO_DIR


async def tool_list_audio_devices(
    session: ToolSession,
) -> ToolResult:
    """List available audio input (microphones) and output (speakers) devices."""
    try:
        import sounddevice as sd
        devices = sd.query_devices()
        inputs = []
        outputs = []
        for i, dev in enumerate(devices):
            entry = {
                "index": i,
                "name": dev["name"],
                "sample_rate": dev["default_samplerate"],
            }
            if dev["max_input_channels"] > 0:
                entry["channels"] = dev["max_input_channels"]
                inputs.append(entry)
            if dev["max_output_channels"] > 0:
                entry_out = dict(entry)
                entry_out["channels"] = dev["max_output_channels"]
                outputs.append(entry_out)

        lines = ["Input Devices (Microphones):"]
        for d in inputs:
            lines.append(f"  [{d['index']}] {d['name']} ({d['channels']}ch, {d['sample_rate']:.0f}Hz)")
        lines.append("")
        lines.append("Output Devices (Speakers):")
        for d in outputs:
            lines.append(f"  [{d['index']}] {d['name']} ({d['channels']}ch, {d['sample_rate']:.0f}Hz)")

        return ToolResult(
            output="\n".join(lines),
            metadata={"inputs": inputs, "outputs": outputs},
        )
    except ImportError:
        return _list_devices_fallback()


def _list_devices_fallback() -> ToolResult:
    """Fallback using system commands."""
    try:
        if IS_MACOS:
            result = subprocess.run(
                ["system_profiler", "SPAudioDataType", "-json"],
                capture_output=True, text=True, timeout=10,
            )
            return ToolResult(
                output=f"Audio devices (raw):\n{result.stdout[:3000]}",
                metadata={"raw": True},
            )
        elif IS_WINDOWS:
            result = subprocess.run(
                ["powershell", "-Command",
                 "Get-WmiObject Win32_SoundDevice | Select-Object Name, Status | Format-List"],
                capture_output=True, text=True, timeout=10,
            )
            return ToolResult(output=f"Audio devices:\n{result.stdout}")
        else:
            result = subprocess.run(
                ["arecord", "-l"],
                capture_output=True, text=True, timeout=10,
            )
            result2 = subprocess.run(
                ["aplay", "-l"],
                capture_output=True, text=True, timeout=10,
            )
            return ToolResult(
                output=f"Input devices:\n{result.stdout}\n\nOutput devices:\n{result2.stdout}",
            )
    except Exception as e:
        return ToolResult(
            type=ToolResultType.ERROR,
            output=f"Install 'sounddevice' for device listing: pip install sounddevice. Error: {e}",
        )


async def tool_record_audio(
    session: ToolSession,
    duration_seconds: int = 5,
    device_index: int | None = None,
    sample_rate: int = 44100,
    channels: int = 1,
    format: str = "wav",
) -> ToolResult:
    """Record audio from microphone for specified duration. Returns path to audio file."""
    if duration_seconds < 1 or duration_seconds > 300:
        return ToolResult(type=ToolResultType.ERROR, output="Duration must be 1-300 seconds.")

    _ensure_audio_dir()
    filename = f"recording_{uuid.uuid4().hex[:8]}.{format}"
    filepath = AUDIO_DIR / filename

    try:
        import sounddevice as sd
        import numpy as np

        logger.info("Recording %ds of audio (device=%s, rate=%d, ch=%d)",
                     duration_seconds, device_index, sample_rate, channels)

        recording = sd.rec(
            int(duration_seconds * sample_rate),
            samplerate=sample_rate,
            channels=channels,
            dtype="int16",
            device=device_index,
        )
        # Run in thread to not block event loop
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: sd.wait()
        )

        # Save as WAV
        import wave
        with wave.open(str(filepath), "wb") as wf:
            wf.setnchannels(channels)
            wf.setsampwidth(2)  # int16
            wf.setframerate(sample_rate)
            wf.writeframes(recording.tobytes())

        file_size = filepath.stat().st_size
        return ToolResult(
            output=f"Recorded {duration_seconds}s of audio to {filepath} ({file_size} bytes)",
            metadata={
                "path": str(filepath),
                "duration_seconds": duration_seconds,
                "sample_rate": sample_rate,
                "channels": channels,
                "size_bytes": file_size,
            },
        )

    except ImportError:
        # Fallback to system tools
        return await _record_fallback(filepath, duration_seconds, sample_rate, channels)
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Recording failed: {e}")


async def _record_fallback(filepath: Path, duration: int, rate: int, channels: int) -> ToolResult:
    """Record using system tools when sounddevice is not available."""
    try:
        if IS_MACOS:
            # Use sox/rec if available
            proc = await asyncio.create_subprocess_exec(
                "rec", "-r", str(rate), "-c", str(channels), str(filepath),
                "trim", "0", str(duration),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.communicate(), timeout=duration + 10)
        elif IS_WINDOWS:
            # Use PowerShell with built-in audio
            ps_script = f"""
Add-Type -AssemblyName System.Speech
$audio = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$audio.SetInputToDefaultAudioDevice()
$stream = [System.IO.File]::Create('{filepath}')
$audio.SetInputToAudioStream($stream, (New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo({rate}, 16, {channels})))
Start-Sleep -Seconds {duration}
$stream.Close()
"""
            proc = await asyncio.create_subprocess_exec(
                "powershell.exe", "-Command", ps_script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.communicate(), timeout=duration + 10)
        else:
            proc = await asyncio.create_subprocess_exec(
                "arecord", "-d", str(duration), "-r", str(rate),
                "-c", str(channels), "-f", "S16_LE", str(filepath),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.communicate(), timeout=duration + 10)

        if filepath.exists():
            return ToolResult(
                output=f"Recorded {duration}s to {filepath} (system fallback)",
                metadata={"path": str(filepath), "duration_seconds": duration},
            )
        return ToolResult(type=ToolResultType.ERROR, output="Recording produced no file.")

    except FileNotFoundError:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="No audio recording tools available. Install: pip install sounddevice numpy",
        )
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Fallback recording failed: {e}")


async def tool_play_audio(
    session: ToolSession,
    file_path: str,
    device_index: int | None = None,
) -> ToolResult:
    """Play an audio file through speakers."""
    resolved = session.resolve_path(file_path)

    if not os.path.isfile(resolved):
        return ToolResult(type=ToolResultType.ERROR, output=f"File not found: {resolved}")

    try:
        import sounddevice as sd
        import wave

        with wave.open(resolved, "rb") as wf:
            rate = wf.getframerate()
            channels = wf.getnchannels()
            frames = wf.readframes(wf.getnframes())

        import numpy as np
        audio_data = np.frombuffer(frames, dtype=np.int16)
        if channels > 1:
            audio_data = audio_data.reshape(-1, channels)

        sd.play(audio_data, samplerate=rate, device=device_index)
        await asyncio.get_event_loop().run_in_executor(None, sd.wait)

        duration = len(frames) / (rate * channels * 2)
        return ToolResult(output=f"Played {resolved} ({duration:.1f}s)")

    except ImportError:
        # Fallback
        try:
            if IS_MACOS:
                proc = await asyncio.create_subprocess_exec(
                    "afplay", resolved,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            elif IS_WINDOWS:
                proc = await asyncio.create_subprocess_exec(
                    "powershell.exe", "-Command",
                    f"(New-Object Media.SoundPlayer '{resolved}').PlaySync()",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            else:
                proc = await asyncio.create_subprocess_exec(
                    "aplay", resolved,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            await asyncio.wait_for(proc.communicate(), timeout=300)
            return ToolResult(output=f"Played {resolved}")
        except Exception as e:
            return ToolResult(type=ToolResultType.ERROR, output=f"Playback failed: {e}")

    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Playback failed: {e}")


async def tool_transcribe_audio(
    session: ToolSession,
    file_path: str,
    model: str = "base",
    language: str | None = None,
) -> ToolResult:
    """Transcribe audio file to text using OpenAI Whisper (local model).

    Models: tiny, base, small, medium, large
    Smaller models are faster but less accurate.
    """
    resolved = session.resolve_path(file_path)

    if not os.path.isfile(resolved):
        return ToolResult(type=ToolResultType.ERROR, output=f"File not found: {resolved}")

    try:
        import whisper

        logger.info("Loading whisper model '%s' for transcription", model)

        # Run in executor to not block event loop
        loop = asyncio.get_event_loop()

        def _transcribe():
            m = whisper.load_model(model)
            opts = {}
            if language:
                opts["language"] = language
            result = m.transcribe(resolved, **opts)
            return result

        result = await loop.run_in_executor(None, _transcribe)

        text = result.get("text", "").strip()
        lang = result.get("language", "unknown")
        segments = result.get("segments", [])

        segment_data = []
        for seg in segments:
            segment_data.append({
                "start": seg["start"],
                "end": seg["end"],
                "text": seg["text"].strip(),
            })

        return ToolResult(
            output=f"Transcription ({lang}):\n\n{text}",
            metadata={
                "text": text,
                "language": lang,
                "segments": segment_data,
                "model": model,
                "source_file": resolved,
            },
        )

    except ImportError:
        # Try whisper CLI
        try:
            cmd = ["whisper", resolved, "--model", model, "--output_format", "txt"]
            if language:
                cmd.extend(["--language", language])

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)

            if proc.returncode != 0:
                return ToolResult(
                    type=ToolResultType.ERROR,
                    output=f"Whisper not installed. Install: pip install openai-whisper\nError: {stderr.decode()}",
                )

            text = stdout.decode().strip()
            return ToolResult(
                output=f"Transcription:\n\n{text}",
                metadata={"text": text, "model": model},
            )
        except FileNotFoundError:
            return ToolResult(
                type=ToolResultType.ERROR,
                output="Whisper not installed. Install: pip install openai-whisper",
            )

    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Transcription failed: {e}")
