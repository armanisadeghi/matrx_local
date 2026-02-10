"""Tool dispatcher — routes tool calls to the correct handler function."""

from __future__ import annotations

import logging
from typing import Any, Callable, Coroutine

from app.tools.session import ToolSession
from app.tools.tools.execution import tool_bash, tool_bash_output, tool_task_stop
from app.tools.tools.file_ops import tool_edit, tool_glob, tool_grep, tool_read, tool_write
from app.tools.tools.system import (
    tool_list_directory,
    tool_open_path,
    tool_open_url,
    tool_screenshot,
    tool_system_info,
)
from app.tools.types import ToolResult, ToolResultType

logger = logging.getLogger(__name__)

ToolHandler = Callable[..., Coroutine[Any, Any, ToolResult]]

TOOL_HANDLERS: dict[str, ToolHandler] = {
    # File operations
    "Read": tool_read,
    "Write": tool_write,
    "Edit": tool_edit,
    "Glob": tool_glob,
    "Grep": tool_grep,
    # Execution
    "Bash": tool_bash,
    "BashOutput": tool_bash_output,
    "TaskStop": tool_task_stop,
    # System
    "SystemInfo": tool_system_info,
    "Screenshot": tool_screenshot,
    "ListDirectory": tool_list_directory,
    "OpenUrl": tool_open_url,
    "OpenPath": tool_open_path,
}

TOOL_NAMES: list[str] = sorted(TOOL_HANDLERS.keys())


async def dispatch(
    tool_name: str,
    tool_input: dict[str, Any],
    session: ToolSession,
) -> ToolResult:
    handler = TOOL_HANDLERS.get(tool_name)
    if handler is None:
        return ToolResult(
            type=ToolResultType.ERROR,
            output=f"Unknown tool: {tool_name}. Available: {', '.join(TOOL_NAMES)}",
        )
    try:
        return await handler(session=session, **tool_input)
    except TypeError as e:
        logger.warning("Invalid parameters for tool %s: %s", tool_name, e)
        return ToolResult(
            type=ToolResultType.ERROR,
            output=f"Invalid parameters for {tool_name}: {e}",
        )
    except Exception as e:
        logger.exception("Tool %s failed", tool_name)
        return ToolResult(
            type=ToolResultType.ERROR,
            output=f"Tool {tool_name} failed: {type(e).__name__}: {e}",
        )
