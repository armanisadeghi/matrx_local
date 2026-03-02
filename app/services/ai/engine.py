"""matrx-ai engine lifecycle management.

Handles one-time initialization of the matrx_ai library (DB registration,
env loading) at startup, then registers all local OS tools into matrx-ai's
ToolRegistry so AI models can invoke them.

Initialization sequence:
  1. matrx_ai.initialize() — loads env, registers DB (if configured)
  2. Load matrx-ai's tool registry from DB (async, runs in lifespan)
  3. register_local_tools() — register matrx-local's tools into the same registry

Graceful degradation:
  - No SUPABASE_MATRIX_HOST → AI calls work, conversations not persisted
  - Local tool registration failures are logged but don't block startup
"""

from __future__ import annotations

import os

from app.common.system_logger import get_logger

logger = get_logger()

_ai_initialized = False
_tools_loaded = False


def initialize_matrx_ai() -> None:
    """Initialize the matrx_ai library once at startup (synchronous phase).

    Reads DB credentials from env. If SUPABASE_MATRIX_HOST is not set,
    skips DB registration — AI provider calls still work, but conversations
    won't be persisted to the cloud database.

    Call this from the FastAPI lifespan handler BEFORE the async phase.
    """
    global _ai_initialized
    if _ai_initialized:
        return

    import matrx_ai

    db_host = os.getenv("SUPABASE_MATRIX_HOST", "").strip()

    if db_host:
        try:
            matrx_ai.initialize(
                db_name="supabase_automation_matrix",
                db_env_prefix="SUPABASE_MATRIX",
                db_additional_schemas=["auth"],
                db_env_var_overrides={"NAME": "SUPABASE_MATRIX_DATABASE_NAME"},
            )
            logger.info("matrx-ai: initialized with database persistence")
        except Exception:
            logger.warning(
                "matrx-ai: DB initialization failed — AI calls will work but "
                "conversations won't be persisted",
                exc_info=True,
            )
    else:
        logger.info(
            "matrx-ai: SUPABASE_MATRIX_HOST not set — running without DB persistence. "
            "Set it in .env to enable conversation history."
        )

    _ai_initialized = True


async def load_tools_and_register() -> None:
    """Async startup phase: load tool registry from DB, then register local tools.

    Call this from the FastAPI lifespan handler AFTER initialize_matrx_ai().
    Safe to call multiple times (idempotent after first call).
    """
    global _tools_loaded
    if _tools_loaded:
        return

    import matrx_ai

    if not matrx_ai._initialized:
        logger.warning(
            "matrx-ai not initialized — skipping tool registry load. "
            "Call initialize_matrx_ai() first."
        )
        return

    # --- Phase A: load DB tools into matrx-ai registry ---
    try:
        from matrx_ai.tools.registry import ToolRegistryV2
        registry = ToolRegistryV2.get_instance()
        if not registry.loaded:
            count = await registry.load_from_database()
            logger.info("matrx-ai: loaded %d tools from DB into registry", count)
        else:
            logger.debug("matrx-ai: tool registry already loaded")
    except Exception:
        logger.warning("matrx-ai: failed to load tool registry from DB", exc_info=True)

    # --- Phase B: register local OS tools into the same registry ---
    try:
        from app.services.ai.local_tool_bridge import register_local_tools
        from matrx_ai.tools.registry import ToolRegistryV2
        registry = ToolRegistryV2.get_instance()
        n = register_local_tools(registry)
        logger.info("matrx-ai: registered %d local OS tools into registry", n)
    except Exception:
        logger.error(
            "matrx-ai: local tool registration failed — AI won't have OS tool access",
            exc_info=True,
        )

    _tools_loaded = True


def is_initialized() -> bool:
    return _ai_initialized


def tools_loaded() -> bool:
    return _tools_loaded
