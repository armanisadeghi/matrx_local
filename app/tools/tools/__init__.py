"""Shared helpers for OS/platform detection used across tool modules."""

from __future__ import annotations

import functools
import platform
import shutil
import subprocess
from pathlib import Path

IS_WINDOWS = platform.system() == "Windows"
IS_MACOS = platform.system() == "Darwin"
IS_LINUX = platform.system() == "Linux"


@functools.lru_cache(maxsize=1)
def is_wsl() -> bool:
    """Detect if running inside Windows Subsystem for Linux."""
    if not IS_LINUX:
        return False
    try:
        return "microsoft" in Path("/proc/version").read_text().lower()
    except Exception:
        return False


def has_display() -> bool:
    """Check whether a desktop/display environment is available on Linux."""
    if IS_MACOS or IS_WINDOWS:
        return True
    import os

    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def open_path_cross_platform(path_str: str) -> tuple[bool, str]:
    """Open a file or folder in the OS file manager.

    Returns (success, message).
    """
    import os

    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.Popen(["open", path_str])
        elif system == "Windows":
            os.startfile(path_str)  # type: ignore[attr-defined]
        elif is_wsl():
            wsl_path = subprocess.check_output(
                ["wslpath", "-w", path_str], text=True
            ).strip()
            subprocess.Popen(["explorer.exe", wsl_path])
        else:
            if shutil.which("xdg-open"):
                subprocess.Popen(["xdg-open", path_str])
            else:
                return True, f"No file manager available. Path: {path_str}"
        return True, f"Opened {path_str}"
    except Exception as e:
        return False, f"Failed to open: {e}"


NO_GUI_MSG = (
    "This feature requires a desktop environment and is not available "
    "in headless or WSL sessions without a display server."
)
