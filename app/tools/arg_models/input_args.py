from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ── Input automation ──────────────────────────────────────────────────────────

class TypeTextArgs(BaseModel):
    text: str = Field(description="Text to type via simulated keystrokes.")
    delay_ms: int = Field(
        default=50,
        ge=0,
        le=500,
        description="Delay in milliseconds between each keystroke.",
    )
    app_name: str | None = Field(
        default=None,
        description="Optional application name to focus before typing.",
    )


class HotkeyArgs(BaseModel):
    keys: str = Field(
        description=(
            "Key combination in modifier+key format. "
            "Examples: 'cmd+c', 'ctrl+shift+s', 'alt+tab', 'cmd+space'. "
            "Modifiers: cmd/command, ctrl/control, alt/option, shift."
        )
    )
    app_name: str | None = Field(
        default=None,
        description="Optional application name to focus before sending the hotkey.",
    )


class MouseClickArgs(BaseModel):
    x: int = Field(description="Screen X coordinate (pixels from left edge).")
    y: int = Field(description="Screen Y coordinate (pixels from top edge).")
    button: Literal["left", "right", "middle"] = Field(
        default="left",
        description="Mouse button to click.",
    )
    clicks: int = Field(
        default=1,
        ge=1,
        le=3,
        description="Number of clicks (1=single, 2=double, 3=triple).",
    )
    app_name: str | None = Field(
        default=None,
        description="Optional application to focus before clicking.",
    )


class MouseMoveArgs(BaseModel):
    x: int = Field(description="Target screen X coordinate.")
    y: int = Field(description="Target screen Y coordinate.")


# ── Window management ─────────────────────────────────────────────────────────

class ListWindowsArgs(BaseModel):
    app_filter: str | None = Field(
        default=None,
        description="Optional application name substring to filter the window list.",
    )


class FocusWindowArgs(BaseModel):
    app_name: str = Field(description="Application whose window should be focused.")
    window_title: str | None = Field(
        default=None,
        description="Optional window title substring for disambiguation when an app has multiple windows.",
    )


class MoveWindowArgs(BaseModel):
    app_name: str = Field(description="Application whose window to move/resize.")
    x: int | None = Field(default=None, description="New left edge position in pixels.")
    y: int | None = Field(default=None, description="New top edge position in pixels.")
    width: int | None = Field(default=None, ge=1, description="New window width in pixels.")
    height: int | None = Field(default=None, ge=1, description="New window height in pixels.")


class MinimizeWindowArgs(BaseModel):
    app_name: str = Field(description="Application whose window to control.")
    action: Literal["minimize", "maximize", "restore"] = Field(
        default="minimize",
        description="Window action to perform.",
    )
