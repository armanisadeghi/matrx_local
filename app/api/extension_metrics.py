"""In-memory observability for the matrx-extend ↔ matrx-local bridge.

A small, bounded ring of per-command stats lives in this module so the
desktop Bridge Test panel can answer "is `/extension/rpc tool` getting
hammered? what's the p95 latency?" without log scraping.

Scope and bounds:

  * Process-singleton — `_REGISTRY` is created at import time and shared
    across every request. There is exactly one FastAPI worker on the
    desktop sidecar, so this is sufficient.
  * Bounded memory — each command keeps the most recent 100 latencies in
    a `deque(maxlen=100)`. We also cap distinct command names at 200 so
    a malicious caller cannot exhaust memory by sending random command
    strings.
  * Ephemeral — metrics live in-memory only and reset on engine restart
    by design. Persistence would be a separate concern (and a different
    privacy posture).
  * Thread-safe under asyncio — `record()` takes a single asyncio.Lock
    while mutating the shared dict. Snapshots take the same lock and
    deep-copy the deques into plain lists so callers can serialize the
    result without racing future writes.

Wire shape (returned by `get_snapshot()`, exposed as the JSON body of
`GET /extension/metrics`):

    {
      "<command>": {
        "count": 42,
        "error_count": 1,
        "last_n_latencies_ms": [12.3, 15.7, ...],
        "last_called_at": 1715000000000,   # unix milliseconds
        "last_error": "Unknown command: foo" | null
      },
      ...
    }
"""

from __future__ import annotations

import asyncio
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, List, Optional

from app.common.system_logger import get_logger

logger = get_logger()


# Maximum number of distinct command names tracked at once. If exceeded,
# new commands are dropped (counted in `_overflow_count`) so a malicious
# caller cannot inflate memory with random names.
_MAX_DISTINCT_COMMANDS = 200

# Length of the per-command latency ring buffer. Enough to compute p50/p95
# meaningfully without growing unbounded.
_LATENCY_BUFFER_SIZE = 100


def _now_ms() -> int:
    return int(time.time() * 1000)


@dataclass
class CommandMetrics:
    """Per-command rolling stats.

    `last_n_latencies_ms` is a fixed-size deque so memory is bounded even
    for hot commands. p50/p95 are computed client-side from the deque
    snapshot — keeping computation off the hot path.
    """

    count: int = 0
    error_count: int = 0
    last_n_latencies_ms: Deque[float] = field(
        default_factory=lambda: deque(maxlen=_LATENCY_BUFFER_SIZE)
    )
    last_called_at: int = 0
    last_error: Optional[str] = None


class ExtensionMetricsRegistry:
    """Process-singleton ring of per-command stats.

    Concurrency: a single asyncio.Lock guards every mutation. The hot
    path (`record_command`) is microseconds — adding a count, appending
    to a deque, stamping the timestamp. Lock contention is not a real
    concern at the volumes the extension produces, but the lock makes
    the bookkeeping correct under arbitrary task interleavings.
    """

    def __init__(self) -> None:
        self._commands: Dict[str, CommandMetrics] = {}
        self._lock = asyncio.Lock()
        # Number of distinct-command-name registrations rejected because
        # the table was already at `_MAX_DISTINCT_COMMANDS`. Surfaced via
        # the "_overflow" pseudo-row in the snapshot so the UI can warn.
        self._overflow_count = 0

    async def record_command(
        self,
        command: str,
        latency_ms: float,
        ok: bool,
        error: Optional[str] = None,
    ) -> None:
        """Append one observation for `command`.

        Args:
            command: command name (e.g. "tool", "bridge:invoke",
                "ws:connect"). Should be stable across calls so the ring
                accumulates real samples.
            latency_ms: wall-clock latency of this call, in milliseconds.
            ok: whether the call ultimately succeeded.
            error: short error message; only stored on failure, replaces
                the previous `last_error` for that command.
        """
        async with self._lock:
            metrics = self._commands.get(command)
            if metrics is None:
                if len(self._commands) >= _MAX_DISTINCT_COMMANDS:
                    self._overflow_count += 1
                    return
                metrics = CommandMetrics()
                self._commands[command] = metrics

            metrics.count += 1
            if not ok:
                metrics.error_count += 1
                # Keep the message short — the deque-of-last-N pattern
                # already favours recency, so storing only the most
                # recent one is the sensible default.
                metrics.last_error = (error or "")[:512] or None
            metrics.last_n_latencies_ms.append(float(latency_ms))
            metrics.last_called_at = _now_ms()

    async def snapshot(self) -> Dict[str, Dict[str, object]]:
        """Return a JSON-serializable copy of every tracked command.

        Holds the lock for the duration of the copy so partial writes
        cannot corrupt the snapshot. The copy is shallow on the outer
        dict and converts each deque to a `list` so callers can ship
        the result through `JSONResponse` without referencing live
        registry state.
        """
        async with self._lock:
            out: Dict[str, Dict[str, object]] = {}
            for command, metrics in self._commands.items():
                out[command] = {
                    "count": metrics.count,
                    "error_count": metrics.error_count,
                    "last_n_latencies_ms": list(metrics.last_n_latencies_ms),
                    "last_called_at": metrics.last_called_at,
                    "last_error": metrics.last_error,
                }
            if self._overflow_count > 0:
                out["_overflow"] = {
                    "count": self._overflow_count,
                    "error_count": 0,
                    "last_n_latencies_ms": [],
                    "last_called_at": 0,
                    "last_error": (
                        f"distinct-command cap of {_MAX_DISTINCT_COMMANDS} "
                        f"hit; dropped {self._overflow_count} new names"
                    ),
                }
            return out

    async def reset(self) -> None:
        """Clear every stat. Used by the Bridge Test reset button."""
        async with self._lock:
            self._commands.clear()
            self._overflow_count = 0


