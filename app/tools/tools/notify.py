"""Notification tool — send native OS notifications. Cross-platform via plyer."""

from __future__ import annotations

import logging

from app.tools.session import ToolSession
from app.tools.types import ToolResult, ToolResultType

logger = logging.getLogger(__name__)


async def tool_notify(
    session: ToolSession,
    title: str,
    message: str,
    timeout: int = 10,
) -> ToolResult:
    try:
        from plyer import notification
    except ImportError:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Notifications require plyer. Install it with: uv add plyer",
        )

    try:
        notification.notify(
            title=title,
            message=message,
            app_name="Matrx Local",
            timeout=timeout,
        )
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Notification failed: {e}")

    return ToolResult(output=f"Notification sent: {title}")
