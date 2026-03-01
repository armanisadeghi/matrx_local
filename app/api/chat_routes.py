"""Chat API routes — tool schemas, models, agents, + AI streaming completions.

Provides:
  GET  /chat/tools                   — all tool schemas (Anthropic-compatible)
  GET  /chat/tools/by-category       — tool schemas grouped by category
  GET  /chat/tools/anthropic         — Anthropic Messages API format
  GET  /chat/models                  — live AI models from Supabase DB
  GET  /chat/agents                  — live agents/prompts from Supabase DB

  POST /chat/ai/chat                 — streaming chat completions (matrx-ai)
  POST /chat/ai/agents/{agent_id}    — start agent conversation (matrx-ai)
  POST /chat/ai/conversations/{id}   — continue conversation (matrx-ai)
  POST /chat/ai/cancel/{request_id}  — cancel in-flight request (matrx-ai)
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastapi import FastAPI

from fastapi import APIRouter

from app.common.system_logger import get_logger
from app.tools.tool_schemas import (
    generate_all_tool_schemas,
    get_anthropic_tools,
    get_tool_schemas_by_category,
)

logger = get_logger()
router = APIRouter(prefix="/chat", tags=["chat"])

# ---------------------------------------------------------------------------
# Endpoint → provider label mapping (from matrx_ai endpoints field)
# ---------------------------------------------------------------------------
_ENDPOINT_TO_PROVIDER: dict[str, str] = {
    "anthropic_chat": "anthropic",
    "anthropic_adaptive": "anthropic",
    "openai_chat": "openai",
    "google_chat": "google",
    "groq_chat": "groq",
    "together_chat": "together",
    "xai_chat": "xai",
    "cerebras_chat": "cerebras",
}

# Providers whose keys we'd realistically have installed locally
_SUPPORTED_PROVIDERS = {"anthropic", "openai", "google", "groq", "together", "xai", "cerebras"}


def _endpoint_to_provider(endpoints: list[str]) -> str | None:
    for ep in endpoints:
        p = _ENDPOINT_TO_PROVIDER.get(ep)
        if p in _SUPPORTED_PROVIDERS:
            return p
    return None


# ---------------------------------------------------------------------------
# Tool schema endpoints (no auth required)
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
# Models endpoint — live from Supabase DB via matrx-ai
# ---------------------------------------------------------------------------


@router.get("/models")
async def list_models() -> dict[str, Any]:
    """Return all active AI models from the Supabase database.

    Falls back to an empty list if the DB is not configured.
    Each model includes: id (DB uuid), name (API id), common_name, provider,
    endpoints, capabilities, context_window, max_tokens, controls.
    """
    import matrx_ai as _matrx_ai

    if not _matrx_ai._initialized:
        return {"models": [], "total": 0, "source": "fallback"}

    try:
        from matrx_ai.db.custom.ai_model_manager import AiModelManager

        mgr = AiModelManager()
        all_models = await mgr.load_all_models()

        models_out: list[dict[str, Any]] = []
        for m in all_models:
            d = m.to_dict()
            if d.get("is_deprecated"):
                continue
            endpoints: list[str] = d.get("endpoints") or []
            provider = _endpoint_to_provider(endpoints)
            if not provider:
                continue  # skip models with no supported provider endpoint

            models_out.append({
                "id": d["id"],
                "name": d["name"],              # the API model_id to send in requests
                "common_name": d["common_name"],
                "provider": provider,
                "endpoints": endpoints,
                "capabilities": d.get("capabilities") or [],
                "context_window": d.get("context_window"),
                "max_tokens": d.get("max_tokens"),
                "is_primary": d.get("is_primary", False),
                "is_premium": d.get("is_premium", False),
            })

        # Sort: primaries first, then alphabetically by provider then name
        models_out.sort(key=lambda x: (not x["is_primary"], x["provider"], x["common_name"]))

        return {"models": models_out, "total": len(models_out), "source": "database"}

    except Exception:
        logger.warning("Failed to load models from DB", exc_info=True)
        return {"models": [], "total": 0, "source": "error"}


# ---------------------------------------------------------------------------
# Agents endpoint — live from Supabase DB via matrx-ai
# ---------------------------------------------------------------------------


@router.get("/agents")
async def list_agents() -> dict[str, Any]:
    """Return all agents/prompts from the Supabase database.

    Falls back to empty if DB not configured.
    Each agent includes: id, name, description, model (if set).
    """
    import matrx_ai as _matrx_ai

    if not _matrx_ai._initialized:
        return {"agents": [], "total": 0, "source": "fallback"}

    try:
        from matrx_ai.db.managers.prompts import PromptsBase

        class _PM(PromptsBase):
            pass

        pm = _PM()
        prompts = await pm.load_items()

        agents_out = []
        for p in prompts:
            d = p.to_dict() if hasattr(p, "to_dict") else {}
            agents_out.append({
                "id": d.get("id") or getattr(p, "id", None),
                "name": d.get("name") or getattr(p, "name", ""),
                "description": d.get("description") or getattr(p, "description", ""),
                "model": d.get("model") or getattr(p, "model", None),
            })

        agents_out.sort(key=lambda x: x["name"])
        return {"agents": agents_out, "total": len(agents_out), "source": "database"}

    except Exception:
        logger.warning("Failed to load agents from DB", exc_info=True)
        return {"agents": [], "total": 0, "source": "error"}


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
