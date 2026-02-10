"""HTTP routes for the tool dispatcher.

Provides a REST interface alongside the WebSocket interface.
Each request creates a fresh session (stateless). For persistent sessions
with working-directory tracking and background processes, use WebSocket.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.tools.dispatcher import TOOL_NAMES, dispatch
from app.tools.session import ToolSession

router = APIRouter()


class ToolRequest(BaseModel):
    tool: str = Field(description="Tool name to invoke")
    input: dict[str, Any] = Field(default_factory=dict, description="Tool parameters")


class ToolResponse(BaseModel):
    type: str
    output: str
    image: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


@router.get("/list")
async def list_tools() -> dict[str, list[str]]:
    return {"tools": TOOL_NAMES}


@router.post("/invoke", response_model=ToolResponse)
async def invoke_tool(req: ToolRequest) -> ToolResponse:
    session = ToolSession()
    result = await dispatch(req.tool, req.input, session)
    await session.cleanup()

    return ToolResponse(
        type=result.type.value,
        output=result.output,
        image=result.image.model_dump() if result.image else None,
        metadata=result.metadata,
    )
