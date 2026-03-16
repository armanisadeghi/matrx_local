"""Chat API routes — tool schemas, models, agents, + AI streaming completions.

Provides:
  GET  /chat/tools                   — all tool schemas (Anthropic-compatible)
  GET  /chat/tools/by-category       — tool schemas grouped by category
  GET  /chat/tools/anthropic         — Anthropic Messages API format
  GET  /chat/models                  — AI models from local SQLite cache
  GET  /chat/agents                  — agents/prompts from local SQLite cache
  GET  /chat/local-tools             — local OS tools registered in matrx-ai registry

  POST /chat/ai/chat                 — streaming chat completions (matrx-ai)
  POST /chat/ai/agents/{agent_id}    — start agent conversation (matrx-ai)
  POST /chat/ai/conversations/{id}   — continue conversation (matrx-ai)
  POST /chat/ai/cancel/{request_id}  — cancel in-flight request (matrx-ai)

Data access strategy
--------------------
SQLite is the single source of truth.  All reads here go through SQLite
repositories.  The SyncEngine populates SQLite in the background by calling
the AIDream server API.

If SQLite is empty and a sync has never completed, we trigger a background
sync and return an empty list with syncing=True so the UI can show a spinner.
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
# Models endpoint — reads from SQLite (populated by SyncEngine)
# ---------------------------------------------------------------------------


@router.get("/models")
async def list_models() -> dict[str, Any]:
    """Return all active AI models from local SQLite cache.

    SQLite is populated by SyncEngine on startup and every 10 minutes.
    If the cache is empty and has never synced, triggers a background sync
    and returns syncing=True so the UI can show a loading state.
    """
    from app.services.local_db.repositories import ModelsRepo, SyncMetaRepo
    from app.services.local_db.sync_engine import get_sync_engine

    logger.info("[chat_routes /models] Request received")

    repo = ModelsRepo()
    models = await repo.list_all(include_deprecated=False)

    if not models:
        sync_meta = SyncMetaRepo()
        meta = await sync_meta.get_last_sync("models")
        never_synced = meta is None or meta.get("last_synced_at") is None

        if never_synced:
            logger.info(
                "[chat_routes /models] SQLite empty and never synced — triggering background sync"
            )
            engine = get_sync_engine()
            asyncio.create_task(engine.sync_models())
            return {"models": [], "total": 0, "source": "sqlite", "syncing": True}

        logger.info("[chat_routes /models] SQLite is empty (sync ran but found no models)")
        return {"models": [], "total": 0, "source": "sqlite", "syncing": False}

    logger.info("[chat_routes /models] Returning %d models from SQLite", len(models))
    return {"models": models, "total": len(models), "source": "sqlite", "syncing": False}


# ---------------------------------------------------------------------------
# Agents endpoint — reads from SQLite (populated by SyncEngine)
# ---------------------------------------------------------------------------


def _shape_agent_from_sqlite(row: dict[str, Any]) -> dict[str, Any]:
    """Normalize a SQLite agents row into the API response shape."""
    import json as _json
    settings: dict[str, Any] = row.get("settings") or {}
    if isinstance(settings, str):
        try:
            settings = _json.loads(settings)
        except Exception:
            settings = {}
    variable_defaults = row.get("variable_defaults") or []
    if isinstance(variable_defaults, str):
        try:
            variable_defaults = _json.loads(variable_defaults)
        except Exception:
            variable_defaults = []
    tags = row.get("tags") or []
    if isinstance(tags, str):
        try:
            tags = _json.loads(tags)
        except Exception:
            tags = []
    return {
        "id": row.get("id", ""),
        "name": row.get("name", ""),
        "description": row.get("description") or "",
        "source": row.get("source", "builtin"),
        "variable_defaults": variable_defaults,
        "category": row.get("category") or None,
        "tags": tags,
        "is_favorite": bool(row.get("is_favorite", False)),
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
    """Return all agents from local SQLite cache.

    Sources:
      - builtins: prompt_builtins table (system agents, always available)
      - user: prompts table (user's own agents, populated when JWT is available)
      - shared: not yet supported

    SQLite is populated by SyncEngine. If empty and never synced, triggers
    a background sync and returns syncing=True.
    """
    from app.services.local_db.repositories import AgentsRepo, SyncMetaRepo
    from app.services.local_db.sync_engine import get_sync_engine

    logger.info("[chat_routes /agents] Request received")

    repo = AgentsRepo()
    all_agents = await repo.list_all()

    builtins = [_shape_agent_from_sqlite(a) for a in all_agents if a.get("source") == "builtin"]
    user_agents = [_shape_agent_from_sqlite(a) for a in all_agents if a.get("source") == "user"]

    if not builtins:
        sync_meta = SyncMetaRepo()
        meta = await sync_meta.get_last_sync("agents")
        never_synced = meta is None or meta.get("last_synced_at") is None

        if never_synced:
            logger.info(
                "[chat_routes /agents] SQLite empty and never synced — triggering background sync"
            )
            engine = get_sync_engine()
            asyncio.create_task(engine.sync_agents())
            return {
                "builtins": [], "user": [], "shared": [],
                "source": "sqlite", "syncing": True,
                "totals": {"builtins": 0, "user": 0, "shared": 0, "total": 0},
            }

    total = len(builtins) + len(user_agents)
    logger.info(
        "[chat_routes /agents] Returning %d builtins, %d user agents from SQLite",
        len(builtins),
        len(user_agents),
    )
    return {
        "builtins": sorted(builtins, key=lambda x: x["name"]),
        "user": sorted(user_agents, key=lambda x: x["name"]),
        "shared": [],
        "source": "sqlite",
        "syncing": False,
        "totals": {
            "builtins": len(builtins),
            "user": len(user_agents),
            "shared": 0,
            "total": total,
        },
    }


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
