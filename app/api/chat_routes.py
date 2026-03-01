"""Chat API routes — tool schemas + AI streaming completions.

Provides:
  GET  /chat/tools                   — all tool schemas (Anthropic-compatible)
  GET  /chat/tools/by-category       — tool schemas grouped by category
  GET  /chat/tools/anthropic         — Anthropic Messages API format

  POST /chat/ai/chat                 — streaming chat completions (matrx-ai)
  POST /chat/ai/agents/{agent_id}    — start agent conversation (matrx-ai)
  POST /chat/ai/conversations/{id}   — continue conversation (matrx-ai)
  POST /chat/ai/cancel/{request_id}  — cancel in-flight request (matrx-ai)
"""

from __future__ import annotations

from fastapi import APIRouter

from app.tools.tool_schemas import (
    generate_all_tool_schemas,
    get_anthropic_tools,
    get_tool_schemas_by_category,
)

router = APIRouter(prefix="/chat", tags=["chat"])


# ---------------------------------------------------------------------------
# Tool schema endpoints (existing — no auth required)
# ---------------------------------------------------------------------------


@router.get("/tools")
async def list_tool_schemas() -> dict:
    """Return all tool schemas with category info for the chat UI."""
    schemas = generate_all_tool_schemas()
    return {"tools": schemas, "total": len(schemas)}


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
    """Return tool schemas in Anthropic Messages API format."""
    tools = get_anthropic_tools()
    return {"tools": tools, "total": len(tools)}


# ---------------------------------------------------------------------------
# AI streaming endpoints (matrx-ai engine)
# These are mounted as a sub-application with matrx-ai's AuthMiddleware so
# that AppContext / StreamEmitter are properly set for every request.
# See main.py for how ai_app is constructed and mounted.
# ---------------------------------------------------------------------------
# The actual route handlers live in matrx_ai.app.routers — we import them
# directly here so we don't duplicate any logic.

def build_ai_sub_app() -> "FastAPI":  # noqa: F821  (imported inside to avoid circular at module level)
    """Build a self-contained FastAPI sub-application for AI routes.

    Mounted at /chat/ai in the parent app. Has its own matrx-ai
    AuthMiddleware so AppContext and StreamEmitter are set correctly for
    every AI request, independent of the parent app's own auth.
    """
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    from matrx_ai.app.middleware.auth import AuthMiddleware as MatrxAuthMiddleware
    from matrx_ai.app.routers.chat import router as matrx_chat_router
    from matrx_ai.app.routers.agent import router as matrx_agent_router
    from matrx_ai.app.routers.agent import public_router as matrx_agent_public_router
    from matrx_ai.app.routers.agent import cancel_router as matrx_cancel_router
    from matrx_ai.app.routers.conversation import router as matrx_conversation_router
    from matrx_ai.app.routers.conversation import public_router as matrx_conversation_public_router

    from app.config import ALLOWED_ORIGINS

    ai_app = FastAPI(
        title="Matrx AI Engine",
        description="AI orchestration endpoints — streaming chat, agents, conversations",
        version="0.1.0",
    )

    # matrx-ai's own auth middleware sets AppContext + StreamEmitter per request.
    # Must be added BEFORE CORSMiddleware so it runs innermost.
    ai_app.add_middleware(MatrxAuthMiddleware)

    ai_app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # The matrx-ai routers use /api/ai/* prefixes internally.
    # When mounted at /chat/ai, the effective paths become:
    #   POST /chat/ai/api/ai/chat
    #   POST /chat/ai/api/ai/agents/{agent_id}
    #   POST /chat/ai/api/ai/conversations/{id}
    #   POST /chat/ai/api/ai/cancel/{request_id}
    ai_app.include_router(matrx_chat_router)
    ai_app.include_router(matrx_agent_router)
    ai_app.include_router(matrx_agent_public_router)
    ai_app.include_router(matrx_cancel_router)
    ai_app.include_router(matrx_conversation_router)
    ai_app.include_router(matrx_conversation_public_router)

    return ai_app
