"""matrx-ai engine lifecycle management.

Handles one-time initialization of the matrx_ai library (DB registration,
env loading) at startup, then registers all local OS tools into matrx-ai's
ToolRegistry so AI models can invoke them.

Initialization sequence
-----------------------
  1. ``initialize_matrx_ai()`` — sync phase: sets up Supabase client mode.
  2. ``load_tools_and_register()`` — async phase:
       a. Loads the matrx-ai tool registry from the DB (cloud tools).
       b. Registers all local OS tools via ``LocalToolBridge``.
       c. Starts the tool executor and lifecycle sweep.

matrx-local ALWAYS runs in client mode
---------------------------------------
  - Uses Supabase PostgREST API (anon key + user JWT + RLS).
  - No direct DB credentials are stored on the user's machine.
  - Conversation persistence is skipped server-side — RLS enforces per-user isolation.
  - AI provider calls (OpenAI, Anthropic, etc.) work in full.
  - Local tool registration failures are logged but don't block startup.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

from app.common.system_logger import get_logger

load_dotenv()

logger = get_logger()

_ai_initialized = False
_tools_loaded = False
_client_mode_active = False


def initialize_matrx_ai() -> None:
    """Initialize the matrx_ai library once at startup (synchronous phase).

    matrx-local always uses client mode: Supabase PostgREST + RLS.
    Reads SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY from .env.

    Call this from the FastAPI lifespan handler BEFORE the async phase.
    """
    global _ai_initialized, _client_mode_active
    if _ai_initialized:
        logger.debug("[engine] initialize_matrx_ai() called again — already initialized, skipping")
        return

    import matrx_ai

    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_anon_key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()

    logger.info("=" * 60)
    logger.info("[engine] matrx-ai STARTUP — client mode (PostgREST + RLS)")
    logger.info("[engine]   SUPABASE_URL          = %s", supabase_url or "(NOT SET)")
    logger.info("[engine]   SUPABASE_PUBLISHABLE_KEY = %s", "SET ✓" if supabase_anon_key else "(NOT SET ✗)")
    logger.info("=" * 60)

    if not supabase_url:
        logger.error(
            "[engine] SUPABASE_URL is not set — models and agents will NOT load. "
            "Add SUPABASE_URL to .env"
        )
    if not supabase_anon_key:
        logger.error(
            "[engine] SUPABASE_PUBLISHABLE_KEY is not set — models and agents will NOT load. "
            "Add SUPABASE_PUBLISHABLE_KEY to .env"
        )

    try:
        matrx_ai.initialize(
            client_mode=True,
            supabase_url=supabase_url,
            supabase_anon_key=supabase_anon_key,
        )
        _client_mode_active = True
        logger.info(
            "[engine] matrx-ai: initialized in client mode ✓ "
            "(models and agents will be fetched via PostgREST on first request)"
        )
    except Exception:
        logger.error(
            "[engine] matrx-ai: client mode initialization FAILED — "
            "SUPABASE_URL=%r  key_set=%s",
            supabase_url,
            bool(supabase_anon_key),
            exc_info=True,
        )
        # Mark initialized anyway so the tool registry load proceeds.
        # AI provider calls still work; DB-backed features (models, agents) unavailable.
        matrx_ai._initialized = True

    _ai_initialized = True


def is_client_mode() -> bool:
    """Return True if matrx-ai was successfully initialized in client (PostgREST + RLS) mode."""
    return _client_mode_active


def has_db() -> bool:
    """Always returns False for matrx-local.

    matrx-local never opens an asyncpg connection to the database. All
    data access goes through the Supabase PostgREST API (client mode).
    Code that guards on has_db() will skip gracefully without error.
    """
    return False


async def load_tools_and_register() -> None:
    """Async startup phase: load tool registry from DB, register local tools, start executor.

    Call this from the FastAPI lifespan handler AFTER ``initialize_matrx_ai()``.
    Safe to call multiple times (idempotent after first call).
    """
    global _tools_loaded
    if _tools_loaded:
        return

    import matrx_ai

    if not matrx_ai._initialized:
        logger.warning(
            "[engine] matrx-ai not initialized — skipping tool registry load. "
            "Call initialize_matrx_ai() first."
        )
        return

    # --- Phase A: load DB tools into matrx-ai registry ---
    try:
        from matrx_ai.tools.handle_tool_calls import initialize_tool_system
        count = await initialize_tool_system()
        logger.info("[engine] matrx-ai: loaded %d tools from DB into registry ✓", count)
    except Exception:
        logger.warning(
            "[engine] matrx-ai: FAILED to load tool registry from DB — "
            "AI agents won't have access to cloud-registered tools",
            exc_info=True,
        )

    # --- Phase B: register all local OS tools via the ExternalToolAdapter bridge ---
    try:
        from app.services.ai.local_tool_bridge import register_local_tools
        n = register_local_tools()
        logger.info("[engine] matrx-ai: registered %d local OS tools ✓", n)
    except Exception:
        logger.error(
            "[engine] matrx-ai: local tool registration FAILED — "
            "AI won't have access to OS tools",
            exc_info=True,
        )

    _tools_loaded = True


def is_initialized() -> bool:
    return _ai_initialized


def tools_loaded() -> bool:
    return _tools_loaded
