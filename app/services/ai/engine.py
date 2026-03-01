"""matrx-ai engine lifecycle management.

Handles one-time initialization of the matrx_ai library (DB registration,
env loading) at startup. Gracefully degrades if DB credentials are absent —
AI calls still work, conversation persistence is skipped.
"""

from __future__ import annotations

import os

from app.common.system_logger import get_logger

logger = get_logger()

_ai_initialized = False


def initialize_matrx_ai() -> None:
    """Initialize the matrx_ai library once at startup.

    Reads DB credentials from env. If SUPABASE_MATRIX_HOST is not set,
    skips DB registration — AI provider calls still work, but conversations
    won't be persisted to the cloud database.
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


def is_initialized() -> bool:
    return _ai_initialized
