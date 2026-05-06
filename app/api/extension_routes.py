"""HTTP + WebSocket routes for the matrx-extend Chrome extension.

  * `POST /extension/rpc` — synchronous request/response RPC. Used for
    health, version, capabilities, single tool dispatch.
  * `WS   /extension/ws`  — persistent reverse-push channel. Engine
    sends `extension.invoke` envelopes; extension responds with
    `extension.result`. Heartbeats (`ping`/`pong`) maintain liveness
    and carry the engine's tool-catalog hash so the extension can
    detect catalog drift.

The WS route is dedicated to the extension and SEPARATE from the
existing `/ws` endpoint (which serves the engine's primary tool UI).
This keeps extension session state isolated from the primary UI session
manager — each side can evolve without breaking the other.

Auth: same Bearer-token gate as `/extension/rpc`. Browsers can't set
custom headers on a WS upgrade, so the token comes via `?token=` query
param (consistent with the existing `/ws` endpoint and `AuthMiddleware`
fallback). Loopback-only enforcement is upstream.
"""

from __future__ import annotations

import json
import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, Request, WebSocket
from pydantic import BaseModel, Field
from starlette.websockets import WebSocketDisconnect

from app.api.extension_handlers import HANDLERS
from app.api.extension_ws_manager import (
    register_session,
    resolve_pending_future,
    unregister_session,
)
from app.api.routes import _APP_VERSION
from app.common.system_logger import get_logger
from app.tools.dispatcher import tool_catalog_hash

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

    Dispatches to a handler registered in `app.api.extension_handlers.HANDLERS`.
    Handlers return a JSON-serializable dict that becomes the `data` field of
    the outer envelope on success. Unhandled exceptions inside a handler are
    caught here and surfaced as `ok=False`, with the exception class name
    carried in `data.error_type` for the extension's UX.

    Auth (Bearer token / Supabase JWT) is enforced by upstream middleware.
    """
    logger.info("[extension_routes] Received RPC command: %s", request.command)

    handler = HANDLERS.get(request.command)
    if handler is None:
        return DesktopRpcResponse(
            ok=False,
            error=f"Unknown command: {request.command}",
        )

    try:
        data = await handler(request.args or {}, req)
        return DesktopRpcResponse(ok=True, data=data)
    except Exception as e:
        logger.error(
            "[extension_routes] handler %r failed: %s",
            request.command,
            e,
            exc_info=True,
        )
        return DesktopRpcResponse(
            ok=False,
            error=str(e),
            data={"error_type": type(e).__name__},
        )


# ---------------------------------------------------------------------------
# /extension/ws — persistent reverse-push channel
# ---------------------------------------------------------------------------


def _now_ms() -> int:
    return int(time.time() * 1000)


def _build_pong(client_timestamp: Any) -> Dict[str, Any]:
    """Construct the pong envelope.

    Includes the engine version and the current tool-catalog hash so the
    extension can detect catalog drift across reconnects without an
    extra `capabilities` round-trip.
    """
    return {
        "type": "pong",
        "timestamp": _now_ms(),
        "client_timestamp": client_timestamp if isinstance(client_timestamp, (int, float)) else None,
        "engine_version": _APP_VERSION,
        "tool_catalog_hash": tool_catalog_hash(),
    }


@router.websocket("/ws")
async def extension_websocket(websocket: WebSocket) -> None:
    """Engine → extension reverse-push channel.

    Lifecycle:

      1. Bearer token present in `?token=` query param (browsers cannot
         set Authorization headers on a WS upgrade). Missing token =>
         close with 1008. Production-grade JWT validation is upstream;
         this endpoint enforces presence parity with the existing `/ws`
         route.
      2. Accept upgrade. Register a session in
         `extension_ws_manager`; the registry mints a UUID `session_id`.
      3. Send a `hello` envelope so the client can confirm connection
         and learn its session_id (useful for diagnostics / multi-tab
         scenarios where one user has multiple offscreen documents).
      4. Read messages forever. Dispatch by `type`:
            - "extension.result" => resolve the matching callId Future
            - "ping"              => respond with `pong`
            - other               => log warning, do not disconnect
      5. On any disconnect (clean or abrupt), unregister the session —
         the registry cancels every pending Future for that session
         with a ConnectionError so awaiting `invoke_extension_tool`
         callers don't hang forever.
    """
    token = websocket.query_params.get("token")
    if not token:
        logger.warning("[extension_ws] rejected — missing token query param")
        await websocket.close(code=1008, reason="Missing auth token")
        return

    await websocket.accept()
    session = register_session(websocket, user_token=token)

    # Send the hello envelope. Failure here means the socket died during
    # accept — bail out without entering the read loop.
    hello_sent = await session.send(
        {
            "type": "hello",
            "session_id": session.session_id,
            "engine_version": _APP_VERSION,
            "tool_catalog_hash": tool_catalog_hash(),
            "timestamp": _now_ms(),
        }
    )
    if not hello_sent:
        unregister_session(session.session_id)
        return

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError as exc:
                logger.warning(
                    "[extension_ws] invalid JSON session=%s err=%s",
                    session.session_id,
                    exc,
                )
                continue

            await _handle_extension_message(session.session_id, msg)
    except WebSocketDisconnect as exc:
        # 1001 (Going Away) and 1012 (Service Restart) are expected
        # close codes during normal extension lifecycle (page unload,
        # engine restart). Log them quietly.
        if exc.code in (1001, 1012):
            logger.debug(
                "[extension_ws] session=%s closed normally code=%s",
                session.session_id,
                exc.code,
            )
        else:
            logger.info(
                "[extension_ws] session=%s disconnected code=%s reason=%s",
                session.session_id,
                exc.code,
                exc.reason,
            )
    except Exception as exc:
        logger.error(
            "[extension_ws] session=%s read loop crashed: %s",
            session.session_id,
            exc,
            exc_info=True,
        )
    finally:
        unregister_session(session.session_id)


async def _handle_extension_message(session_id: str, msg: Dict[str, Any]) -> None:
    """Dispatch a single inbound envelope by `type`."""
    msg_type = msg.get("type")

    if msg_type == "extension.result":
        call_id = msg.get("callId")
        if not isinstance(call_id, str):
            logger.warning(
                "[extension_ws] extension.result missing callId session=%s",
                session_id,
            )
            return
        resolved = resolve_pending_future(call_id, msg)
        if not resolved:
            logger.warning(
                "[extension_ws] extension.result for unknown/late callId=%s session=%s",
                call_id,
                session_id,
            )
        return

    if msg_type == "ping":
        # Heartbeat — respond inline. The send goes through the same
        # session lock as engine-initiated invocations, so frame
        # interleaving is impossible.
        from app.api.extension_ws_manager import get_registry

        session = get_registry().get(session_id)
        if session is None:
            return
        await session.send(_build_pong(msg.get("timestamp")))
        return

    logger.warning(
        "[extension_ws] unknown message type=%r session=%s",
        msg_type,
        session_id,
    )
