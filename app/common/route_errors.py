"""Centralized error handling for FastAPI routes.

Provides a decorator that wraps route handlers with consistent error handling,
logging, and response formatting. This ensures no route silently swallows errors
and all failures are logged with full context.

Usage:
    from app.common.route_errors import safe_route

    @router.post("/foo")
    @safe_route("foo_operation")
    async def foo_handler(request: FooRequest):
        ...  # exceptions auto-caught, logged, returned as HTTP 500
"""

from __future__ import annotations

import functools
import time
from typing import Any, Callable

from fastapi import HTTPException
from fastapi.responses import JSONResponse

from app.common.system_logger import get_logger

logger = get_logger()


def safe_route(operation_name: str) -> Callable:
    """Decorator that wraps a FastAPI route handler with error handling.

    - Logs the operation start at DEBUG level
    - Catches all unhandled exceptions and returns a 500 JSON response
    - Logs errors at ERROR level with full traceback
    - Re-raises HTTPException (already handled by FastAPI)
    - Measures and logs slow operations (>5s) at WARNING level

    Args:
        operation_name: Human-readable name for log messages (e.g. "tts_synthesize")
    """
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            t0 = time.monotonic()
            try:
                result = await func(*args, **kwargs)
                elapsed_ms = (time.monotonic() - t0) * 1000
                if elapsed_ms > 5000:
                    logger.warning(
                        "[%s] Slow operation: %.0fms", operation_name, elapsed_ms
                    )
                return result
            except HTTPException:
                # Let FastAPI handle these — they already have status codes
                raise
            except Exception as exc:
                elapsed_ms = (time.monotonic() - t0) * 1000
                logger.error(
                    "[%s] Unhandled error after %.0fms: %s: %s",
                    operation_name,
                    elapsed_ms,
                    type(exc).__name__,
                    exc,
                    exc_info=True,
                )
                return JSONResponse(
                    status_code=500,
                    content={
                        "detail": f"{operation_name} failed: {type(exc).__name__}: {exc}",
                        "operation": operation_name,
                    },
                )
        return wrapper
    return decorator
