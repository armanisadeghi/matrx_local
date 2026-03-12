"""matrx-ai engine lifecycle management.

Handles one-time initialization of the matrx_ai library (DB registration,
env loading) at startup, then registers all local OS tools into matrx-ai's
ToolRegistry so AI models can invoke them.

Initialization sequence
-----------------------
  1. ``initialize_matrx_ai()`` — sync phase: loads env, registers DB if configured.
  2. ``load_tools_and_register()`` — async phase:
       a. Loads the matrx-ai tool registry from the DB (cloud tools).
       b. Registers all local OS tools via ``LocalToolBridge``.
       c. Starts the tool executor and lifecycle sweep.

Graceful degradation
--------------------
  - MATRX_AI_CLIENT_MODE=true → client mode: uses Supabase PostgREST + RLS.
    No DB credentials on the machine. Conversations not persisted server-side.
  - No ``SUPABASE_MATRIX_HOST`` → AI calls work, conversations not persisted to DB.
  - Local tool registration failures are logged but don't block startup.
  - Tool executor and lifecycle manager start regardless of DB availability.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

from app.common.system_logger import get_logger

load_dotenv()

logger = get_logger()

_ai_initialized = False
_tools_loaded = False
_db_registered = False   # True only when asyncpg connection was successfully registered
_client_mode_active = False  # True when MATRX_AI_CLIENT_MODE=true


def initialize_matrx_ai() -> None:
    """Initialize the matrx_ai library once at startup (synchronous phase).

    Three mutually exclusive paths, checked in order:

    1. MATRX_AI_CLIENT_MODE=true — client mode (PostgREST + RLS).
       Uses SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY. No asyncpg connection.
       Conversation persistence is skipped; RLS enforces per-user data isolation.

    2. SUPABASE_MATRIX_HOST is set — server mode with direct asyncpg connection.
       Full conversation persistence via the cx_ tables.

    3. Neither set — AI calls work, but nothing is persisted.

    Call this from the FastAPI lifespan handler BEFORE the async phase.
    """
    global _ai_initialized, _db_registered, _client_mode_active
    if _ai_initialized:
        return

    import matrx_ai

    client_mode = os.getenv("MATRX_AI_CLIENT_MODE", "false").strip().lower() in ("1", "true", "yes")

    if client_mode:
        supabase_url = os.getenv("SUPABASE_URL", "").strip()
        supabase_anon_key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
        logger.info(
            "[engine] matrx-ai: client mode — using Supabase PostgREST + RLS. url=%s",
            supabase_url,
        )
        try:
            matrx_ai.initialize(
                client_mode=True,
                supabase_url=supabase_url,
                supabase_anon_key=supabase_anon_key,
            )
            _client_mode_active = True
            logger.info("[engine] matrx-ai: initialized in client mode ✓")
        except Exception:
            logger.error(
                "[engine] matrx-ai: client mode initialization FAILED — "
                "check SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env",
                exc_info=True,
            )
            matrx_ai._initialized = True

    else:
        db_host = os.getenv("SUPABASE_MATRIX_HOST", "").strip()

        if db_host:
            logger.info(
                "[engine] matrx-ai: connecting to DB — host=%s port=%s db=%s user=%s",
                db_host,
                os.getenv("SUPABASE_MATRIX_PORT", "6543"),
                os.getenv("SUPABASE_MATRIX_DATABASE_NAME", "postgres"),
                os.getenv("SUPABASE_MATRIX_USER", "(not set)"),
            )
            try:
                matrx_ai.initialize(
                    db_name="supabase_automation_matrix",
                    db_env_prefix="SUPABASE_MATRIX",
                    db_additional_schemas=["auth"],
                    db_env_var_overrides={"NAME": "SUPABASE_MATRIX_DATABASE_NAME"},
                )
                _db_registered = True
                logger.info("[engine] matrx-ai: initialized with database persistence ✓")
            except Exception:
                logger.warning(
                    "[engine] matrx-ai: DB initialization FAILED — "
                    "AI calls will work but conversations won't be persisted. "
                    "Attempted: host=%s port=%s. Check SUPABASE_MATRIX_* vars in .env",
                    db_host,
                    os.getenv("SUPABASE_MATRIX_PORT", "6543"),
                    exc_info=True,
                )
                # Even if DB setup fails, mark matrx_ai as initialized so the tool
                # registry load proceeds. AI provider calls work without a DB connection.
                matrx_ai._initialized = True
        else:
            logger.warning(
                "[engine] matrx-ai: neither MATRX_AI_CLIENT_MODE nor SUPABASE_MATRIX_HOST "
                "is set — running WITHOUT cloud database. "
                "AI model/agent data will not sync from Supabase. "
                "Set MATRX_AI_CLIENT_MODE=true (desktop) or SUPABASE_MATRIX_HOST (server) "
                "in .env to enable conversation history, model sync, and agent sync."
            )
            # Initialize without DB so matrx_ai._initialized is True and tool registry loads.
            matrx_ai._initialized = True

    _ai_initialized = True


def has_db() -> bool:
    """Return True if the asyncpg DB config was successfully registered.

    Use this to guard any code that issues direct ORM queries — if False, those
    queries will raise DatabaseConfigError and generate noisy tracebacks.
    In client mode this returns False; use is_client_mode() to check instead.
    """
    return _db_registered


def is_client_mode() -> bool:
    """Return True if matrx-ai was initialized in client (PostgREST + RLS) mode."""
    return _client_mode_active


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
