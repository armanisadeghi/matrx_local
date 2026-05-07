"""Bridge-test HTTP surface for the matrx-extend ↔ matrx-local bridge.

These routes back the desktop frontend's "Bridge Test" page (Settings →
Bridge Test). They are NOT part of the public extension contract — the
extension itself only consumes `POST /extension/rpc` and `WS /extension/ws`.
The endpoints here exist so a human (or an agent driving the desktop UI)
can introspect and exercise the bridge from inside the Tauri app instead
of curl-ing the engine.

Auth: all routes inherit the engine's standard Bearer-token gate via the
upstream `AuthMiddleware` — none are added to `_PUBLIC_PATHS`.

Routes:

  * `GET  /extension/sessions`            — list active extension WS sessions
  * `POST /extension/sessions/disconnect` — close a session by id
  * `POST /extension/invoke`              — engine → browser tool dispatch
  * `GET  /extension/broadcast/status`    — broadcast plumb status
  * `POST /extension/broadcast/test`      — feature-flagged no-op publish
  * `WS   /extension/bridge-events`       — live event log fan-out

The WS route is an additive log fan-out — every bridge event (RPC in,
session open/close, invoke send, invoke result, broadcast publish) is
also pushed to every connected `bridge-events` socket so the Bridge Test
UI's live log panel can render them. Multiple subscribers can attach
without affecting each other or the bridge's primary path.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request, WebSocket
from pydantic import BaseModel, Field
from starlette.websockets import WebSocketDisconnect

from app.api.extension_broadcast import (
    is_broadcast_enabled,
    publish_to_extension,
)
from app.api.extension_invoke import invoke_extension_tool
from app.api.extension_ws_manager import (
    disconnect_session,
    list_active_sessions,
)
from app.common.system_logger import get_logger

logger = get_logger()
router = APIRouter(prefix="/extension", tags=["extension-bridge-test"])


# ---------------------------------------------------------------------------
# Live event log fan-out — process-singleton pub/sub for the Bridge Test
# UI's "Live event log" panel. Every bridge primitive (rpc receive, ws
# session open/close, invoke send/recv, broadcast publish) calls
# `publish_event(...)` which pushes a line to every connected subscriber.
# ---------------------------------------------------------------------------


_EVENT_SUBSCRIBERS: List["asyncio.Queue[Dict[str, Any]]"] = []


def _now_ms() -> int:
    return int(time.time() * 1000)


def publish_event(
    kind: str,
    direction: str,
    payload: Optional[Dict[str, Any]] = None,
) -> None:
    """Fan out a bridge event to every Bridge Test subscriber.

    Non-blocking: if a subscriber's queue is full (1024 items deep), the
    oldest entry is dropped to make room. Subscribers run independently
    of every other code path — failing to enqueue here never breaks the
    bridge.

    Args:
        kind: short event tag, e.g. "rpc", "ws.open", "ws.close",
            "invoke.send", "invoke.result", "broadcast.publish".
        direction: "in" (frontend/extension → engine) or "out" (engine
            → frontend/extension), or "internal" for engine-only events.
        payload: arbitrary JSON-serializable detail dict.
    """
    if not _EVENT_SUBSCRIBERS:
        return
    event = {
        "timestamp": _now_ms(),
        "kind": kind,
        "direction": direction,
        "payload": payload or {},
    }
    for queue in list(_EVENT_SUBSCRIBERS):
        try:
            if queue.full():
                # Drop oldest to make room — keeps the live log fresh
                # even when a slow client falls behind.
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            queue.put_nowait(event)
        except Exception:
            # Subscriber may have been removed mid-iteration; ignore.
            pass


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class InvokeRequest(BaseModel):
    session_id: str
    tool_name: str
    args: Dict[str, Any] = Field(default_factory=dict)
    timeout_seconds: float = 30.0


class InvokeResponse(BaseModel):
    ok: bool
    envelope: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    error_type: Optional[str] = None


class DisconnectRequest(BaseModel):
    session_id: str
    reason: Optional[str] = None


class BroadcastTestRequest(BaseModel):
    user_id: str
    type: str = "bridge.test"
    payload: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Session introspection / management
# ---------------------------------------------------------------------------


@router.get("/sessions")
async def get_sessions() -> Dict[str, Any]:
    """Return a snapshot of every active extension WebSocket session."""
    sessions = list_active_sessions()
    publish_event(
        "sessions.list",
        "internal",
        {"count": len(sessions)},
    )
    return {"sessions": sessions, "count": len(sessions)}


@router.post("/sessions/disconnect")
async def post_disconnect(req: DisconnectRequest) -> Dict[str, Any]:
    """Close an extension WS session by id. Idempotent."""
    found = await disconnect_session(
        req.session_id,
        reason=req.reason or "Closed by desktop UI",
    )
    publish_event(
        "ws.close",
        "internal",
        {"session_id": req.session_id, "found": found, "by": "desktop-ui"},
    )
    return {"ok": True, "found": found}


# ---------------------------------------------------------------------------
# Engine → browser tool dispatch
# ---------------------------------------------------------------------------


@router.post("/invoke", response_model=InvokeResponse)
async def post_invoke(req: InvokeRequest) -> InvokeResponse:
    """Dispatch a tool call to a connected extension session.

    Thin HTTP wrapper around `invoke_extension_tool`. Returns the FULL
    `extension.result` envelope under `envelope` so callers can branch
    on `envelope.ok` without losing the error / errorType fields.

    Validation: `timeout_seconds` is clamped to [1, 120] — anything
    higher would let a runaway browser hang an HTTP worker indefinitely.
    """
    timeout = max(1.0, min(120.0, float(req.timeout_seconds)))

    publish_event(
        "invoke.send",
        "out",
        {
            "session_id": req.session_id,
            "tool_name": req.tool_name,
            "args_keys": list(req.args.keys()),
            "timeout_seconds": timeout,
        },
    )

    try:
        envelope = await invoke_extension_tool(
            req.tool_name,
            req.args,
            req.session_id,
            timeout_seconds=timeout,
        )
    except Exception as exc:
        publish_event(
            "invoke.error",
            "in",
            {
                "session_id": req.session_id,
                "tool_name": req.tool_name,
                "error": str(exc),
                "error_type": type(exc).__name__,
            },
        )
        return InvokeResponse(
            ok=False,
            error=str(exc),
            error_type=type(exc).__name__,
        )

    publish_event(
        "invoke.result",
        "in",
        {
            "session_id": req.session_id,
            "tool_name": req.tool_name,
            "envelope_ok": (
                envelope.get("ok") if isinstance(envelope, dict) else None
            ),
        },
    )
    return InvokeResponse(ok=True, envelope=envelope)


# ---------------------------------------------------------------------------
# Broadcast plumb test
# ---------------------------------------------------------------------------


@router.get("/broadcast/status")
async def get_broadcast_status() -> Dict[str, Any]:
    """Report the current state of the Supabase Broadcast plumb.

    Always 200 — the panel renders different copy based on whether the
    feature flag is on, never depends on a non-200 to detect the off
    state. Channel name is constructed from a placeholder when no user
    id is supplied, so the UI can show the template.
    """
    return {
        "enabled": is_broadcast_enabled(),
        "channel_template": "matrx-local-bridge:<user_id>",
        "setting_key": "extension_broadcast_enabled",
    }


@router.post("/broadcast/test")
async def post_broadcast_test(req: BroadcastTestRequest) -> Dict[str, Any]:
    """Publish a no-op test envelope on the user's bridge channel.

    Returns `{ok, sent, enabled}` so the Bridge Test UI can distinguish
    "broadcast plumb is off" from "broadcast plumb is on but the user
    is not connected" from "publish actually fired".
    """
    enabled = is_broadcast_enabled()
    sent = await publish_to_extension(
        req.user_id,
        type=req.type,
        payload=req.payload,
    )
    publish_event(
        "broadcast.publish",
        "out",
        {
            "user_id": req.user_id,
            "type": req.type,
            "sent": sent,
            "enabled": enabled,
        },
    )
    return {
        "ok": True,
        "sent": sent,
        "enabled": enabled,
    }


# ---------------------------------------------------------------------------
# Live event log WS — additive fan-out for the Bridge Test panel
# ---------------------------------------------------------------------------


@router.websocket("/bridge-events")
async def bridge_events_websocket(websocket: WebSocket) -> None:
    """Stream every bridge primitive event to subscribers.

    Auth: same `?token=<jwt>` gate as the rest of the extension WS
    surface — browsers can't set headers on a WS upgrade. Every event
    matches the shape produced by `publish_event(...)`.

    The subscriber's queue caps at 1024 entries; on overflow the oldest
    entry is dropped (see `publish_event`). This is a diagnostic
    channel — losing events is preferable to back-pressuring the bridge.
    """
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008, reason="Missing auth token")
        return

    await websocket.accept()
    queue: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue(maxsize=1024)
    _EVENT_SUBSCRIBERS.append(queue)

    publish_event(
        "bridge-events.subscribe",
        "internal",
        {"subscribers": len(_EVENT_SUBSCRIBERS)},
    )

    try:
        # Fire a hello so the client can confirm subscription.
        await websocket.send_text(
            json.dumps(
                {
                    "timestamp": _now_ms(),
                    "kind": "bridge-events.hello",
                    "direction": "internal",
                    "payload": {"subscribers": len(_EVENT_SUBSCRIBERS)},
                }
            )
        )

        while True:
            event = await queue.get()
            await websocket.send_text(json.dumps(event))
    except WebSocketDisconnect:
        # Normal — page navigation or panel close.
        pass
    except Exception as exc:
        logger.warning("[extension_bridge_routes] bridge-events socket crashed: %s", exc)
    finally:
        try:
            _EVENT_SUBSCRIBERS.remove(queue)
        except ValueError:
            pass
        publish_event(
            "bridge-events.unsubscribe",
            "internal",
            {"subscribers": len(_EVENT_SUBSCRIBERS)},
        )
