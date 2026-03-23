"""Local LLM registry — bridges the running llama-server with the matrx-ai agent pipeline.

When the Tauri frontend starts a local llama-server it notifies the Python engine via
POST /chat/local-llm/connect with the port and model name.  This module:

  1. Stores the port and model name in module-level state.
  2. Creates a GenericOpenAIChat instance pointed at http://127.0.0.1:{port}/v1.
  3. Registers that instance with matrx-ai's UnifiedAIClient so requests whose
     model resolves to api_class="generic_openai_standard" are routed locally.
  4. Injects a synthetic model entry into AiModelManager._api_cache so that
     "local/<model_name>" is resolvable by name without a DB lookup.

Graceful degradation
--------------------
If the installed matrx-ai package does not yet include GenericOpenAIChat (< 0.1.23),
every public function is a no-op and a single error is logged pointing to the
instructions file.  The rest of the engine continues to work normally.

Instructions for matrx-ai developers:
  docs/matrx-ai-generic-openai-port.md
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Instructions path shown in error messages when matrx-ai is not updated.
_INSTRUCTIONS_PATH = "docs/matrx-ai-generic-openai-port.md"

# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_local_llm_port: int | None = None
_local_llm_model: str | None = None
_matrx_ai_support: bool | None = None  # None = not yet checked


# ---------------------------------------------------------------------------
# matrx-ai support probe
# ---------------------------------------------------------------------------

def _check_matrx_ai_support() -> bool:
    """Return True if the installed matrx-ai has GenericOpenAIChat.

    Result is cached after the first call.  Logs a clear error on first failure
    pointing developers to the instructions file.
    """
    global _matrx_ai_support
    if _matrx_ai_support is not None:
        return _matrx_ai_support

    try:
        from matrx_ai.providers.generic_openai import GenericOpenAIChat  # noqa: F401
        _matrx_ai_support = True
        logger.info(
            "[local_llm_registry] matrx-ai GenericOpenAIChat support: AVAILABLE ✓"
        )
    except ImportError:
        _matrx_ai_support = False
        logger.error(
            "[local_llm_registry] matrx-ai does NOT include GenericOpenAIChat. "
            "Local LLM routing is DISABLED until matrx-ai is updated to >= 0.1.23. "
            "Developer instructions: %s",
            _INSTRUCTIONS_PATH,
        )

    return _matrx_ai_support


# ---------------------------------------------------------------------------
# Model name helper
# ---------------------------------------------------------------------------

def _local_model_name(model_name: str) -> str:
    """Return the canonical local model name used as the lookup key."""
    if model_name.startswith("local/"):
        return model_name
    return f"local/{model_name}"


# ---------------------------------------------------------------------------
# AiModelManager cache injection
# ---------------------------------------------------------------------------

def _inject_model_into_cache(model_name: str) -> None:
    """Append a synthetic model entry to AiModelManager._api_cache.

    Safe to call even if the cache is None (injection is skipped with a warning).
    The synthetic entry uses api_class="generic_openai_standard" so UnifiedAIClient
    routes it to the GenericOpenAIChat dispatch branch.
    """
    try:
        from matrx_ai.db.custom.ai_models.ai_model_manager import AiModelManager

        if AiModelManager._api_cache is None:
            logger.warning(
                "[local_llm_registry] AiModelManager._api_cache not yet populated — "
                "skipping model injection for '%s'. It will be injected on next connect call "
                "once the cache has been warmed.",
                model_name,
            )
            return

        canonical = _local_model_name(model_name)

        # Remove any stale entry for the same name first.
        AiModelManager._api_cache = [
            m for m in AiModelManager._api_cache
            if m.get("name") != canonical and m.get("id") != canonical
        ]

        synthetic: dict[str, Any] = {
            "id": canonical,
            "name": canonical,
            "api_class": "generic_openai_standard",
            "display_name": f"{model_name} (Local)",
            "provider": "local",
            "is_active": True,
            "endpoints": ["generic_openai_chat"],
        }
        AiModelManager._api_cache.append(synthetic)
        logger.info(
            "[local_llm_registry] Injected synthetic model '%s' into AiModelManager cache ✓",
            canonical,
        )
    except Exception:
        logger.warning(
            "[local_llm_registry] Failed to inject model into AiModelManager cache",
            exc_info=True,
        )


def _remove_model_from_cache(model_name: str) -> None:
    """Remove the synthetic model entry from AiModelManager._api_cache."""
    try:
        from matrx_ai.db.custom.ai_models.ai_model_manager import AiModelManager

        if AiModelManager._api_cache is None:
            return

        canonical = _local_model_name(model_name)
        before = len(AiModelManager._api_cache)
        AiModelManager._api_cache = [
            m for m in AiModelManager._api_cache
            if m.get("name") != canonical and m.get("id") != canonical
        ]
        removed = before - len(AiModelManager._api_cache)
        if removed:
            logger.info(
                "[local_llm_registry] Removed synthetic model '%s' from AiModelManager cache",
                canonical,
            )
    except Exception:
        logger.warning(
            "[local_llm_registry] Failed to remove model from AiModelManager cache",
            exc_info=True,
        )


# ---------------------------------------------------------------------------
# GenericOpenAIChat instance management
# ---------------------------------------------------------------------------

def _register_instance_with_unified_client(model_name: str, instance: Any) -> None:
    """Register the GenericOpenAIChat instance with matrx-ai's UnifiedAIClient registry."""
    try:
        from matrx_ai.providers.unified_client import register_generic_openai_instance
        canonical = _local_model_name(model_name)
        register_generic_openai_instance(canonical, instance)
        # Also register under "default" so it can be used as a fallback.
        register_generic_openai_instance("default", instance)
        logger.info(
            "[local_llm_registry] Registered GenericOpenAIChat instance for '%s' ✓",
            canonical,
        )
    except (ImportError, AttributeError):
        # register_generic_openai_instance not yet in this matrx-ai version —
        # already covered by the _check_matrx_ai_support guard, but handle
        # defensively.
        logger.warning(
            "[local_llm_registry] Could not register with UnifiedAIClient — "
            "matrx-ai may not have register_generic_openai_instance yet. "
            "Instructions: %s",
            _INSTRUCTIONS_PATH,
        )


