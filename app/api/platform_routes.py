"""Platform context API routes.

Exposes the single platform/capability context object that the React frontend
loads once at startup via GET /platform/context.

The refresh endpoint is available if the UI ever needs to force a re-probe
(e.g. after a user grants microphone permission).
"""

from __future__ import annotations

from fastapi import APIRouter

from app.common.platform_ctx import get_platform_context, refresh_capabilities
from app.common.system_logger import get_logger

logger = get_logger()
router = APIRouter(prefix="/platform", tags=["platform"])


@router.get("/context")
async def get_context() -> dict:
    """Return the current platform + capability context.

    Called by the React frontend once at startup.  Capabilities that have
    not yet been probed (None values) become available after the engine's
    lifespan startup task completes.
    """
    return get_platform_context()


@router.post("/context/refresh")
async def refresh_context() -> dict:
    """Re-probe hardware/permission capabilities and return updated context.

    Safe to call at any time — e.g. after the user grants microphone or
    screen-recording access.
    """
    await refresh_capabilities()
    logger.info("[platform] capability context refreshed")
    return get_platform_context()
