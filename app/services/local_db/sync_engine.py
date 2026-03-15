"""Background sync engine — pulls cloud data into local SQLite.

Runs as a background task during the engine lifecycle:
  1. On startup: full sync of models, agents, tools
  2. Periodic: re-syncs every N minutes
  3. On demand: triggered by API call or WebSocket event

All reads come from SQLite.  This engine only *writes* to SQLite after
fetching from Supabase/matrx-ai.  The app works fully offline — sync
failures are logged and retried on the next cycle.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from typing import Any, Optional

from app.common.system_logger import get_logger
from app.services.local_db.database import get_db
from app.services.ai.engine import has_db
from app.services.local_db.repositories import (
    ModelsRepo,
    AgentsRepo,
    ToolsRepo,
    SyncMetaRepo,
)

logger = get_logger()

_instance: Optional["SyncEngine"] = None

# Default sync interval: 10 minutes
DEFAULT_SYNC_INTERVAL = 600


class SyncEngine:
    """Pulls cloud data into the local SQLite database."""

    def __init__(self) -> None:
        self._task: Optional[asyncio.Task] = None
        self._interval = DEFAULT_SYNC_INTERVAL
        self._running = False
        self._models_repo = ModelsRepo()
        self._agents_repo = AgentsRepo()
        self._tools_repo = ToolsRepo()
        self._sync_meta = SyncMetaRepo()

    @property
    def running(self) -> bool:
        return self._running

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self, interval: int | None = None) -> None:
        """Start the background sync loop."""
        if self._task and not self._task.done():
            return
        if interval:
            self._interval = interval
        self._running = True
        self._task = asyncio.create_task(self._sync_loop())
        self._task.add_done_callback(lambda _: None)
        logger.info("[sync_engine] Background sync started (interval=%ds)", self._interval)

    def stop(self) -> None:
        """Cancel the background sync loop."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
        logger.info("[sync_engine] Background sync stopped")

    async def _sync_loop(self) -> None:
        """Run a full sync on startup, then periodically."""
        # Initial sync immediately
        await self.sync_all()

        while self._running:
            await asyncio.sleep(self._interval)
            if not self._running:
                break
            await self.sync_all()

    # ------------------------------------------------------------------
    # Full sync
    # ------------------------------------------------------------------

    async def sync_all(self) -> dict[str, str]:
        """Run all sync tasks.  Returns status per entity type."""
        results: dict[str, str] = {}

        for name, fn in [
            ("models", self.sync_models),
            ("agents", self.sync_agents),
            ("tools", self.sync_tools),
        ]:
            try:
                await fn()
                results[name] = "success"
            except Exception:
                results[name] = "error"
                logger.warning("[sync_engine] %s sync failed", name, exc_info=True)

        return results

    # ------------------------------------------------------------------
    # Models sync
    # ------------------------------------------------------------------

    async def sync_models(self) -> None:
        """Pull AI models from Supabase via matrx-ai and cache locally."""
        try:
            import matrx_ai as _matrx_ai
        except ImportError:
            logger.debug("[sync_engine] matrx_ai not available — skipping model sync")
            return

        if not _matrx_ai._initialized:
            logger.debug("[sync_engine] matrx_ai not initialized — skipping model sync")
            await self._sync_meta.set_last_sync(
                "models", status="skipped", error_message="matrx_ai not initialized"
            )
            return

        if not has_db():
            logger.debug(
                "[sync_engine] Skipping model sync — matrx-local runs in client mode "
                "(no direct DB connection). Models are loaded via Supabase PostgREST."
            )
            await self._sync_meta.set_last_sync(
                "models", status="skipped", error_message="client mode — no direct DB connection"
            )
            return

        try:
            from matrx_ai.db.custom.ai_models.ai_model_manager import ai_model_manager_instance

            mgr = ai_model_manager_instance
            all_models = await mgr.load_all_models()

            # Map endpoint → provider (same logic as chat_routes.py)
            endpoint_map = {
                "anthropic_chat": "anthropic",
                "anthropic_adaptive": "anthropic",
                "openai_chat": "openai",
                "google_chat": "google",
                "groq_chat": "groq",
                "together_chat": "together",
                "xai_chat": "xai",
                "cerebras_chat": "cerebras",
            }

            models_to_save = []
            for m in all_models:
                d = m.to_dict()
                endpoints = d.get("endpoints") or []
                provider = None
                for ep in endpoints:
                    p = endpoint_map.get(ep)
                    if p:
                        provider = p
                        break
                if not provider:
                    continue

                models_to_save.append({
                    "id": d["id"],
                    "name": d["name"],
                    "common_name": d.get("common_name", ""),
                    "provider": provider,
                    "endpoints": endpoints,
                    "capabilities": d.get("capabilities") or [],
                    "context_window": d.get("context_window"),
                    "max_tokens": d.get("max_tokens"),
                    "is_primary": d.get("is_primary", False),
                    "is_premium": d.get("is_premium", False),
                    "is_deprecated": d.get("is_deprecated", False),
                })

            await self._models_repo.upsert_many(models_to_save)

            # Remove models that no longer exist in cloud
            keep_ids = {m["id"] for m in models_to_save}
            removed = await self._models_repo.delete_missing(keep_ids)

            data_hash = _hash_list(models_to_save)
            await self._sync_meta.set_last_sync("models", last_hash=data_hash)

            count = await self._models_repo.count()
            logger.info(
                "[sync_engine] Models synced: %d cached, %d removed", count, removed
            )

        except Exception:
            await self._sync_meta.set_last_sync(
                "models", status="error", error_message="sync failed"
            )
            raise

    # ------------------------------------------------------------------
    # Agents sync
    # ------------------------------------------------------------------

    async def sync_agents(self) -> None:
        """Pull agents/prompts from Supabase via matrx-ai and cache locally."""
        try:
            import matrx_ai as _matrx_ai
        except ImportError:
            logger.debug("[sync_engine] matrx_ai not available — skipping agent sync")
            return

        if not _matrx_ai._initialized:
            logger.debug("[sync_engine] matrx_ai not initialized — skipping agent sync")
            await self._sync_meta.set_last_sync(
                "agents", status="skipped", error_message="matrx_ai not initialized"
            )
            return

        if not has_db():
            logger.debug(
                "[sync_engine] Skipping agent sync — matrx-local runs in client mode "
                "(no direct DB connection). Agents are loaded via Supabase PostgREST."
            )
            await self._sync_meta.set_last_sync(
                "agents", status="skipped", error_message="client mode — no direct DB connection"
            )
            return

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

            # Process builtins
            builtin_agents = []
            for b in builtins_raw:
                d = b.to_dict()
                if not d.get("is_active", True):
                    continue
                settings = d.get("settings") or {}
                builtin_agents.append({
                    "id": d.get("id", ""),
                    "name": d.get("name", ""),
                    "description": d.get("description", ""),
                    "source": "builtin",
                    "variable_defaults": d.get("variable_defaults") or [],
                    "settings": {
                        "model_id": settings.get("model_id"),
                        "temperature": settings.get("temperature"),
                        "max_tokens": settings.get("max_tokens") or settings.get("max_output_tokens"),
                        "stream": settings.get("stream", True),
                        "tools": settings.get("tools") or [],
                    },
                    "is_active": True,
                })

            # Process user prompts
            user_agents = []
            for p in prompts_raw:
                d = p.to_dict()
                settings = d.get("settings") or {}
                user_agents.append({
                    "id": d.get("id", ""),
                    "name": d.get("name", ""),
                    "description": d.get("description", ""),
                    "source": "user",
                    "variable_defaults": d.get("variable_defaults") or [],
                    "settings": {
                        "model_id": settings.get("model_id"),
                        "temperature": settings.get("temperature"),
                        "max_tokens": settings.get("max_tokens") or settings.get("max_output_tokens"),
                        "stream": settings.get("stream", True),
                        "tools": settings.get("tools") or [],
                    },
                    "is_active": True,
                })

            await self._agents_repo.upsert_many(builtin_agents)
            await self._agents_repo.upsert_many(user_agents)

            # Clean up removed agents per source
            builtin_ids = {a["id"] for a in builtin_agents}
            user_ids = {a["id"] for a in user_agents}
            await self._agents_repo.delete_by_source("builtin", builtin_ids)
            await self._agents_repo.delete_by_source("user", user_ids)

            data_hash = _hash_list(builtin_agents + user_agents)
            await self._sync_meta.set_last_sync("agents", last_hash=data_hash)

            logger.info(
                "[sync_engine] Agents synced: %d builtins, %d user",
                len(builtin_agents),
                len(user_agents),
            )

        except Exception:
            await self._sync_meta.set_last_sync(
                "agents", status="error", error_message="sync failed"
            )
            raise

    # ------------------------------------------------------------------
    # Tools sync
    # ------------------------------------------------------------------

    async def sync_tools(self) -> None:
        """Cache the local tool manifest into SQLite for fast access."""
        try:
            from app.tools.local_tool_manifest import LOCAL_TOOL_MANIFEST

            tools_to_save = []
            for entry in LOCAL_TOOL_MANIFEST:
                tools_to_save.append({
                    "id": entry.name,
                    "name": entry.name,
                    "description": entry.description,
                    "category": entry.category,
                    "tags": entry.tags,
                    "parameters": entry.parameters,
                    "source": "local",
                    "version": str(entry.version),
                })

            await self._tools_repo.upsert_many(tools_to_save)

            data_hash = _hash_list(tools_to_save)
            await self._sync_meta.set_last_sync("tools", last_hash=data_hash)

            count = await self._tools_repo.count()
            logger.info("[sync_engine] Tools synced: %d cached", count)

        except Exception:
            await self._sync_meta.set_last_sync(
                "tools", status="error", error_message="sync failed"
            )
            raise

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    async def get_status(self) -> dict[str, Any]:
        """Return sync status for all entity types."""
        all_meta = await self._sync_meta.get_all_sync_status()
        pending = await self._sync_meta.pending_count()
        return {
            "running": self._running,
            "interval_seconds": self._interval,
            "entities": {m["entity_type"]: m for m in all_meta},
            "pending_queue": pending,
        }


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _hash_list(items: list[dict]) -> str:
    raw = json.dumps(items, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def get_sync_engine() -> SyncEngine:
    global _instance
    if _instance is None:
        _instance = SyncEngine()
    return _instance
