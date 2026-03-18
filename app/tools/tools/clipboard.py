"""Clipboard tools — read and write the system clipboard. Cross-platform."""

from __future__ import annotations

import logging

from app.common.platform_ctx import CAPABILITIES
from app.tools.session import ToolSession
from app.tools.types import ToolResult, ToolResultType

logger = logging.getLogger(__name__)

_CLIPBOARD_HELP = (
    "Cannot access clipboard. Possible fixes:\n"
    "  • WSL: install xclip ('sudo apt install xclip') or use clip.exe directly\n"
    "  • Headless Linux: install xclip or xsel ('sudo apt install xclip')\n"
    "  • Ensure a display server (X11/Wayland) is running"
)


async def tool_clipboard_read(
    session: ToolSession,
) -> ToolResult:
    if not CAPABILITIES["has_pyperclip"]:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Clipboard support requires pyperclip. Install it with: uv add pyperclip",
        )

    import pyperclip

    try:
        content = pyperclip.paste()
    except pyperclip.PyperclipException as e:
        return ToolResult(
            type=ToolResultType.ERROR, output=f"{_CLIPBOARD_HELP}\n\nDetail: {e}"
        )

    if not content:
        return ToolResult(output="(clipboard is empty)")

    return ToolResult(
        output=content,
        metadata={"length": len(content)},
    )


async def tool_clipboard_write(
    session: ToolSession,
    content: str,
) -> ToolResult:
    if not CAPABILITIES["has_pyperclip"]:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Clipboard support requires pyperclip. Install it with: uv add pyperclip",
        )

    import pyperclip

    try:
        pyperclip.copy(content)
    except pyperclip.PyperclipException as e:
        return ToolResult(
            type=ToolResultType.ERROR, output=f"{_CLIPBOARD_HELP}\n\nDetail: {e}"
        )

    return ToolResult(
        output=f"Copied {len(content)} characters to clipboard.",
        metadata={"length": len(content)},
    )
