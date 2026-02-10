"""Clipboard tools — read and write the system clipboard. Cross-platform."""

from __future__ import annotations

import logging

from app.tools.session import ToolSession
from app.tools.types import ToolResult, ToolResultType

logger = logging.getLogger(__name__)


async def tool_clipboard_read(
    session: ToolSession,
) -> ToolResult:
    try:
        import pyperclip
    except ImportError:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Clipboard support requires pyperclip. Install it with: uv add pyperclip",
        )

    try:
        content = pyperclip.paste()
    except pyperclip.PyperclipException as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Cannot access clipboard: {e}")

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
    try:
        import pyperclip
    except ImportError:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Clipboard support requires pyperclip. Install it with: uv add pyperclip",
        )

    try:
        pyperclip.copy(content)
    except pyperclip.PyperclipException as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Cannot write to clipboard: {e}")

    return ToolResult(
        output=f"Copied {len(content)} characters to clipboard.",
        metadata={"length": len(content)},
    )
