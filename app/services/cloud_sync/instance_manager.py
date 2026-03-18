"""Instance registration and system identification.

Collects system info, generates a stable instance ID, and registers
with Supabase so the cloud knows about this device.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Optional

from app.common.platform_ctx import PLATFORM

logger = logging.getLogger(__name__)

from app.config import MATRX_HOME_DIR
INSTANCE_FILE = MATRX_HOME_DIR / "instance.json"


def _stable_machine_id() -> str:
    """Generate a stable machine identifier from hardware characteristics.

    Preference order: hardware_uuid (board-level, survives OS reinstall) →
    serial_number → /etc/machine-id (Linux) → hostname+arch+OS fallback.
    The result is SHA-256 hashed to a fixed 32-char hex string.
    """
    parts = [
        PLATFORM["hostname"],
        PLATFORM["machine"],
        PLATFORM["system"],
    ]
    try:
        system = PLATFORM["system"]
        if system == "Darwin":
            import subprocess
            out = subprocess.run(
                ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                capture_output=True, text=True, timeout=5,
            ).stdout
            for line in out.splitlines():
                if "IOPlatformUUID" in line:
                    parts.append(line.split('"')[-2])
                    break
        elif system == "Linux":
            machine_id = Path("/etc/machine-id")
            if machine_id.exists():
                parts.append(machine_id.read_text().strip())
            else:
                uuid_path = Path("/sys/class/dmi/id/product_uuid")
                if uuid_path.exists():
                    parts.append(uuid_path.read_text().strip())
        elif system == "Windows":
            import subprocess
            out = subprocess.run(
                ["wmic", "csproduct", "get", "uuid"],
                capture_output=True, text=True, timeout=5,
            ).stdout
            lines = [l.strip() for l in out.splitlines() if l.strip() and l.strip() != "UUID"]
            if lines:
                parts.append(lines[0])
    except Exception:
        pass

    raw = "|".join(parts)
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def _get_or_create_instance_id() -> str:
    """Get existing instance ID or create a new one and persist it."""
    if INSTANCE_FILE.exists():
        try:
            data = json.loads(INSTANCE_FILE.read_text())
            if "instance_id" in data:
                return data["instance_id"]
        except Exception:
            pass

    instance_id = f"inst_{_stable_machine_id()}"

    INSTANCE_FILE.parent.mkdir(parents=True, exist_ok=True)
    INSTANCE_FILE.write_text(json.dumps({"instance_id": instance_id}, indent=2))

    return instance_id


def _collect_hardware_ids() -> dict[str, str | None]:
    """Collect truly unique hardware identifiers per OS.

    Returns a dict with keys: hardware_uuid, serial_number, board_id.
    All values are None if unavailable — never raises.
    """
    result: dict[str, str | None] = {
        "hardware_uuid": None,
        "serial_number": None,
        "board_id": None,
    }
    try:
        system = PLATFORM["system"]
        if system == "Darwin":
            import subprocess
            out = subprocess.run(
                ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                capture_output=True, text=True, timeout=5,
            ).stdout
            for line in out.splitlines():
                if "IOPlatformUUID" in line:
                    result["hardware_uuid"] = line.split('"')[-2]
                elif "IOPlatformSerialNumber" in line:
                    result["serial_number"] = line.split('"')[-2]
                elif "board-id" in line.lower():
                    result["board_id"] = line.split('"')[-2]

        elif system == "Linux":
            # DMI info — requires root on some distros but try anyway
            for path, key in [
                ("/sys/class/dmi/id/product_uuid", "hardware_uuid"),
                ("/sys/class/dmi/id/product_serial", "serial_number"),
                ("/sys/class/dmi/id/board_name", "board_id"),
            ]:
                try:
                    val = Path(path).read_text().strip()
                    if val and val not in ("", "None", "To be filled by O.E.M."):
                        result[key] = val
                except Exception:
                    pass

        elif system == "Windows":
            import subprocess
            # BIOS serial
            bios = subprocess.run(
                ["wmic", "bios", "get", "serialnumber"],
                capture_output=True, text=True, timeout=5,
            ).stdout
            lines = [l.strip() for l in bios.splitlines() if l.strip() and l.strip() != "SerialNumber"]
            if lines:
                result["serial_number"] = lines[0]
            # Board product UUID
            csproduct = subprocess.run(
                ["wmic", "csproduct", "get", "uuid"],
                capture_output=True, text=True, timeout=5,
            ).stdout
            lines = [l.strip() for l in csproduct.splitlines() if l.strip() and l.strip() != "UUID"]
            if lines:
                result["hardware_uuid"] = lines[0]
            # Baseboard
            board = subprocess.run(
                ["wmic", "baseboard", "get", "product"],
                capture_output=True, text=True, timeout=5,
            ).stdout
            lines = [l.strip() for l in board.splitlines() if l.strip() and l.strip() != "Product"]
            if lines:
                result["board_id"] = lines[0]
    except Exception:
        pass
    return result


def collect_system_info() -> dict:
    """Collect comprehensive system identification info."""
    info: dict = {
        "platform": PLATFORM["system"].lower(),
        "os_version": PLATFORM["os_version"],
        "architecture": PLATFORM["machine"],
        "hostname": PLATFORM["hostname"],
        "username": os.getenv("USER") or os.getenv("USERNAME") or "",
        "python_version": PLATFORM["python_version"],
        "home_dir": str(Path.home()),
    }

    # CPU info
    try:
        info["cpu_model"] = PLATFORM["processor"] or "unknown"
        info["cpu_cores"] = os.cpu_count() or 0
    except Exception:
        info["cpu_model"] = "unknown"
        info["cpu_cores"] = 0

    # RAM info
    try:
        import psutil
        mem = psutil.virtual_memory()
        info["ram_total_gb"] = round(mem.total / (1024 ** 3), 2)
    except ImportError:
        info["ram_total_gb"] = 0

    # Hardware identifiers (serial number, hardware UUID, board ID)
    info.update(_collect_hardware_ids())

    return info


class InstanceManager:
    """Manages the local app instance identity and registration."""

    def __init__(self) -> None:
        self._instance_id: Optional[str] = None
        self._system_info: Optional[dict] = None
        self._instance_name: str = "My Computer"

    @property
    def instance_id(self) -> str:
        if self._instance_id is None:
            self._instance_id = _get_or_create_instance_id()
        return self._instance_id

    @property
    def system_info(self) -> dict:
        if self._system_info is None:
            self._system_info = collect_system_info()
        return self._system_info

    @property
    def instance_name(self) -> str:
        return self._instance_name

    @instance_name.setter
    def instance_name(self, value: str) -> None:
        self._instance_name = value

    def get_registration_payload(self) -> dict:
        """Get the full payload for registering this instance with the cloud."""
        info = self.system_info
        return {
            "instance_id": self.instance_id,
            "instance_name": self._instance_name,
            "platform": info.get("platform"),
            "os_version": info.get("os_version"),
            "architecture": info.get("architecture"),
            "hostname": info.get("hostname"),
            "username": info.get("username"),
            "python_version": info.get("python_version"),
            "home_dir": info.get("home_dir"),
            "cpu_model": info.get("cpu_model"),
            "cpu_cores": info.get("cpu_cores"),
            "ram_total_gb": info.get("ram_total_gb"),
            "hardware_uuid": info.get("hardware_uuid"),
            "serial_number": info.get("serial_number"),
            "board_id": info.get("board_id"),
        }

    async def update_tunnel_url(self, tunnel_url: Optional[str], active: bool) -> bool:
        """Push the current tunnel URL and active state to Supabase app_instances.

        Called when a tunnel starts or stops. Best-effort — never raises.
        Returns True on success, False on failure.
        """
        try:
            from app.services.cloud_sync.settings_sync import get_settings_sync
            from datetime import datetime, timezone
            import httpx

            sync = get_settings_sync()
            if not sync.is_configured:
                logger.debug("update_tunnel_url: settings sync not configured, skipping")
                return False

            now = datetime.now(timezone.utc).isoformat()
            payload = {
                "tunnel_url": tunnel_url,
                "tunnel_active": active,
                "tunnel_updated_at": now,
                "last_seen": now,
            }
            url = (
                f"{sync._supabase_url}/rest/v1/app_instances"
                f"?instance_id=eq.{self.instance_id}&user_id=eq.{sync._user_id}"
            )
            headers = {
                **sync._headers(),
                "Prefer": "return=minimal",
            }
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.patch(url, json=payload, headers=headers)
                if resp.is_success:
                    logger.debug(
                        "Tunnel URL updated in Supabase: active=%s url=%s",
                        active, tunnel_url,
                    )
                    return True
                else:
                    logger.warning(
                        "update_tunnel_url failed: %d %s",
                        resp.status_code, resp.text[:200],
                    )
                    return False
        except Exception as exc:
            logger.debug("update_tunnel_url exception: %s", exc)
            return False


# Module-level singleton
_instance_manager: Optional[InstanceManager] = None


def get_instance_manager() -> InstanceManager:
    global _instance_manager
    if _instance_manager is None:
        _instance_manager = InstanceManager()
    return _instance_manager