def _unregister_instance_from_unified_client(model_name: str) -> None:
    """Unregister the instance from matrx-ai's UnifiedAIClient registry."""
    try:
        from matrx_ai.providers.unified_client import unregister_generic_openai_instance
        canonical = _local_model_name(model_name)
        unregister_generic_openai_instance(canonical)
        unregister_generic_openai_instance("default")
    except (ImportError, AttributeError):
        pass


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def set_local_llm(port: int, model_name: str) -> bool:
    """Register a running local llama-server for use by the agent pipeline.

    Creates a GenericOpenAIChat instance pointed at http://127.0.0.1:{port}/v1,
    injects a synthetic model entry into AiModelManager, and registers the
    instance with UnifiedAIClient.

    Returns True on success, False if matrx-ai support is not available.
    """
    global _local_llm_port, _local_llm_model

    if not _check_matrx_ai_support():
        return False

    try:
        from matrx_ai.providers.generic_openai import GenericOpenAIChat

        _local_llm_port = port
        _local_llm_model = model_name

        base_url = f"http://127.0.0.1:{port}"
        instance = GenericOpenAIChat(
            base_url=base_url,
            api_key="none",
            provider_name="local_llama",
        )

        canonical = _local_model_name(model_name)
        _inject_model_into_cache(model_name)
        _register_instance_with_unified_client(model_name, instance)

        logger.info(
            "[local_llm_registry] Local LLM registered: model='%s', port=%d, base_url=%s/v1 ✓",
            canonical,
            port,
            base_url,
        )
        return True

    except Exception:
        logger.error(
            "[local_llm_registry] Failed to register local LLM (port=%d, model=%s)",
            port,
            model_name,
            exc_info=True,
        )
        return False


def clear_local_llm() -> None:
    """Deregister the local LLM — called when llama-server stops."""
    global _local_llm_port, _local_llm_model

    if _local_llm_model:
        _remove_model_from_cache(_local_llm_model)
        _unregister_instance_from_unified_client(_local_llm_model)
        logger.info(
            "[local_llm_registry] Local LLM deregistered (was: model='%s', port=%s)",
            _local_llm_model,
            _local_llm_port,
        )

    _local_llm_port = None
    _local_llm_model = None


def is_local_llm_available() -> bool:
    """Return True if a local LLM is currently registered and reachable."""
    return _local_llm_port is not None and _local_llm_model is not None


def get_local_llm_status() -> dict[str, Any]:
    """Return a status dict suitable for the /chat/local-llm/status API response."""
    return {
        "available": is_local_llm_available(),
        "port": _local_llm_port,
        "model_name": _local_llm_model,
        "canonical_model_name": _local_model_name(_local_llm_model) if _local_llm_model else None,
        "matrx_ai_support": _check_matrx_ai_support(),
        "instructions": _INSTRUCTIONS_PATH if not _check_matrx_ai_support() else None,
    }
