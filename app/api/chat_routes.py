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

Data access strategy
--------------------
matrx-local always runs in client mode (PostgREST + RLS, no direct asyncpg).
All reads for models and agents go through matrx_orm.client.SupabaseManager,
which uses the publishable anon key + the user's JWT.

The asyncpg-based ORM managers (ai_model_manager_instance, PromptBuiltinsBase,
PromptsBase) require a registered 'supabase_automation_matrix' database — that
registration never happens in client mode, so calling them raises an error.
We detect client mode and use SupabaseManager instead.
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
    """Return all local OS tools registered in the matrx-ai ToolRegistry."""
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
# Client-mode helpers — PostgREST via SupabaseManager
# ---------------------------------------------------------------------------

def _get_supabase_manager(table: str):
    """Return a SupabaseManager for the given table using the stored client singleton.

    Raises RuntimeError if matrx-ai is not initialized in client mode.
    Logs the attempt so startup issues are visible in the debug terminal.
    """
    from matrx_orm.client import SupabaseManager
    from matrx_ai.db import get_client_singleton

    config, auth = get_client_singleton()
    logger.debug(
        "[chat_routes] SupabaseManager created for table=%r url=%s",
        table,
        config.url,
    )
    return SupabaseManager(table, config=config, auth=auth)


# ---------------------------------------------------------------------------
# Models endpoint — live from Supabase DB
# ---------------------------------------------------------------------------


@router.get("/models")
async def list_models() -> dict[str, Any]:
    """Return all active AI models from the Supabase database.

    Client mode: queries the 'ai_model' table via PostgREST + RLS.
    Falls back to an empty list with diagnostic info if anything fails.
    """
    import matrx_ai as _matrx_ai

    logger.info("[chat_routes /models] Request received")

    if not _matrx_ai._initialized:
        logger.warning(
            "[chat_routes /models] matrx-ai is NOT initialized — returning empty. "
            "Check SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env and that "
            "initialize_matrx_ai() ran successfully at startup."
        )
        return {"models": [], "total": 0, "source": "fallback", "error": "matrx-ai not initialized"}

    client_mode = _matrx_ai.is_client_mode()
    logger.info("[chat_routes /models] matrx-ai initialized. client_mode=%s", client_mode)

    if client_mode:
        return await _list_models_client()
    else:
        return await _list_models_server()


async def _list_models_client() -> dict[str, Any]:
    """Fetch models via Supabase PostgREST (client mode)."""
    logger.info("[chat_routes /models] Using PostgREST path (client mode)")
    try:
        mgr = _get_supabase_manager("ai_model")
        logger.debug("[chat_routes /models] Calling mgr.load_items() on ai_model table")

        raw_rows: list[dict[str, Any]] = await mgr.load_items()
        logger.info(
            "[chat_routes /models] PostgREST returned %d raw rows from ai_model",
            len(raw_rows),
        )

        if not raw_rows:
            logger.warning(
                "[chat_routes /models] ai_model table returned 0 rows. "
                "Possible causes: RLS policy blocking anon key, table is empty, "
                "or the user is not signed in (no JWT)."
            )

        models_out: list[dict[str, Any]] = []
        skipped_deprecated = 0
        skipped_no_provider = 0

        for row in raw_rows:
            if row.get("is_deprecated"):
                skipped_deprecated += 1
                continue
            endpoints: list[str] = row.get("endpoints") or []
            if isinstance(endpoints, str):
                import json
                try:
                    endpoints = json.loads(endpoints)
                except Exception:
                    endpoints = []
            provider = _endpoint_to_provider(endpoints)
            if not provider:
                skipped_no_provider += 1
                logger.debug(
                    "[chat_routes /models] Skipping model %r — no supported provider endpoint. endpoints=%r",
                    row.get("name"),
                    endpoints,
                )
                continue

            models_out.append({
                "id": row.get("id", ""),
                "name": row.get("name", ""),
                "common_name": row.get("common_name", ""),
                "provider": provider,
                "endpoints": endpoints,
                "capabilities": row.get("capabilities") or [],
                "context_window": row.get("context_window"),
                "max_tokens": row.get("max_tokens"),
                "is_primary": bool(row.get("is_primary", False)),
                "is_premium": bool(row.get("is_premium", False)),
            })

        models_out.sort(key=lambda x: (not x["is_primary"], x["provider"], x["common_name"]))

        logger.info(
            "[chat_routes /models] Returning %d models "
            "(skipped: %d deprecated, %d no-provider) source=postgrest",
            len(models_out),
            skipped_deprecated,
            skipped_no_provider,
        )
        return {"models": models_out, "total": len(models_out), "source": "postgrest"}

    except Exception:
        logger.error(
            "[chat_routes /models] PostgREST fetch FAILED. "
            "Check that SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are correct, "
            "that the ai_model table exists, and that RLS allows anon reads.",
            exc_info=True,
        )
        return {"models": [], "total": 0, "source": "error"}


