"""Cross-platform permission and device capability checker.

Probes the OS for permission status of microphone, camera, accessibility,
bluetooth, location, and network access.  Returns structured results so the
frontend can display real status and guide users to grant missing permissions.
"""

from __future__ import annotations

import asyncio
import json
import logging
import platform
import shutil
import subprocess
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)

IS_MACOS = platform.system() == "Darwin"
IS_WINDOWS = platform.system() == "Windows"
IS_LINUX = platform.system() == "Linux"


class PermissionStatus(str, Enum):
    GRANTED = "granted"
    DENIED = "denied"
    NOT_DETERMINED = "not_determined"
    RESTRICTED = "restricted"  # Parental controls / MDM
    UNAVAILABLE = "unavailable"  # Hardware not present
    UNKNOWN = "unknown"


@dataclass
class PermissionResult:
    permission: str
    status: PermissionStatus
    details: str = ""
    grant_instructions: str = ""
    devices: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "permission": self.permission,
            "status": self.status.value,
            "details": self.details,
            "grant_instructions": self.grant_instructions,
        }
        if self.devices:
            d["devices"] = self.devices
        return d


# ---------------------------------------------------------------------------
# macOS helpers
# ---------------------------------------------------------------------------

async def _run(cmd: list[str], timeout: int = 10) -> tuple[str, str, int]:
    """Run a subprocess and return (stdout, stderr, returncode)."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    return (
        stdout.decode(errors="replace"),
        stderr.decode(errors="replace"),
        proc.returncode or 0,
    )


# ---------------------------------------------------------------------------
# Microphone
# ---------------------------------------------------------------------------

async def check_microphone() -> PermissionResult:
    """Check microphone access and list available input devices."""
    devices: list[dict[str, Any]] = []

    # Try to list audio input devices
    try:
        import sounddevice as sd
        all_devs = sd.query_devices()
        for i, dev in enumerate(all_devs):
            if dev["max_input_channels"] > 0:
                devices.append({
                    "index": i,
                    "name": dev["name"],
                    "channels": dev["max_input_channels"],
                    "sample_rate": dev["default_samplerate"],
                })
    except ImportError:
        # Fallback: system commands
        try:
            if IS_MACOS:
                out, _, _ = await _run(["system_profiler", "SPAudioDataType", "-json"])
                data = json.loads(out)
                for item in data.get("SPAudioDataType", []):
                    for sub in item.get("_items", [item]):
                        name = sub.get("_name", "")
                        if name:
                            devices.append({"name": name, "type": "system_profiler"})
            elif IS_LINUX:
                out, _, rc = await _run(["arecord", "-l"])
                if rc == 0:
                    for line in out.split("\n"):
                        if line.startswith("card"):
                            devices.append({"name": line.strip()})
        except Exception:
            pass
    except Exception:
        pass

    if not devices:
        return PermissionResult(
            permission="microphone",
            status=PermissionStatus.UNAVAILABLE,
            details="No audio input devices detected",
            grant_instructions=_microphone_instructions(),
        )

    # On macOS, try a quick non-blocking permission probe
    if IS_MACOS:
        status = await _macos_check_tcc("kTCCServiceMicrophone", "Microphone")
        return PermissionResult(
            permission="microphone",
            status=status,
            details=f"{len(devices)} input device(s) found",
            devices=devices,
            grant_instructions=_microphone_instructions(),
        )

    # On Linux/Windows, if devices are listed the OS generally allows access
    return PermissionResult(
        permission="microphone",
        status=PermissionStatus.GRANTED,
        details=f"{len(devices)} input device(s) found",
        devices=devices,
        grant_instructions=_microphone_instructions(),
    )


def _microphone_instructions() -> str:
    if IS_MACOS:
        return "System Settings > Privacy & Security > Microphone > Enable for Matrx Local (or Terminal)"
    elif IS_WINDOWS:
        return "Settings > Privacy > Microphone > Allow apps to access your microphone"
    return "Ensure your user is in the 'audio' group: sudo usermod -aG audio $USER"


# ---------------------------------------------------------------------------
# Camera
# ---------------------------------------------------------------------------

async def check_camera() -> PermissionResult:
    """Check camera availability."""
    devices: list[dict[str, Any]] = []

    if IS_MACOS:
        try:
            out, _, _ = await _run(["system_profiler", "SPCameraDataType", "-json"])
            data = json.loads(out)
            for item in data.get("SPCameraDataType", []):
                devices.append({
                    "name": item.get("_name", "Unknown"),
                    "model_id": item.get("spcamera_model-id", ""),
                    "unique_id": item.get("spcamera_unique-id", ""),
                })
        except Exception:
            pass

        status = await _macos_check_tcc("kTCCServiceCamera", "Camera")
        return PermissionResult(
            permission="camera",
            status=status,
            details=f"{len(devices)} camera(s) found" if devices else "No cameras detected",
            devices=devices,
            grant_instructions="System Settings > Privacy & Security > Camera > Enable for Matrx Local",
        )

    elif IS_WINDOWS:
        try:
            out, _, _ = await _run([
                "powershell.exe", "-NoProfile", "-Command",
                "Get-PnpDevice -Class Camera -PresentOnly | Select-Object FriendlyName, Status | ConvertTo-Json",
            ])
            cams = json.loads(out) if out.strip() else []
            if isinstance(cams, dict):
                cams = [cams]
            for cam in cams:
                devices.append({"name": cam.get("FriendlyName", ""), "status": cam.get("Status", "")})
        except Exception:
            pass

        return PermissionResult(
            permission="camera",
            status=PermissionStatus.GRANTED if devices else PermissionStatus.UNAVAILABLE,
            details=f"{len(devices)} camera(s) found" if devices else "No cameras detected",
            devices=devices,
            grant_instructions="Settings > Privacy > Camera > Allow apps to access your camera",
        )

    else:  # Linux
        try:
            import glob as _glob
            video_devs = _glob.glob("/dev/video*")
            for vd in video_devs:
                devices.append({"name": vd})
        except Exception:
            pass

        return PermissionResult(
            permission="camera",
            status=PermissionStatus.GRANTED if devices else PermissionStatus.UNAVAILABLE,
            details=f"{len(devices)} video device(s) found" if devices else "No cameras detected",
            devices=devices,
            grant_instructions="Ensure your user is in the 'video' group: sudo usermod -aG video $USER",
        )


# ---------------------------------------------------------------------------
# Screen Recording / Accessibility
# ---------------------------------------------------------------------------

async def check_accessibility() -> PermissionResult:
    """Check accessibility / screen recording permissions (mostly macOS)."""
    if IS_MACOS:
        # Test by trying a harmless AppleScript that requires accessibility
        try:
            out, err, rc = await _run([
                "osascript", "-e",
                'tell application "System Events" to get name of first process whose frontmost is true',
            ])
            if rc == 0:
                return PermissionResult(
                    permission="accessibility",
                    status=PermissionStatus.GRANTED,
                    details=f"Accessibility access confirmed (frontmost: {out.strip()})",
                    grant_instructions=_accessibility_instructions(),
                )
            # Check for known permission error codes
            if "-1743" in err or "-25211" in err or "not authorized" in err.lower() or "assistive" in err.lower():
                return PermissionResult(
                    permission="accessibility",
                    status=PermissionStatus.DENIED,
                    details="Accessibility access denied by macOS",
                    grant_instructions=_accessibility_instructions(),
                )
        except Exception:
            pass

        return PermissionResult(
            permission="accessibility",
            status=PermissionStatus.UNKNOWN,
            details="Could not determine accessibility status",
            grant_instructions=_accessibility_instructions(),
        )

    elif IS_WINDOWS:
        # Windows generally doesn't restrict accessibility for desktop apps
        return PermissionResult(
            permission="accessibility",
            status=PermissionStatus.GRANTED,
            details="Windows does not restrict accessibility for desktop applications",
            grant_instructions="No action needed on Windows",
        )

    else:
        # Linux: check for xdotool or wmctrl availability
        has_xdotool = shutil.which("xdotool") is not None
        has_wmctrl = shutil.which("wmctrl") is not None
        if has_xdotool or has_wmctrl:
            return PermissionResult(
                permission="accessibility",
                status=PermissionStatus.GRANTED,
                details=f"Tools available: {'xdotool' if has_xdotool else ''} {'wmctrl' if has_wmctrl else ''}".strip(),
                grant_instructions="Install xdotool and wmctrl: sudo apt install xdotool wmctrl",
            )
        return PermissionResult(
            permission="accessibility",
            status=PermissionStatus.DENIED,
            details="No accessibility tools found (xdotool / wmctrl)",
            grant_instructions="Install xdotool and wmctrl: sudo apt install xdotool wmctrl",
        )


def _accessibility_instructions() -> str:
    if IS_MACOS:
        return (
            "System Settings > Privacy & Security > Accessibility > "
            "Enable for Matrx Local (or Terminal). "
            "Also check: Privacy & Security > Screen Recording for screen capture."
        )
    return ""


# ---------------------------------------------------------------------------
# Bluetooth
# ---------------------------------------------------------------------------

async def check_bluetooth() -> PermissionResult:
    """Check Bluetooth availability and permission."""
    devices: list[dict[str, Any]] = []

    if IS_MACOS:
        try:
            out, _, _ = await _run(["system_profiler", "SPBluetoothDataType", "-json"])
            data = json.loads(out)
            bt_data = data.get("SPBluetoothDataType", [{}])[0]

            # Check if Bluetooth is enabled
            controller = bt_data.get("controller_properties", {})
            bt_power = controller.get("controller_state", "")

            for section_key in ["device_connected", "device_not_connected"]:
                section = bt_data.get(section_key, [])
                if isinstance(section, list):
                    for item in section:
                        if isinstance(item, dict):
                            for name, info in item.items():
                                devices.append({
                                    "name": name,
                                    "address": info.get("device_address", ""),
                                    "type": info.get("device_minorType", ""),
                                    "connected": section_key == "device_connected",
                                })

            is_on = "attrib_on" in bt_power.lower() if bt_power else len(devices) > 0
            return PermissionResult(
                permission="bluetooth",
                status=PermissionStatus.GRANTED if is_on else PermissionStatus.DENIED,
                details=f"Bluetooth {'on' if is_on else 'off'}, {len(devices)} device(s) paired",
                devices=devices,
                grant_instructions="System Settings > Bluetooth > Turn On. Also: Privacy & Security > Bluetooth > Enable for Matrx Local",
            )
        except Exception as e:
            logger.debug("Bluetooth check failed: %s", e)

    elif IS_WINDOWS:
        try:
            out, _, rc = await _run([
                "powershell.exe", "-NoProfile", "-Command",
                "Get-PnpDevice -Class Bluetooth | Where-Object {$_.FriendlyName -ne $null} | "
                "Select-Object FriendlyName, Status | ConvertTo-Json",
            ])
            bt_devs = json.loads(out) if out.strip() else []
            if isinstance(bt_devs, dict):
                bt_devs = [bt_devs]
            for d in bt_devs:
                devices.append({"name": d.get("FriendlyName", ""), "status": d.get("Status", "")})
            return PermissionResult(
                permission="bluetooth",
                status=PermissionStatus.GRANTED if devices else PermissionStatus.UNAVAILABLE,
                details=f"{len(devices)} Bluetooth device(s) found",
                devices=devices,
                grant_instructions="Settings > Bluetooth & devices > Turn on Bluetooth",
            )
        except Exception:
            pass

    else:  # Linux
        if shutil.which("bluetoothctl"):
            try:
                out, _, rc = await _run(["bluetoothctl", "devices"])
                if rc == 0:
                    import re
                    for line in out.strip().split("\n"):
                        match = re.match(r"Device\s+([\dA-Fa-f:]+)\s+(.+)", line)
                        if match:
                            devices.append({"name": match.group(2), "address": match.group(1)})
                return PermissionResult(
                    permission="bluetooth",
                    status=PermissionStatus.GRANTED,
                    details=f"{len(devices)} paired device(s)",
                    devices=devices,
                    grant_instructions="Ensure bluetooth service is running: sudo systemctl enable --now bluetooth",
                )
            except Exception:
                pass
        else:
            return PermissionResult(
                permission="bluetooth",
                status=PermissionStatus.UNAVAILABLE,
                details="bluetoothctl not found",
                grant_instructions="Install bluez: sudo apt install bluez",
            )

    return PermissionResult(
        permission="bluetooth",
        status=PermissionStatus.UNKNOWN,
        details="Could not determine Bluetooth status",
        grant_instructions="Check your system's Bluetooth settings",
    )


# ---------------------------------------------------------------------------
# WiFi / Network
# ---------------------------------------------------------------------------

async def check_network() -> PermissionResult:
    """Check network interfaces and connectivity."""
    details_parts: list[str] = []
    devices: list[dict[str, Any]] = []

    try:
        import psutil
        interfaces = psutil.net_if_addrs()
        stats = psutil.net_if_stats()

        for iface_name, addrs in interfaces.items():
            stat = stats.get(iface_name)
            if not stat or not stat.isup:
                continue
            iface_info: dict[str, Any] = {"name": iface_name, "is_up": True}
            import socket
            for addr in addrs:
                if addr.family == socket.AF_INET:
                    iface_info["ipv4"] = addr.address
            if "ipv4" in iface_info:
                devices.append(iface_info)

        details_parts.append(f"{len(devices)} active interface(s)")
    except ImportError:
        details_parts.append("psutil not available")
    except Exception as e:
        details_parts.append(f"Error: {e}")

    # Check WiFi specifically
    wifi_ok = False
    if IS_MACOS:
        try:
            out, _, rc = await _run(["networksetup", "-getairportpower", "en0"])
            wifi_ok = "on" in out.lower()
            details_parts.append(f"WiFi {'on' if wifi_ok else 'off'}")
        except Exception:
            pass
    elif IS_LINUX:
        if shutil.which("nmcli"):
            try:
                out, _, rc = await _run(["nmcli", "radio", "wifi"])
                wifi_ok = "enabled" in out.lower()
                details_parts.append(f"WiFi {'enabled' if wifi_ok else 'disabled'}")
            except Exception:
                pass
    elif IS_WINDOWS:
        try:
            out, _, rc = await _run(["netsh", "wlan", "show", "interfaces"])
            wifi_ok = "connected" in out.lower()
            details_parts.append(f"WiFi {'connected' if wifi_ok else 'available'}")
        except Exception:
            pass

    # Basic internet check
    try:
        import socket
        sock = socket.create_connection(("1.1.1.1", 53), timeout=3)
        sock.close()
        details_parts.append("Internet reachable")
    except Exception:
        details_parts.append("Internet unreachable")

    status = PermissionStatus.GRANTED if devices else PermissionStatus.DENIED
    return PermissionResult(
        permission="network",
        status=status,
        details=", ".join(details_parts),
        devices=devices,
        grant_instructions=_network_instructions(),
    )


def _network_instructions() -> str:
    if IS_MACOS:
        return "System Settings > Privacy & Security > Local Network > Enable for Matrx Local"
    elif IS_WINDOWS:
        return "Settings > Network & internet. Ensure WiFi or Ethernet is connected."
    return "Ensure NetworkManager is running: sudo systemctl enable --now NetworkManager"


# ---------------------------------------------------------------------------
# Screen Recording (macOS-specific)
# ---------------------------------------------------------------------------

async def check_screen_recording() -> PermissionResult:
    """Check screen recording / screenshot permission."""
    if IS_MACOS:
        # Try taking a screenshot to temp — if denied, macOS blocks it
        import tempfile, os
        tmp = os.path.join(tempfile.gettempdir(), "_matrx_perm_test.png")
        try:
            _, err, rc = await _run(["screencapture", "-x", "-t", "png", tmp])
            if rc == 0 and os.path.exists(tmp):
                size = os.path.getsize(tmp)
                os.unlink(tmp)
                # A very small file might indicate a blank/permission-denied capture
                if size > 500:
                    return PermissionResult(
                        permission="screen_recording",
                        status=PermissionStatus.GRANTED,
                        details="Screen capture works",
                        grant_instructions="System Settings > Privacy & Security > Screen Recording > Enable for Matrx Local",
                    )
            if os.path.exists(tmp):
                os.unlink(tmp)
        except Exception:
            pass

        return PermissionResult(
            permission="screen_recording",
            status=PermissionStatus.UNKNOWN,
            details="Screen recording permission may be required",
            grant_instructions="System Settings > Privacy & Security > Screen Recording > Enable for Matrx Local",
        )

    elif IS_WINDOWS:
        return PermissionResult(
            permission="screen_recording",
            status=PermissionStatus.GRANTED,
            details="Screen capture is available on Windows",
            grant_instructions="No action needed",
        )

    else:
        return PermissionResult(
            permission="screen_recording",
            status=PermissionStatus.GRANTED,
            details="X11/Wayland screen capture available",
            grant_instructions="For Wayland, ensure the portal is configured for screen sharing",
        )


# ---------------------------------------------------------------------------
# Location Services
# ---------------------------------------------------------------------------

async def check_location() -> PermissionResult:
    """Check location services availability."""
    if IS_MACOS:
        status = await _macos_check_tcc("kTCCServiceSystemPolicyAllFiles", "Location")
        # Location is a different TCC, just report availability
        try:
            out, _, rc = await _run([
                "defaults", "read",
                "/var/db/locationd/clients.plist",
            ])
            # This will fail without root — that's fine
        except Exception:
            pass

        return PermissionResult(
            permission="location",
            status=PermissionStatus.UNKNOWN,
            details="Location permission is managed per-app by macOS",
            grant_instructions="System Settings > Privacy & Security > Location Services > Enable for Matrx Local",
        )

    return PermissionResult(
        permission="location",
        status=PermissionStatus.UNKNOWN,
        details="Location services check not yet implemented for this platform",
        grant_instructions="Check your system's location settings",
    )


# ---------------------------------------------------------------------------
# macOS TCC helper
# ---------------------------------------------------------------------------

async def _macos_check_tcc(service: str, label: str) -> PermissionStatus:
    """Try to determine macOS TCC permission status.

    Since reading the TCC database requires Full Disk Access, we use heuristic
    probes instead.
    """
    # For microphone, try a quick sounddevice query
    if "Microphone" in label:
        try:
            import sounddevice as sd
            sd.query_devices()
            # If we can query devices, at minimum the driver is accessible.
            # Actual recording permission may still require a grant, but
            # device enumeration succeeding is a positive signal.
            return PermissionStatus.GRANTED
        except Exception:
            return PermissionStatus.UNKNOWN

    # For camera, check if system_profiler can list cameras
    if "Camera" in label:
        try:
            out, _, rc = await _run(["system_profiler", "SPCameraDataType", "-json"])
            data = json.loads(out)
            if data.get("SPCameraDataType"):
                return PermissionStatus.GRANTED
        except Exception:
            pass
        return PermissionStatus.UNKNOWN

    return PermissionStatus.UNKNOWN


# ---------------------------------------------------------------------------
# Full scan
# ---------------------------------------------------------------------------

async def check_all_permissions() -> list[dict[str, Any]]:
    """Run all permission checks concurrently and return structured results."""
    results = await asyncio.gather(
        check_microphone(),
        check_camera(),
        check_accessibility(),
        check_bluetooth(),
        check_network(),
        check_screen_recording(),
        check_location(),
        return_exceptions=True,
    )

    output: list[dict[str, Any]] = []
    names = [
        "microphone", "camera", "accessibility", "bluetooth",
        "network", "screen_recording", "location",
    ]
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            output.append({
                "permission": names[i],
                "status": "unknown",
                "details": f"Check failed: {result}",
                "grant_instructions": "",
            })
        else:
            output.append(result.to_dict())

    return output
