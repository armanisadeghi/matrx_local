"""Permission check API routes.

Exposes endpoints for the frontend to query device/OS permission status
and to trigger live device probes (e.g. list audio devices, scan WiFi).
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import platform
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from app.config import TEMP_DIR
from app.services.permissions.checker import (
    check_accessibility,
    check_all_permissions,
    check_bluetooth,
    check_camera,
    check_microphone,
    check_network,
    check_screen_recording,
    check_wifi,
)
from app.tools.session import ToolSession
from app.tools.tools.audio import tool_list_audio_devices, tool_record_audio, tool_play_audio
from app.tools.tools.wifi_bluetooth import (
    tool_bluetooth_devices,
    tool_connected_devices,
    tool_wifi_networks,
)
from app.tools.tools.network_discovery import tool_network_info
from app.tools.tools.system import tool_list_screens, tool_screenshot
from app.tools.tools.system_monitor import tool_system_resources

logger = logging.getLogger(__name__)

IS_MACOS = platform.system() == "Darwin"
IS_WINDOWS = platform.system() == "Windows"
IS_LINUX = platform.system() == "Linux"

MEDIA_DIR = TEMP_DIR / "devices"
MEDIA_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter(prefix="/devices", tags=["devices"])


class RecordAudioRequest(BaseModel):
    device_index: int | None = None
    duration_seconds: int = 5


class CapturePhotoRequest(BaseModel):
    device_index: int | None = None


class RecordVideoRequest(BaseModel):
    device_index: int | None = None
    duration_seconds: int = 5


class RecordScreenRequest(BaseModel):
    screen_index: int | None = None
    duration_seconds: int = 5


async def _run(cmd: list[str], timeout: int = 15) -> tuple[str, str, int]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    return stdout.decode(errors="replace"), stderr.decode(errors="replace"), proc.returncode or 0


@router.get("/permissions")
async def get_permissions():
    """Get all device/OS permission statuses."""
    results = await check_all_permissions()
    return {"permissions": results, "platform": platform.system()}


@router.get("/permissions/{name}")
async def get_permission(name: str):
    """Get a single permission status by name."""
    checkers = {
        "microphone": check_microphone,
        "camera": check_camera,
        "accessibility": check_accessibility,
        "bluetooth": check_bluetooth,
        "network": check_network,
        "wifi": check_wifi,
        "screen_recording": check_screen_recording,
    }
    checker = checkers.get(name)
    if not checker:
        return {"error": f"Unknown permission: {name}", "available": list(checkers.keys())}
    result = await checker()
    return result.to_dict()


@router.get("/audio")
async def get_audio_devices():
    """List audio input/output devices."""
    session = ToolSession()
    try:
        result = await tool_list_audio_devices(session=session)
        return {
            "output": result.output,
            "metadata": result.metadata,
            "type": result.type.value if hasattr(result.type, "value") else str(result.type),
        }
    finally:
        await session.cleanup()


@router.get("/bluetooth")
async def get_bluetooth_devices():
    """List Bluetooth devices."""
    session = ToolSession()
    try:
        result = await tool_bluetooth_devices(session=session)
        return {
            "output": result.output,
            "metadata": result.metadata,
            "type": result.type.value if hasattr(result.type, "value") else str(result.type),
        }
    finally:
        await session.cleanup()


@router.get("/wifi")
async def get_wifi_networks():
    """List WiFi networks."""
    session = ToolSession()
    try:
        result = await tool_wifi_networks(session=session, rescan=False)
        return {
            "output": result.output,
            "metadata": result.metadata,
            "type": result.type.value if hasattr(result.type, "value") else str(result.type),
        }
    finally:
        await session.cleanup()


@router.get("/network")
async def get_network_info():
    """Get network interface information."""
    session = ToolSession()
    try:
        result = await tool_network_info(session=session)
        return {
            "output": result.output,
            "metadata": result.metadata,
            "type": result.type.value if hasattr(result.type, "value") else str(result.type),
        }
    finally:
        await session.cleanup()


@router.get("/connected")
async def get_connected_devices():
    """List all connected peripherals (USB, Bluetooth, etc.)."""
    session = ToolSession()
    try:
        result = await tool_connected_devices(session=session)
        return {
            "output": result.output,
            "metadata": result.metadata,
            "type": result.type.value if hasattr(result.type, "value") else str(result.type),
        }
    finally:
        await session.cleanup()


@router.get("/camera")
async def get_camera_devices():
    """List available cameras."""
    devices: list[dict[str, Any]] = []
    try:
        if IS_MACOS:
            out, _, _ = await _run(["system_profiler", "SPCameraDataType", "-json"])
            data = json.loads(out)
            for item in data.get("SPCameraDataType", []):
                devices.append({
                    "name": item.get("_name", "Unknown Camera"),
                    "model_id": item.get("spcamera_model-id", ""),
                    "unique_id": item.get("spcamera_unique-id", ""),
                    "index": len(devices),
                })
        elif IS_WINDOWS:
            out, _, _ = await _run([
                "powershell.exe", "-NoProfile", "-Command",
                "Get-PnpDevice -Class Camera -PresentOnly | Select-Object FriendlyName, Status | ConvertTo-Json",
            ])
            cams = json.loads(out) if out.strip() else []
            if isinstance(cams, dict):
                cams = [cams]
            for i, cam in enumerate(cams):
                devices.append({
                    "name": cam.get("FriendlyName", f"Camera {i}"),
                    "status": cam.get("Status", ""),
                    "index": i,
                })
        else:
            import glob as _glob
            for i, vd in enumerate(_glob.glob("/dev/video*")):
                devices.append({"name": vd, "index": i})
    except Exception as e:
        logger.warning("Camera probe failed: %s", e)

    return {
        "output": f"{len(devices)} camera(s) found",
        "metadata": {"devices": devices, "count": len(devices)},
        "type": "success",
    }


@router.get("/screens")
async def get_screens():
    """List all connected monitors with geometry."""
    session = ToolSession()
    try:
        result = await tool_list_screens(session=session)
        return {
            "output": result.output,
            "metadata": result.metadata,
            "type": result.type.value if hasattr(result.type, "value") else str(result.type),
        }
    finally:
        await session.cleanup()


@router.get("/screenshot")
async def take_screenshot(monitor: str = "all"):
    """Take a screenshot and return base64-encoded PNG."""
    session = ToolSession()
    try:
        monitor_val: int | str = monitor
        try:
            monitor_val = int(monitor)
        except (ValueError, TypeError):
            pass
        result = await tool_screenshot(session=session, monitor=monitor_val)
        if result.metadata and result.metadata.get("base64"):
            return {
                "output": result.output,
                "metadata": result.metadata,
                "type": result.type.value if hasattr(result.type, "value") else str(result.type),
            }
        # If tool returned a file path, read and base64-encode it
        if result.metadata and result.metadata.get("path"):
            p = Path(str(result.metadata["path"]))
            if p.exists():
                b64 = base64.b64encode(p.read_bytes()).decode()
                return {
                    "output": result.output,
                    "metadata": {**result.metadata, "base64": b64, "mime": "image/png"},
                    "type": "success",
                }
        return {
            "output": result.output,
            "metadata": result.metadata,
            "type": result.type.value if hasattr(result.type, "value") else str(result.type),
        }
    finally:
        await session.cleanup()


@router.get("/location")
async def get_location():
    """Get current device location (if permission granted)."""
    lat: float | None = None
    lon: float | None = None
    accuracy: float | None = None
    source = "unavailable"

    try:
        if IS_MACOS:
            # Use CoreLocation via a quick Swift/osascript approach or whereami
            import shutil
            if shutil.which("whereami"):
                out, _, rc = await _run(["whereami"], timeout=10)
                if rc == 0:
                    for line in out.split("\n"):
                        if "Latitude" in line:
                            lat = float(line.split(":")[-1].strip())
                        elif "Longitude" in line:
                            lon = float(line.split(":")[-1].strip())
                        elif "Accuracy" in line:
                            accuracy = float(line.split(":")[-1].strip())
                    source = "whereami"
            if lat is None:
                # Try CoreLocation via Python objc
                try:
                    import objc
                    objc.loadBundle(
                        "CoreLocation",
                        bundle_path="/System/Library/Frameworks/CoreLocation.framework",
                        module_globals={},
                    )
                    CLLocationManager = objc.lookUpClass("CLLocationManager")
                    status = CLLocationManager.authorizationStatus()
                    # 0=notDetermined, 1=restricted, 2=denied, 3=authorizedAlways, 4=authorizedWhenInUse
                    if status in (3, 4):
                        source = "corelocation_authorized"
                    elif status == 2:
                        source = "corelocation_denied"
                    elif status == 1:
                        source = "corelocation_restricted"
                    else:
                        source = "corelocation_not_determined"
                except Exception:
                    source = "permission_check_failed"

        elif IS_WINDOWS:
            out, _, rc = await _run([
                "powershell.exe", "-NoProfile", "-Command",
                "Add-Type -AssemblyName System.Device; "
                "$w = New-Object System.Device.Location.GeoCoordinateWatcher; "
                "$w.Start(); Start-Sleep 3; "
                "if ($w.Position.Location.IsUnknown) { 'UNKNOWN' } "
                "else { \"$($w.Position.Location.Latitude),$($w.Position.Location.Longitude),$($w.Position.Location.HorizontalAccuracy)\" }",
            ], timeout=15)
            if rc == 0 and "," in out.strip():
                parts = out.strip().split(",")
                lat, lon = float(parts[0]), float(parts[1])
                accuracy = float(parts[2]) if len(parts) > 2 else None
                source = "windows_geolocation"

        else:
            # Try geoclue on Linux
            import shutil
            if shutil.which("geoclue-where-am-i"):
                out, _, rc = await _run(["geoclue-where-am-i", "-t", "5"], timeout=10)
                if rc == 0:
                    for line in out.split("\n"):
                        if "Latitude" in line:
                            lat = float(line.split(":")[-1].strip().rstrip("°"))
                        elif "Longitude" in line:
                            lon = float(line.split(":")[-1].strip().rstrip("°"))
                        elif "Accuracy" in line:
                            accuracy = float(line.split(":")[-1].strip().split()[0])
                    source = "geoclue"

    except Exception as e:
        logger.warning("Location probe failed: %s", e)
        source = f"error: {e}"

    return {
        "output": f"Location: {lat}, {lon}" if lat is not None else f"Location unavailable ({source})",
        "metadata": {
            "latitude": lat,
            "longitude": lon,
            "accuracy_meters": accuracy,
            "source": source,
            "available": lat is not None,
        },
        "type": "success" if lat is not None else "unavailable",
    }


# ---------------------------------------------------------------------------
# Recording endpoints
# ---------------------------------------------------------------------------


@router.post("/record-audio")
async def record_audio(req: RecordAudioRequest):
    """Record audio from microphone and return base64-encoded WAV."""
    session = ToolSession()
    try:
        result = await tool_record_audio(
            session=session,
            duration_seconds=req.duration_seconds,
            device_index=req.device_index,
        )
        if result.metadata and result.metadata.get("path"):
            p = Path(str(result.metadata["path"]))
            if p.exists():
                b64 = base64.b64encode(p.read_bytes()).decode()
                return {
                    "output": result.output,
                    "metadata": {**result.metadata, "base64": b64, "mime": "audio/wav"},
                    "type": "success",
                }
        return {
            "output": result.output,
            "metadata": result.metadata,
            "type": result.type.value if hasattr(result.type, "value") else str(result.type),
        }
    finally:
        await session.cleanup()


@router.post("/capture-photo")
async def capture_photo(req: CapturePhotoRequest):
    """Capture a photo from webcam and return base64-encoded JPEG."""
    out_path = MEDIA_DIR / f"photo_{uuid.uuid4().hex[:8]}.jpg"
    try:
        if IS_MACOS:
            # Try imagesnap (brew install imagesnap) first
            import shutil
            if shutil.which("imagesnap"):
                args = ["imagesnap"]
                if req.device_index is not None:
                    # imagesnap can list with -l; use index for device selection indirectly
                    pass
                args.append(str(out_path))
                _, _, rc = await _run(args, timeout=10)
                if rc == 0 and out_path.exists():
                    b64 = base64.b64encode(out_path.read_bytes()).decode()
                    return {
                        "output": f"Photo captured to {out_path}",
                        "metadata": {"path": str(out_path), "base64": b64, "mime": "image/jpeg"},
                        "type": "success",
                    }

        # Cross-platform: OpenCV
        try:
            import cv2
            import asyncio as _asyncio

            def _capture() -> bytes | None:
                idx = req.device_index if req.device_index is not None else 0
                cap = cv2.VideoCapture(idx)
                if not cap.isOpened():
                    return None
                # Warm up
                for _ in range(5):
                    cap.read()
                ret, frame = cap.read()
                cap.release()
                if not ret:
                    return None
                _, buf = cv2.imencode(".jpg", frame)
                return bytes(buf)

            data = await _asyncio.get_event_loop().run_in_executor(None, _capture)
            if data:
                out_path.write_bytes(data)
                b64 = base64.b64encode(data).decode()
                return {
                    "output": f"Photo captured ({len(data)} bytes)",
                    "metadata": {"path": str(out_path), "base64": b64, "mime": "image/jpeg"},
                    "type": "success",
                }
        except ImportError:
            pass

        return {
            "output": "Camera capture requires OpenCV (cv2) or imagesnap (macOS). Install: pip install opencv-python",
            "metadata": None,
            "type": "error",
        }
    except Exception as e:
        return {"output": f"Photo capture failed: {e}", "metadata": None, "type": "error"}


@router.post("/record-video")
async def record_video(req: RecordVideoRequest):
    """Record a short video from webcam and return base64-encoded MP4."""
    out_path = MEDIA_DIR / f"video_{uuid.uuid4().hex[:8]}.mp4"
    try:
        import cv2
        import asyncio as _asyncio

        def _record() -> bytes | None:
            idx = req.device_index if req.device_index is not None else 0
            cap = cv2.VideoCapture(idx)
            if not cap.isOpened():
                return None
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(str(out_path), fourcc, fps, (w, h))
            import time
            start = time.monotonic()
            while (time.monotonic() - start) < req.duration_seconds:
                ret, frame = cap.read()
                if not ret:
                    break
                writer.write(frame)
            cap.release()
            writer.release()
            if out_path.exists():
                return out_path.read_bytes()
            return None

        data = await _asyncio.get_event_loop().run_in_executor(None, _record)
        if data:
            b64 = base64.b64encode(data).decode()
            return {
                "output": f"Video recorded ({len(data)} bytes, {req.duration_seconds}s)",
                "metadata": {
                    "path": str(out_path),
                    "base64": b64,
                    "mime": "video/mp4",
                    "duration_seconds": req.duration_seconds,
                },
                "type": "success",
            }
        return {"output": "Video recording failed — camera may not be available", "metadata": None, "type": "error"}
    except ImportError:
        return {
            "output": "Video recording requires OpenCV (cv2). Install: pip install opencv-python",
            "metadata": None,
            "type": "error",
        }
    except Exception as e:
        return {"output": f"Video recording failed: {e}", "metadata": None, "type": "error"}


@router.post("/record-screen")
async def record_screen(req: RecordScreenRequest):
    """Record a screen capture video and return base64-encoded MP4."""
    import shutil
    out_path = MEDIA_DIR / f"screen_{uuid.uuid4().hex[:8]}.mp4"

    try:
        if shutil.which("ffmpeg"):
            if IS_MACOS:
                # List available avfoundation devices and capture
                screen_id = str(req.screen_index - 1) if req.screen_index else "0"
                cmd = [
                    "ffmpeg", "-y",
                    "-f", "avfoundation",
                    "-framerate", "30",
                    "-i", f"{screen_id}:none",
                    "-t", str(req.duration_seconds),
                    "-c:v", "libx264",
                    "-preset", "ultrafast",
                    "-pix_fmt", "yuv420p",
                    str(out_path),
                ]
            elif IS_WINDOWS:
                cmd = [
                    "ffmpeg", "-y",
                    "-f", "gdigrab",
                    "-framerate", "30",
                    "-i", "desktop",
                    "-t", str(req.duration_seconds),
                    "-c:v", "libx264",
                    "-preset", "ultrafast",
                    "-pix_fmt", "yuv420p",
                    str(out_path),
                ]
            else:
                display = ":0.0"
                cmd = [
                    "ffmpeg", "-y",
                    "-f", "x11grab",
                    "-framerate", "30",
                    "-video_size", "1920x1080",
                    "-i", display,
                    "-t", str(req.duration_seconds),
                    "-c:v", "libx264",
                    "-preset", "ultrafast",
                    "-pix_fmt", "yuv420p",
                    str(out_path),
                ]
            _, _, rc = await _run(cmd, timeout=req.duration_seconds + 30)
            if rc == 0 and out_path.exists():
                data = out_path.read_bytes()
                b64 = base64.b64encode(data).decode()
                return {
                    "output": f"Screen recording saved ({len(data)} bytes, {req.duration_seconds}s)",
                    "metadata": {
                        "path": str(out_path),
                        "base64": b64,
                        "mime": "video/mp4",
                        "duration_seconds": req.duration_seconds,
                    },
                    "type": "success",
                }

        # Fallback: take a sequence of screenshots via PIL/mss
        try:
            import mss
            import asyncio as _asyncio
            import io
            import time

            def _record_mss() -> bytes | None:
                with mss.mss() as sct:
                    monitor_idx = req.screen_index if req.screen_index else 1
                    if monitor_idx >= len(sct.monitors):
                        monitor_idx = 1
                    mon = sct.monitors[monitor_idx]
                    frames: list[Any] = []
                    start = time.monotonic()
                    while (time.monotonic() - start) < req.duration_seconds:
                        img = sct.grab(mon)
                        frames.append(bytes(img.rgb))
                    # Encode to simple GIF as fallback (requires Pillow)
                    from PIL import Image
                    pil_frames: list[Any] = []
                    for rgb in frames:
                        pil_frames.append(Image.frombytes("RGB", (mon["width"], mon["height"]), rgb))
                    buf = io.BytesIO()
                    pil_frames[0].save(
                        buf, format="GIF", save_all=True,
                        append_images=pil_frames[1:], loop=0, duration=33,
                    )
                    return buf.getvalue()

            data = await _asyncio.get_event_loop().run_in_executor(None, _record_mss)
            if data:
                gif_path = out_path.with_suffix(".gif")
                gif_path.write_bytes(data)
                b64 = base64.b64encode(data).decode()
                return {
                    "output": f"Screen recording (GIF fallback, {len(data)} bytes)",
                    "metadata": {
                        "path": str(gif_path),
                        "base64": b64,
                        "mime": "image/gif",
                        "duration_seconds": req.duration_seconds,
                    },
                    "type": "success",
                }
        except ImportError:
            pass

        return {
            "output": "Screen recording requires ffmpeg. Install: brew install ffmpeg (macOS) or sudo apt install ffmpeg (Linux)",
            "metadata": None,
            "type": "error",
        }
    except Exception as e:
        return {"output": f"Screen recording failed: {e}", "metadata": None, "type": "error"}


@router.get("/system")
async def get_system_resources():
    """Get CPU, RAM, disk, battery status."""
    session = ToolSession()
    try:
        result = await tool_system_resources(session=session)
        return {
            "output": result.output,
            "metadata": result.metadata,
            "type": result.type.value if hasattr(result.type, "value") else str(result.type),
        }
    finally:
        await session.cleanup()
