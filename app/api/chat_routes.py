"""Chat API routes — tool schemas endpoint and chat session management.

Provides endpoints for:
- Listing all tool schemas in Anthropic-compatible format
- Tool schemas grouped by category for UI rendering
"""

from __future__ import annotations

from fastapi import APIRouter

from app.tools.tool_schemas import (
    generate_all_tool_schemas,
    get_anthropic_tools,
    get_tool_schemas_by_category,
)

router = APIRouter(prefix="/chat", tags=["chat"])


@router.get("/tools")
async def list_tool_schemas() -> dict:
    """Return all tool schemas with category info for the chat UI."""
    return {
        "tools": generate_all_tool_schemas(),
        "total": len(generate_all_tool_schemas()),
    }


@router.get("/tools/by-category")
async def list_tool_schemas_by_category() -> dict:
    """Return tool schemas grouped by category."""
    grouped = get_tool_schemas_by_category()
    return {
        "categories": grouped,
        "total_categories": len(grouped),
        "total_tools": sum(len(v) for v in grouped.values()),
    }


@router.get("/tools/anthropic")
async def list_anthropic_tool_schemas() -> dict:
    """Return tool schemas in Anthropic Messages API format (no category)."""
    tools = get_anthropic_tools()
    return {"tools": tools, "total": len(tools)}
