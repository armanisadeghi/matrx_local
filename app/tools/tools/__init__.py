"""Shared helpers for OS/platform detection used across tool modules.

All platform detection is delegated to the canonical platform_ctx module.
This file re-exports commonly used symbols for backward compatibility.
"""

from __future__ import annotations

from app.common.platform_ctx import (
    PLATFORM,
    CAPABILITIES,
    open_path_cross_platform,
)

IS_WINDOWS: bool = PLATFORM["is_windows"]
IS_MACOS: bool = PLATFORM["is_mac"]
IS_LINUX: bool = PLATFORM["is_linux"]


def is_wsl() -> bool:
    """Detect if running inside Windows Subsystem for Linux."""
    return PLATFORM["is_wsl"]


def has_display() -> bool:
    """Check whether a desktop/display environment is available."""
    return CAPABILITIES["has_display"]


NO_GUI_MSG = (
    "This feature requires a desktop environment and is not available "
    "in headless or WSL sessions without a display server."
)
