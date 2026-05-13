"""
Cross-component broadcast inbound router.

Receives v2 envelopes from `_on_broadcast` (extension_broadcast.py) and
routes by `kind`:

- "rpc"      → not yet implemented in Phase 2; logged loudly (Phase 3 will
               wire this into the tool dispatcher).
- "wake"     → fetch the sch_task row named in payload.taskId, attempt
               to claim it, run it; not yet implemented in Phase 2 either
               (the matrx-scheduler[host] integration is Phase 3c).
- "presence" → log debug-level; presence handling is future work.

Phase 2 ships the ROUTING SHAPE plus loud structured logging so we can
observe envelope flow in production. The actual rpc-dispatch and task-
claim are Phase 3 work; this file's job is to make the router exist and
parse cleanly.
"""

from __future__ import annotations

from typing import Any, Dict

from app.api.cross_component_envelope import (
    CrossComponentEnvelope,
    parse_envelope,
)
from app.common.system_logger import get_logger

logger = get_logger()


def route_envelope(raw: Dict[str, Any]) -> None:
    """Entry point called from `_on_broadcast`. Parses the raw payload
    into a v2 envelope and dispatches by `kind`.

    Never raises — broadcast subscribers must not crash on malformed
    inbound traffic. Parse failures are logged at warning level with
    the offending payload for debugging.
    """
    try:
        envelope = parse_envelope(raw)
    except Exception as exc:
        logger.warning(
            "[cross-component] dropped malformed envelope (%s): %r",
            exc,
            raw,
        )
        return

    # Filter: ignore envelopes that originate from this component.
    # The bus is per-user, so an "extension->extension" or
    # "local->local" envelope is either an echo loop or a misdirected
    # message — drop it.
    if envelope.fromInstance.component == "local":
        return

    # Filter: ignore envelopes addressed to a different component.
    # Absent toInstance = broadcast (we DO take those if our kind handler
    # wants them).
    if envelope.toInstance is not None and envelope.toInstance.component != "local":
        return

    logger.info(
        "[cross-component] received envelope kind=%s direction=%s action=%s from=%s/%s",
        envelope.kind,
        envelope.direction,
        envelope.action,
        envelope.fromInstance.component,
        envelope.fromInstance.instanceId,
    )

    if envelope.kind == "rpc":
        _handle_rpc(envelope)
    elif envelope.kind == "wake":
        _handle_wake(envelope)
    elif envelope.kind == "presence":
        _handle_presence(envelope)
    else:
        logger.warning(
            "[cross-component] unknown envelope kind=%r (action=%s)",
            envelope.kind,
            envelope.action,
        )


def _handle_rpc(envelope: CrossComponentEnvelope) -> None:
    """Phase 2 stub. Logs the call; Phase 3 wires it into the dispatcher."""
    logger.info(
        "[cross-component] rpc not yet dispatched in Phase 2: action=%s requestId=%s",
        envelope.action,
        envelope.requestId,
    )
    # TODO Phase 3: look up envelope.action in a handler registry and
    # route into app.tools.dispatcher.dispatch where appropriate. Publish
    # reply envelope back to envelope.fromInstance with same requestId.


def _handle_wake(envelope: CrossComponentEnvelope) -> None:
    """Phase 2 stub. Logs the wake hint; Phase 3c claims the sch_task."""
    payload = envelope.payload if isinstance(envelope.payload, dict) else {}
    task_id = payload.get("taskId")
    if not isinstance(task_id, str) or not task_id:
        logger.warning(
            "[cross-component] wake envelope missing taskId in payload: %r",
            envelope.payload,
        )
        return
    logger.info(
        "[cross-component] wake hint received for sch_task=%s — claim deferred to Phase 3c",
        task_id,
    )
    # TODO Phase 3c: call matrx_scheduler claim RPC for this task and run.


def _handle_presence(envelope: CrossComponentEnvelope) -> None:
    """Debug log only. Presence handling is future work."""
    logger.debug(
        "[cross-component] presence envelope ignored: action=%s from=%s/%s",
        envelope.action,
        envelope.fromInstance.component,
        envelope.fromInstance.instanceId,
    )
