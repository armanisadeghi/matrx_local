"""Local tool bridge — registers matrx-local's OS tools into matrx-ai's ToolRegistry.

Architecture
------------
matrx-ai's ToolExecutor calls tools via:

    result = await tool_callable(args: dict, ctx: ToolContext)

matrx-local's tool handlers have the signature:

    result = await tool_xxx(session: ToolSession, param1, param2, ...) -> ToolResult

The bridge:
  1. Maintains a per-conversation ToolSession (tracks cwd, background shells, etc.)
  2. Wraps each local handler in an adapter that:
       a. Gets/creates the ToolSession for this conversation
       b. Validates args through the Pydantic arg model (if one is wired in the manifest)
       c. Calls the real handler with unpacked validated args
       d. Converts matrx-local's ToolResult → matrx-ai's ToolResult

Registration
------------
Call `register_local_tools(registry)` once at startup (from engine.py).
All tools defined in LOCAL_TOOL_MANIFEST are registered.

The registry key is the tool `name` from the manifest (e.g. "local_bash").
Prompts/agents reference tools by name in their `settings.tools` list.

Schema generation
-----------------
When a manifest entry carries an `arg_model` (a Pydantic BaseModel subclass),
the bridge calls `arg_model.model_json_schema()` and passes the result to the
registry instead of the hand-written `parameters` dict. This keeps the DB schema
in sync with the code automatically.
"""

from __future__ import annotations

import importlib
import inspect
import logging
import time
from typing import Any

logger = logging.getLogger(__name__)

# ---- Lazy imports so this module can be imported before matrx_ai is initialized ----


def _get_registry():
    from matrx_ai.tools.registry import ToolRegistryV2
    return ToolRegistryV2.get_instance()


# ---------------------------------------------------------------------------
# ToolSession pool — keyed by conversation_id
# ---------------------------------------------------------------------------

_session_pool: dict[str, Any] = {}  # conversation_id → ToolSession


def _get_session(conversation_id: str) -> Any:
    """Get or create a ToolSession for a conversation."""
    from app.tools.session import ToolSession

    if conversation_id not in _session_pool:
        _session_pool[conversation_id] = ToolSession()
        logger.debug("Created new ToolSession for conversation %s", conversation_id)
    return _session_pool[conversation_id]


def evict_session(conversation_id: str) -> None:
    """Remove the ToolSession for a conversation (call when conversation ends)."""
    _session_pool.pop(conversation_id, None)


def session_count() -> int:
    return len(_session_pool)


# ---------------------------------------------------------------------------
# Result conversion
# ---------------------------------------------------------------------------

def _convert_result(local_result: Any) -> Any:
    """Convert matrx-local ToolResult → matrx-ai ToolResult.

    matrx-local: ToolResult(type=ToolResultType.SUCCESS, output=str, metadata=dict)
    matrx-ai:    ToolResult(success=bool, output=Any, error=ToolError|None, ...)
    """
    from matrx_ai.tools.models import ToolError
    from matrx_ai.tools.models import ToolResult as AiToolResult
    from app.tools.types import ToolResultType

    is_error = local_result.type == ToolResultType.ERROR

    output: Any = local_result.output or ""

    # Include image data in output if present
    if local_result.image:
        output = {
            "text": local_result.output,
            "image": {
                "media_type": local_result.image.media_type,
                "base64_data": local_result.image.base64_data,
            },
        }

    now = time.time()
    return AiToolResult(
        success=not is_error,
        output=output if not is_error else None,
        error=(
            ToolError(
                error_type="tool_error",
                message=str(local_result.output),
                is_retryable=False,
                suggested_action="Check the error message and try with corrected parameters.",
            )
            if is_error
            else None
        ),
        started_at=now,
        completed_at=now,
    )


# ---------------------------------------------------------------------------
# Adapter factory
# ---------------------------------------------------------------------------

def _resolve_handler(function_path: str) -> Any:
    """Import and return the callable at the given dotted path."""
    module_path, func_name = function_path.rsplit(".", 1)
    module = importlib.import_module(module_path)
    return getattr(module, func_name)


