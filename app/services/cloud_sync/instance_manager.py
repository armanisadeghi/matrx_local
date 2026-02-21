"""Instance registration and system identification.

Collects system info, generates a stable instance ID, and registers
with Supabase so the cloud knows about this device.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import platform
import uuid
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

INSTANCE_FILE = Path.home() / ".matrx" / "instance.json"


def _stable_machine_id() -> str:
    """Generate a stable machine identifier from hardware characteristics."""
    parts = [
        platform.node(),  # hostname
        platform.machine(),  # arch
        platform.system(),  # OS
    ]
    # Try to include a unique hardware ID
    try:
        if platform.system() == "Darwin":
            import subprocess
            result = subprocess.run(
                ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                capture_output=True, text=True, timeout=5,
            )
            for line in result.stdout.splitlines():
                if "IOPlatformUUID" in line:
                    parts.append(line.split('"')[-2])
                    break
        elif platform.system() == "Linux":
            machine_id = Path("/etc/machine-id")
            if machine_id.exists():
                parts.append(machine_id.read_text().strip())
        elif platform.system() == "Windows":
            import subprocess
            result = subprocess.run(
                ["wmic", "csproduct", "get", "uuid"],
                capture_output=True, text=True, timeout=5,
            )
            lines = [l.strip() for l in result.stdout.splitlines() if l.strip() and l.strip() != "UUID"]
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


def collect_system_info() -> dict:
    """Collect comprehensive system identification info."""
    info: dict = {
        "platform": platform.system().lower(),
        "os_version": platform.platform(),
        "architecture": platform.machine(),
        "hostname": platform.node(),
        "username": os.getenv("USER") or os.getenv("USERNAME") or "",
        "python_version": platform.python_version(),
        "home_dir": str(Path.home()),
    }

    # CPU info
    try:
        info["cpu_model"] = platform.processor() or "unknown"
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
        }


# Module-level singleton
_instance_manager: Optional[InstanceManager] = None


def get_instance_manager() -> InstanceManager:
    global _instance_manager
    if _instance_manager is None:
        _instance_manager = InstanceManager()
    return _instance_manager
