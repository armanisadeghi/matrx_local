from typing import Any, Dict, Optional
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.common.system_logger import get_logger
from app.api.routes import _APP_VERSION

logger = get_logger()
router = APIRouter(prefix="/extension", tags=["extension"])


class DesktopRpcRequest(BaseModel):
    command: str
    args: Optional[Dict[str, Any]] = Field(default_factory=dict)


class DesktopRpcResponse(BaseModel):
    ok: bool
    data: Optional[Any] = None
    error: Optional[str] = None


@router.post("/rpc", response_model=DesktopRpcResponse)
async def handle_rpc(request: DesktopRpcRequest, req: Request) -> DesktopRpcResponse:
    """
    Handle RPC requests from the matrx-extend Chrome extension.
    Requires a valid Bearer token (typically the Supabase JWT).
    """
    logger.info("[extension_routes] Received RPC command: %s", request.command)

    try:
        if request.command == "health":
            # The extension expects DesktopHealthSchema: status, version, optional user_id
            return DesktopRpcResponse(
                ok=True,
                data={
                    "status": "ok",
                    "version": _APP_VERSION,
                    "user_id": None,
                },
            )

        # Placeholder for future commands
        return DesktopRpcResponse(
            ok=False,
            error=f"Unknown command: {request.command}",
        )
    except Exception as e:
        logger.error("[extension_routes] RPC error: %s", e, exc_info=True)
        return DesktopRpcResponse(
            ok=False,
            error=str(e),
        )
