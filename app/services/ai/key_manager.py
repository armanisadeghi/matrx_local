"""User API key manager — loads stored provider keys into os.environ at runtime.

Why os.environ?
---------------
matrx_ai constructs a fresh UnifiedAIClient() on every AI request. Each
provider's __init__ reads its key via os.environ.get("PROVIDER_API_KEY"),
so mutating os.environ before a request is sufficient for the new key to be
picked up — no restart required.

Precedence (highest → lowest):
  1. User-stored key in SQLite (set via PUT /settings/api-keys/{provider})
  2. .env / shell environment (Arman's dev keys, or future CI injection)

On first startup, load_user_keys_into_env() is called from the lifespan
handler so any previously stored keys are active immediately.

When a user saves a new key via set_user_key(), the env var is updated in
the same call — the very next AI request will use it.
"""

from __future__ import annotations

import os

from app.common.system_logger import get_logger

logger = get_logger()

# Maps provider name → list of env var names that matrx_ai providers read.
# google needs both because google_api.py reads GEMINI_API_KEY while the
# pydantic Settings reads GOOGLE_API_KEY (used for status checks).
PROVIDER_ENV_MAP: dict[str, list[str]] = {
    "openai":    ["OPENAI_API_KEY"],
    "anthropic": ["ANTHROPIC_API_KEY"],
    "google":    ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    "groq":      ["GROQ_API_KEY"],
    "together":  ["TOGETHER_API_KEY"],
    "xai":       ["XAI_API_KEY"],
    "cerebras":  ["CEREBRAS_API_KEY"],
    # Hugging Face Hub (local GGUF downloads via desktop + any Python hub usage)
    "huggingface": ["HUGGING_FACE_HUB_TOKEN", "HF_TOKEN"],
}


def _inject(provider: str, key: str) -> None:
    """Write all env var names for this provider with the given key."""
    for env_var in PROVIDER_ENV_MAP.get(provider, []):
        os.environ[env_var] = key
    logger.debug("[key_manager] Injected key for provider '%s' into os.environ", provider)


def _erase(provider: str) -> None:
    """Remove all env var names for this provider from os.environ."""
    for env_var in PROVIDER_ENV_MAP.get(provider, []):
        os.environ.pop(env_var, None)
    logger.debug("[key_manager] Removed env vars for provider '%s'", provider)


async def load_user_keys_into_env() -> int:
    """Load all user-stored API keys from SQLite into os.environ.

    Called once during the async startup phase.  Returns the number of
    providers whose keys were injected.

    User-stored keys take precedence over .env / shell environment.
    """
    try:
        from app.services.local_db.repositories import ApiKeysRepo
        repo = ApiKeysRepo()
        keys = await repo.get_all()
    except Exception as exc:
        logger.warning("[key_manager] Could not load user API keys from SQLite: %s", exc)
        return 0

    count = 0
    for provider, key in keys.items():
        if key and key.strip():
            _inject(provider, key.strip())
            count += 1

    if count:
        logger.info("[key_manager] Loaded %d user-stored API key(s) into os.environ ✓", count)
    else:
        logger.debug("[key_manager] No user-stored API keys found in SQLite")

    return count


async def set_user_key(provider: str, key: str) -> None:
    """Save a new key for one provider to SQLite and inject it into os.environ immediately.

    The next AI request will use the new key without any restart.
    """
    from app.services.local_db.repositories import ApiKeysRepo
    repo = ApiKeysRepo()
    await repo.set(provider, key.strip())
    _inject(provider, key.strip())
    logger.info("[key_manager] User key saved and injected for provider '%s'", provider)


async def delete_user_key(provider: str) -> None:
    """Remove a stored key from SQLite and clear injected env vars for that provider.

    Clears the same names `_inject` sets (e.g. HF_TOKEN) so image-gen and hub
    downloads stop using a removed Hugging Face token without requiring a full
    process restart. If you rely on a key only in shell/.env and never saved it
    in the app, deleting in UI does not remove .env — restart would reload it.
    """
    from app.services.local_db.repositories import ApiKeysRepo
    repo = ApiKeysRepo()
    await repo.delete(provider)
    _erase(provider)
    logger.info("[key_manager] User key deleted and env cleared for provider '%s'", provider)