async def _list_models_server() -> dict[str, Any]:
    """Fetch models via asyncpg ORM managers (server mode)."""
    logger.info("[chat_routes /models] Using asyncpg ORM path (server mode)")
    try:
        from matrx_ai.db.custom.ai_models.ai_model_manager import ai_model_manager_instance

        mgr = ai_model_manager_instance
        all_models = await mgr.load_all_models()
        logger.info("[chat_routes /models] ORM returned %d models", len(all_models))

        models_out: list[dict[str, Any]] = []
        for m in all_models:
            d = m.to_dict()
            if d.get("is_deprecated"):
                continue
            endpoints: list[str] = d.get("endpoints") or []
            provider = _endpoint_to_provider(endpoints)
            if not provider:
                continue

            models_out.append({
                "id": d["id"],
                "name": d["name"],
                "common_name": d["common_name"],
                "provider": provider,
                "endpoints": endpoints,
                "capabilities": d.get("capabilities") or [],
                "context_window": d.get("context_window"),
                "max_tokens": d.get("max_tokens"),
                "is_primary": d.get("is_primary", False),
                "is_premium": d.get("is_premium", False),
            })

        models_out.sort(key=lambda x: (not x["is_primary"], x["provider"], x["common_name"]))
        logger.info("[chat_routes /models] Returning %d models source=database", len(models_out))
        return {"models": models_out, "total": len(models_out), "source": "database"}

    except Exception:
        logger.error("[chat_routes /models] ORM fetch FAILED", exc_info=True)
        return {"models": [], "total": 0, "source": "error"}


# ---------------------------------------------------------------------------
# Agents endpoint — builtins + user prompts, full variable_defaults included
# ---------------------------------------------------------------------------


def _shape_agent(d: dict[str, Any], source: str) -> dict[str, Any]:
    """Normalize a prompt/builtin DB row into a consistent agent shape."""
    settings: dict[str, Any] = d.get("settings") or {}
    if isinstance(settings, str):
        import json
        try:
            settings = json.loads(settings)
        except Exception:
            settings = {}
    return {
        "id": d.get("id", ""),
        "name": d.get("name", ""),
        "description": d.get("description") or "",
        "source": source,
        "variable_defaults": d.get("variable_defaults") or [],
        "category": d.get("category") or None,
        "tags": d.get("tags") or [],
        "is_favorite": bool(d.get("is_favorite", False)),
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

    Client mode: queries via PostgREST + RLS.
    Falls back gracefully with diagnostic info if anything fails.
    """
    import matrx_ai as _matrx_ai

    logger.info("[chat_routes /agents] Request received")

    if not _matrx_ai._initialized:
        logger.warning(
            "[chat_routes /agents] matrx-ai is NOT initialized — returning empty. "
            "Check SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env."
        )
        return {"builtins": [], "user": [], "shared": [], "source": "fallback", "error": "matrx-ai not initialized"}

    client_mode = _matrx_ai.is_client_mode()
    logger.info("[chat_routes /agents] matrx-ai initialized. client_mode=%s", client_mode)

    if client_mode:
        return await _list_agents_client()
    else:
        return await _list_agents_server()


async def _list_agents_client() -> dict[str, Any]:
    """Fetch agents via Supabase PostgREST (client mode)."""
    logger.info("[chat_routes /agents] Using PostgREST path (client mode)")
    try:
        builtins_mgr = _get_supabase_manager("prompt_builtins")
        prompts_mgr = _get_supabase_manager("prompts")

        logger.debug("[chat_routes /agents] Fetching prompt_builtins and prompts concurrently")
        builtins_raw, prompts_raw = await asyncio.gather(
            builtins_mgr.load_items(),
            prompts_mgr.load_items(),
        )

        logger.info(
            "[chat_routes /agents] PostgREST returned %d builtins, %d user prompts",
            len(builtins_raw),
            len(prompts_raw),
        )

        if not builtins_raw:
            logger.warning(
                "[chat_routes /agents] prompt_builtins table returned 0 rows. "
                "Possible causes: RLS policy blocking anon reads, table is empty, "
                "or RLS requires is_active=true filter."
            )

        builtins = sorted(
            [
                _shape_agent(b, "builtin")
                for b in builtins_raw
                if b.get("is_active", True)
            ],
            key=lambda x: x["name"],
        )
        user_agents = sorted(
            [_shape_agent(p, "user") for p in prompts_raw],
            key=lambda x: x["name"],
        )

        logger.info(
            "[chat_routes /agents] Returning %d builtins, %d user agents source=postgrest",
            len(builtins),
            len(user_agents),
        )
        return {
            "builtins": builtins,
            "user": user_agents,
            "shared": [],
            "source": "postgrest",
            "totals": {
                "builtins": len(builtins),
                "user": len(user_agents),
                "shared": 0,
                "total": len(builtins) + len(user_agents),
            },
        }

    except Exception:
        logger.error(
            "[chat_routes /agents] PostgREST fetch FAILED. "
            "Check that SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are correct, "
            "that prompt_builtins and prompts tables exist, "
            "and that RLS allows anon reads on prompt_builtins.",
            exc_info=True,
        )
        return {"builtins": [], "user": [], "shared": [], "source": "error"}


async def _list_agents_server() -> dict[str, Any]:
    """Fetch agents via asyncpg ORM managers (server mode)."""
    logger.info("[chat_routes /agents] Using asyncpg ORM path (server mode)")
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

        logger.info(
            "[chat_routes /agents] ORM returned %d builtins, %d user prompts",
            len(builtins_raw),
            len(prompts_raw),
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
            "shared": [],
            "source": "database",
            "totals": {
                "builtins": len(builtins),
                "user": len(user_agents),
                "shared": 0,
                "total": len(builtins) + len(user_agents),
            },
        }

    except Exception:
        logger.error("[chat_routes /agents] ORM fetch FAILED", exc_info=True)
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
        expose_headers=["X-Conversation-ID", "X-Request-ID"],
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
