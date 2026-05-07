"""Process-singleton snapshot of the Cloudflare tunnel state.

The tunnel manager (``app.services.tunnel.manager.TunnelManager``) owns the
authoritative subprocess and URL — but knowing "is the tunnel up right now,
and what should the extension be calling?" requires reading several pieces
of state that live on different objects:

  * tunnel manager — running flag, public URL, ws URL, mode (quick / named)
  * the engine's bound local URL (``http://127.0.0.1:<port>``)
  * the user's preferred-mode flag (``MATRX_PREFER_TUNNEL`` env, default
    off — most users have direct localhost access)

This module collapses the lookup into one O(1) read and one place to
update when either side changes. Pattern mirrors
``app/api/extension_metrics.py``: a process-level singleton, fast paths
that never touch the filesystem, and a single ``snapshot()`` exposing a
JSON-serialisable shape callers can ship straight back to clients.

Wire shape (returned by :func:`get_tunnel_snapshot` and exposed at
``GET /extension/tunnel/status``)::

    {
      "active": bool,                  # tunnel currently up?
      "tunnel_url": str | None,        # https://random-string.trycloudflare.com
      "tunnel_ws":  str | None,        # wss://...trycloudflare.com/ws
      "local_url":  str,               # http://127.0.0.1:<port>
      "local_ws":   str,               # ws://127.0.0.1:<port>/ws
      "preferred":  "local" | "tunnel",
      "mode":       "quick" | "named",
      "uptime_seconds": float,
    }

Threading: every access goes through a non-async snapshot read of plain
strings/ints — no lock needed. Writes (``set_local_url``,
``set_tunnel_url``, ``mark_tunnel_inactive``) are also non-async; any
caller that needs sequencing should compose its own asyncio.Lock outside.
The hot path is "read on every ``GET /extension/tunnel/status``", which
is in the few-Hz range coming from the desktop UI.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from app.common.system_logger import get_logger

logger = get_logger()


def _prefer_tunnel_default() -> bool:
    """Resolve the ``MATRX_PREFER_TUNNEL`` env flag.

    Default ``False`` so most users — who run the extension on the same
    machine as the engine — keep the existing zero-cost loopback path.
    Setting the env var to ``true`` / ``1`` / ``yes`` flips the
    ``preferred`` field to ``"tunnel"`` whenever a tunnel is up, which is
    what an extension running on a *different* device (phone, second
    laptop) should respect.
    """
    raw = os.getenv("MATRX_PREFER_TUNNEL", "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


@dataclass
class _TunnelSnapshot:
    """In-memory copy of every field exposed by ``get_tunnel_snapshot``.

    Mirrors the wire shape one-for-one so updaters / readers can swap
    fields without bookkeeping. Field defaults match the "engine just
    started, no tunnel yet" state so callers that read before any update
    fires still get a correct envelope.
    """

    active: bool = False
    tunnel_url: Optional[str] = None
    tunnel_ws: Optional[str] = None
    local_url: str = "http://127.0.0.1:22140"
    local_ws: str = "ws://127.0.0.1:22140/ws"
    mode: str = "quick"  # "quick" or "named"
    uptime_seconds: float = 0.0
    # Captured once at first read so the env var can't be flipped at
    # runtime mid-session and produce inconsistent answers within the
    # same process. Override by restarting the engine.
    prefer_tunnel: bool = field(default_factory=_prefer_tunnel_default)


# Module-level singleton. Created at import time so the first reader
# never has to deal with a None state.
_STATE = _TunnelSnapshot()


# ---------------------------------------------------------------------------
# Writers — every code path that learns the tunnel state should call one of
# these so the snapshot stays in sync without forcing a filesystem read.
# ---------------------------------------------------------------------------


def set_local_url(port: int) -> None:
    """Record the engine's bound HTTP / WS URLs.

    Called once at engine startup after ``write_discovery_file`` has
    chosen the port. Idempotent — calling it twice with the same port
    is a no-op.
    """
    if not isinstance(port, int) or port <= 0:
        logger.warning("[tunnel_state] set_local_url(%r) — invalid port; ignoring", port)
        return
    _STATE.local_url = f"http://127.0.0.1:{port}"
    _STATE.local_ws = f"ws://127.0.0.1:{port}/ws"


def set_tunnel_url(
    tunnel_url: Optional[str],
    *,
    mode: str = "quick",
    uptime_seconds: float = 0.0,
) -> None:
    """Record an active tunnel URL.

    ``tunnel_url`` is the public ``https://`` URL emitted by cloudflared
    (e.g. ``https://random-words-1234.trycloudflare.com``). When ``None``
    or empty the tunnel is treated as inactive — equivalent to calling
    :func:`mark_tunnel_inactive`.
    """
    if not tunnel_url:
        mark_tunnel_inactive()
        return

    # Normalise — strip trailing slash so the ws derivation below is
    # always well-formed.
    url = tunnel_url.rstrip("/")
    _STATE.active = True
    _STATE.tunnel_url = url
    _STATE.tunnel_ws = url.replace("https://", "wss://") + "/ws"
    _STATE.mode = "named" if mode == "named" else "quick"
    _STATE.uptime_seconds = float(uptime_seconds or 0.0)


def mark_tunnel_inactive() -> None:
    """Clear tunnel fields so the snapshot reports ``active=False``.

    Called when the tunnel subprocess stops, fails to start, or is
    explicitly stopped by the user via ``POST /tunnel/stop``.
    """
    _STATE.active = False
    _STATE.tunnel_url = None
    _STATE.tunnel_ws = None
    _STATE.uptime_seconds = 0.0


# ---------------------------------------------------------------------------
# Reader — the only entry point routes / desktop UI should call.
# ---------------------------------------------------------------------------


def get_tunnel_snapshot() -> Dict[str, Any]:
    """Return the JSON-serialisable snapshot.

    Reads the live tunnel manager singleton when present so that
    ``uptime_seconds`` and ``mode`` track the running subprocess without
    needing a per-second tick. The lookup is intentionally lazy — the
    tunnel manager module is imported on demand so this module stays
    cheap to import in callers that never touch the tunnel.

    Importantly, this never touches the discovery file. The file remains
    the authoritative on-disk record (read by external clients before
    they hit the engine), but the runtime endpoint reads from RAM so
    every request stays sub-millisecond.
    """
    # Best-effort sync with the tunnel manager. If anything goes wrong
    # we still return our own cached snapshot.
    try:
        from app.services.tunnel.manager import get_tunnel_manager  # local import

        tm = get_tunnel_manager()
        if tm.running:
            url = tm.url
            if url:
                # Re-record so any drift between an earlier
                # ``set_tunnel_url`` and the manager's current view is
                # corrected on the read path. Cheap.
                set_tunnel_url(
                    url,
                    mode="named" if getattr(tm, "_token", "") else "quick",
                    uptime_seconds=tm.uptime_seconds,
                )
        else:
            # Manager says nothing is running — make sure we don't keep
            # advertising a stale URL.
            if _STATE.active:
                mark_tunnel_inactive()
    except Exception:
        # The tunnel manager is optional — not every install ships it.
        # Never let an introspection request crash because of it.
        logger.debug("[tunnel_state] tunnel manager lookup failed", exc_info=True)

    preferred = "tunnel" if (_STATE.active and _STATE.prefer_tunnel) else "local"

    return {
        "active": _STATE.active,
        "tunnel_url": _STATE.tunnel_url,
        "tunnel_ws": _STATE.tunnel_ws,
        "local_url": _STATE.local_url,
        "local_ws": _STATE.local_ws,
        "preferred": preferred,
        "prefer_tunnel": _STATE.prefer_tunnel,
        "mode": _STATE.mode,
        "uptime_seconds": _STATE.uptime_seconds,
    }


__all__ = [
    "get_tunnel_snapshot",
    "mark_tunnel_inactive",
    "set_local_url",
    "set_tunnel_url",
]
