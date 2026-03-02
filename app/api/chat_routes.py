"""Chat API routes — tool schemas, models, agents, + AI streaming completions.

Provides:
  GET  /chat/tools                   — all tool schemas (Anthropic-compatible)
  GET  /chat/tools/by-category       — tool schemas grouped by category
  GET  /chat/tools/anthropic         — Anthropic Messages API format
  GET  /chat/models                  — live AI models from Supabase DB
  GET  /chat/agents                  — live agents/prompts from Supabase DB
  GET  /chat/local-tools             — local OS tools registered in matrx-ai registry

  POST /chat/ai/chat                 — streaming chat completions (matrx-ai)
  POST /chat/ai/agents/{agent_id}    — start agent conversation (matrx-ai)
  POST /chat/ai/conversations/{id}   — continue conversation (matrx-ai)
  POST /chat/ai/cancel/{request_id}  — cancel in-flight request (matrx-ai)
"""

from __future__ import annotations

import asyncio
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


@router.get("/local-tools")
async def list_local_tools() -> dict[str, Any]:
    """Return all local OS tools registered in the matrx-ai ToolRegistry.

    These are the tools AI models can call to interact with the local system —
    read/write files, run shell commands, manage processes, control the browser, etc.

    Each entry includes name, description, category, parameters, and version.
    """
    try:
        from app.tools.local_tool_manifest import LOCAL_TOOL_MANIFEST
        from matrx_ai.tools.registry import ToolRegistryV2
        from app.services.ai.engine import tools_loaded

        registry = ToolRegistryV2.get_instance()
        tools_out = []

        for entry in LOCAL_TOOL_MANIFEST:
            tool_def = registry.get(entry.name)
            tools_out.append({
                "name": entry.name,
                "description": entry.description,
                "category": entry.category,
                "tags": entry.tags,
                "parameters": entry.parameters,
                "version": entry.version,
                "function_path": entry.function_path,
                "registered": tool_def is not None,
                "timeout_seconds": entry.timeout_seconds,
            })

        registered_count = sum(1 for t in tools_out if t["registered"])
        return {
            "tools": tools_out,
            "total": len(tools_out),
            "registered": registered_count,
            "registry_loaded": tools_loaded(),
        }
    except Exception:
        logger.warning("Failed to list local tools", exc_info=True)
        return {"tools": [], "total": 0, "registered": 0, "registry_loaded": False}


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
# Agents endpoint — builtins + user prompts, full variable_defaults included
# ---------------------------------------------------------------------------


def _shape_agent(d: dict[str, Any], source: str) -> dict[str, Any]:
    """Normalize a prompt/builtin DB row into a consistent agent shape."""
    settings: dict[str, Any] = d.get("settings") or {}
    return {
        "id": d.get("id", ""),
        "name": d.get("name", ""),
        "description": d.get("description") or "",
        "source": source,                          # "builtin" | "user" | "shared"
        "variable_defaults": d.get("variable_defaults") or [],
        "settings": {
            "model_id": settings.get("model_id"),
            "temperature": settings.get("temperature"),
            "max_tokens": settings.get("max_tokens") or settings.get("max_output_tokens"),
            "stream": settings.get("stream", True),
            "tools": settings.get("tools") or [],
        },
    }


@router.get("/agents")
async def list_agents() -> dict[str, Any]:
    """Return all agents available to the current user.

    Three categories:
      - builtins: from prompt_builtins table (system agents, available to everyone)
      - user:     from prompts table (user's own agents)
      - shared:   TODO — requires user JWT; returns empty for now

    Falls back gracefully if DB not configured.
    Full variable_defaults (with customComponent config) are included so the
    frontend can render the correct input widgets per variable.
    """
    import matrx_ai as _matrx_ai

    if not _matrx_ai._initialized:
        return {"builtins": [], "user": [], "shared": [], "source": "fallback"}

    try:
        from matrx_ai.db.managers.prompt_builtins import PromptBuiltinsBase
        from matrx_ai.db.managers.prompts import PromptsBase

        class _PB(PromptBuiltinsBase):
            pass

        class _PM(PromptsBase):
            pass

        pb_mgr = _PB()
        pm_mgr = _PM()

        builtins_raw, prompts_raw = await asyncio.gather(
            pb_mgr.load_items(),
            pm_mgr.load_items(),
        )

        builtins = sorted(
            [_shape_agent(b.to_dict(), "builtin") for b in builtins_raw if b.to_dict().get("is_active", True)],
            key=lambda x: x["name"],
        )
        user_agents = sorted(
            [_shape_agent(p.to_dict(), "user") for p in prompts_raw],
            key=lambda x: x["name"],
        )

        return {
            "builtins": builtins,
            "user": user_agents,
            "shared": [],   # populated once we have a user JWT to call get_prompts_shared_with_me
            "source": "database",
            "totals": {
                "builtins": len(builtins),
                "user": len(user_agents),
                "shared": 0,
                "total": len(builtins) + len(user_agents),
            },
        }

    except Exception:
        logger.warning("Failed to load agents from DB", exc_info=True)
        return {"builtins": [], "user": [], "shared": [], "source": "error"}


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