def _make_adapter(handler: Any, tool_name: str, arg_model: type | None = None) -> Any:
    """Wrap a local tool handler in a matrx-ai compatible async callable.

    If an arg_model (Pydantic BaseModel) is provided, args are validated and
    coerced through it before being passed to the handler. This catches type
    errors early and surfaces clear messages to the AI.
    """
    sig = inspect.signature(handler)
    param_names = [p for p in sig.parameters if p != "session"]

    async def adapter(args: dict[str, Any], ctx: Any) -> Any:
        session = _get_session(ctx.conversation_id)

        # Validate + coerce args via the Pydantic model when available
        validated_args = args
        if arg_model is not None:
            try:
                parsed = arg_model.model_validate(args)
                validated_args = parsed.model_dump(exclude_none=True)
            except Exception as exc:
                from matrx_ai.tools.models import ToolError
                from matrx_ai.tools.models import ToolResult as AiToolResult

                now = time.time()
                return AiToolResult(
                    success=False,
                    error=ToolError(
                        error_type="invalid_arguments",
                        message=f"Argument validation failed for '{tool_name}': {exc}",
                        is_retryable=True,
                        suggested_action=(
                            "Review the tool's parameter schema and correct the arguments."
                        ),
                    ),
                    started_at=now,
                    completed_at=now,
                )

        # Build kwargs — only pass params the handler signature accepts
        kwargs: dict[str, Any] = {}
        for name in param_names:
            param = sig.parameters[name]
            if name in validated_args:
                kwargs[name] = validated_args[name]
            elif param.default is not inspect.Parameter.empty:
                pass  # use the handler default
            # else: required param missing — handler will raise a meaningful error

        try:
            local_result = await handler(session, **kwargs)
            return _convert_result(local_result)
        except Exception as exc:
            from matrx_ai.tools.models import ToolError
            from matrx_ai.tools.models import ToolResult as AiToolResult

            logger.exception("Local tool %s raised an exception", tool_name)
            now = time.time()
            return AiToolResult(
                success=False,
                error=ToolError(
                    error_type="execution",
                    message=f"Tool '{tool_name}' failed: {exc}",
                    is_retryable=False,
                    suggested_action="Check the error message and adjust parameters.",
                ),
                started_at=now,
                completed_at=now,
            )

    adapter.__name__ = f"local_{tool_name}_adapter"
    adapter.__doc__ = handler.__doc__
    return adapter


# ---------------------------------------------------------------------------
# Schema resolution — prefer arg_model over hand-written dict
# ---------------------------------------------------------------------------

def _resolve_parameters(entry: Any) -> dict[str, Any]:
    """Return the JSON Schema for a manifest entry.

    Priority:
    1. entry.arg_model.model_json_schema()  — auto-generated, always in sync
    2. entry.parameters                     — hand-written fallback
    """
    if entry.arg_model is not None:
        try:
            schema = entry.arg_model.model_json_schema()
            # Normalise to the same envelope the DB expects
            return {
                "type": "object",
                "properties": schema.get("properties", {}),
                "required": schema.get("required", []),
            }
        except Exception as exc:
            logger.warning(
                "Could not generate schema from arg_model for %s: %s — falling back to hand-written",
                entry.name,
                exc,
            )
    return entry.parameters


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_local_tools(registry: Any | None = None) -> int:
    """Register all local tools from the manifest into the matrx-ai registry.

    Args:
        registry: ToolRegistryV2 instance. If None, uses the singleton.

    Returns:
        Number of tools successfully registered.
    """
    from app.tools.local_tool_manifest import LOCAL_TOOL_MANIFEST

    if registry is None:
        registry = _get_registry()

    registered = 0
    failed: list[str] = []

    for entry in LOCAL_TOOL_MANIFEST:
        try:
            handler = _resolve_handler(entry.function_path)
            adapter = _make_adapter(handler, entry.name, arg_model=entry.arg_model)
            parameters = _resolve_parameters(entry)

            registry.register_local(
                name=entry.name,
                func=adapter,
                description=entry.description,
                category=entry.category,
                tags=entry.tags,
                parameters=parameters,
                version=entry.version,
                timeout_seconds=entry.timeout_seconds,
            )
            registered += 1

        except ImportError as exc:
            # Module not available on this platform (e.g. applescript on Linux)
            logger.debug("Skipping local tool %s — import error: %s", entry.name, exc)
        except AttributeError as exc:
            logger.warning("Skipping local tool %s — handler not found: %s", entry.name, exc)
        except Exception as exc:
            failed.append(entry.name)
            logger.error("Failed to register local tool %s: %s", entry.name, exc)

    logger.info(
        "Local tool bridge: registered %d/%d tools",
        registered,
        len(LOCAL_TOOL_MANIFEST),
    )
    if failed:
        logger.warning("Failed to register: %s", failed)

    return registered


def registered_local_tool_names() -> list[str]:
    """Return the names of all registered local tools."""
    from app.tools.local_tool_manifest import LOCAL_TOOL_MANIFEST
    return [e.name for e in LOCAL_TOOL_MANIFEST]