# Module-level singleton. One per process; safe under FastAPI's single
# worker on the desktop sidecar. Created at import time so first-write
# never has to deal with a None registry.
_REGISTRY = ExtensionMetricsRegistry()


# ---------------------------------------------------------------------------
# Public helpers — the only entry points routes should call.
# ---------------------------------------------------------------------------


async def record(
    command: str,
    latency_ms: float,
    ok: bool,
    error: Optional[str] = None,
) -> None:
    """Async passthrough to the singleton's `record_command`."""
    try:
        await _REGISTRY.record_command(command, latency_ms, ok, error)
    except Exception as exc:
        # Telemetry must never break the bridge. Log loudly and move on.
        logger.warning(
            "[extension_metrics] record(%s) failed: %s", command, exc
        )


async def get_snapshot() -> Dict[str, Dict[str, object]]:
    """Async snapshot of every tracked command, JSON-serializable."""
    return await _REGISTRY.snapshot()


async def reset_metrics() -> None:
    """Drop every recorded stat. Idempotent."""
    await _REGISTRY.reset()


# ---------------------------------------------------------------------------
# Sync helpers for callers outside an event loop (e.g. tests). Only used
# defensively — production code should use the async variants above.
# ---------------------------------------------------------------------------


def get_snapshot_sync() -> Dict[str, Dict[str, object]]:
    """Best-effort sync snapshot. Caller is responsible for not racing
    `record()` calls — if there's no current event loop, this just reads
    the underlying dicts directly.

    Provided for ad-hoc Python REPL inspection and the import smoke-test
    in `extension_metrics`'s done-criteria. Not used by the routes.
    """
    out: Dict[str, Dict[str, object]] = {}
    for command, metrics in _REGISTRY._commands.items():
        out[command] = {
            "count": metrics.count,
            "error_count": metrics.error_count,
            "last_n_latencies_ms": list(metrics.last_n_latencies_ms),
            "last_called_at": metrics.last_called_at,
            "last_error": metrics.last_error,
        }
    return out


# Public re-exports — callers should prefer these names.
__all__ = [
    "CommandMetrics",
    "ExtensionMetricsRegistry",
    "get_snapshot",
    "get_snapshot_sync",
    "record",
    "reset_metrics",
]


# ---------------------------------------------------------------------------
# Convenience: timing context-manager. Saves the boilerplate of
# `t0 = time.perf_counter(); ... ; latency_ms = (time.perf_counter() - t0) * 1000`
# at every call site.
# ---------------------------------------------------------------------------


class TimedCommand:
    """Async context manager that records one observation on exit.

    Usage:

        async with TimedCommand("tool") as tc:
            data = await handler(...)
            # On normal exit: ok=True, no error.
            # On exception: ok=False, error=str(exc).
            tc.set_error("optional override")  # if handler returned ok=False
    """

    __slots__ = ("command", "_start", "_explicit_ok", "_explicit_error")

    def __init__(self, command: str) -> None:
        self.command = command
        self._start: float = 0.0
        self._explicit_ok: Optional[bool] = None
        self._explicit_error: Optional[str] = None

    async def __aenter__(self) -> "TimedCommand":
        self._start = time.perf_counter()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        elapsed_ms = (time.perf_counter() - self._start) * 1000.0
        if exc is not None:
            await record(self.command, elapsed_ms, ok=False, error=str(exc))
            return
        ok = True if self._explicit_ok is None else self._explicit_ok
        await record(
            self.command,
            elapsed_ms,
            ok=ok,
            error=self._explicit_error if not ok else None,
        )

    def set_error(self, error: Optional[str]) -> None:
        """Mark this observation as a soft failure (handler returned ok=False)."""
        self._explicit_ok = False
        self._explicit_error = error

    def set_ok(self, ok: bool) -> None:
        self._explicit_ok = ok


__all__.append("TimedCommand")
