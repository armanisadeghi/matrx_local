"""Structured access logger for the Matrx Local engine.

Writes one JSON record per request to ``system/logs/access.log``.
Each record has:
    timestamp   – ISO-8601 UTC
    method      – HTTP verb
    path        – URL path (no query string)
    query       – query string (may be empty)
    origin      – value of the Origin header (where the call came from)
    user_agent  – abbreviated UA string
    status      – HTTP response status code
    duration_ms – round-trip time in milliseconds

The file is consumed by:
    GET /logs/access        – last-N snapshot (JSON)
    GET /logs/access/stream – SSE live-push stream
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Deque

from app.config import LOG_DIR

ACCESS_LOG_PATH = Path(LOG_DIR) / "access.log"
os.makedirs(ACCESS_LOG_PATH.parent, exist_ok=True)

# In-memory ring buffer so the SSE stream can push entries without a file read.
_RING: Deque[dict] = deque(maxlen=500)

# Subscribers waiting for new entries (each is an asyncio.Queue).
_SUBSCRIBERS: list[asyncio.Queue] = []


def _write_entry(entry: dict) -> None:
    """Append one JSON-line to access.log and notify SSE subscribers."""
    _RING.append(entry)
    line = json.dumps(entry, default=str)
    try:
        with open(ACCESS_LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass  # never crash the request pipeline over a log write

    dead: list[asyncio.Queue] = []
    for q in _SUBSCRIBERS:
        try:
            q.put_nowait(entry)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        _SUBSCRIBERS.remove(q)


def record(
    *,
    method: str,
    path: str,
    query: str,
    origin: str,
    user_agent: str,
    status: int,
    duration_ms: float,
) -> None:
    """Build an access entry and persist it."""
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "method": method,
        "path": path,
        "query": query,
        "origin": origin or "—",
        "user_agent": user_agent[:120] if user_agent else "—",
        "status": status,
        "duration_ms": round(duration_ms, 1),
    }
    _write_entry(entry)


def recent(n: int = 100) -> list[dict]:
    """Return the last *n* entries from the in-memory ring (fast path).

    Falls back to reading the file if the ring is empty (e.g. first boot).
    """
    if _RING:
        entries = list(_RING)
        return entries[-n:]

    # Cold-start: parse tail of the file.
    try:
        with open(ACCESS_LOG_PATH, "r", encoding="utf-8") as fh:
            lines = fh.readlines()
        parsed = []
        for line in lines[-n:]:
            line = line.strip()
            if line:
                try:
                    parsed.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        return parsed
    except FileNotFoundError:
        return []


def subscribe() -> asyncio.Queue:
    """Return a new asyncio.Queue that receives future access entries."""
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    _SUBSCRIBERS.append(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    """Remove a subscriber queue."""
    try:
        _SUBSCRIBERS.remove(q)
    except ValueError:
        pass
