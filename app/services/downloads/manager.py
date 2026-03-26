"""Universal download manager.

Manages a single-worker sequential download queue backed by the local SQLite
database.  All large file downloads (LLM models, Whisper models, image-gen
weights, TTS voices, future file-sync items) funnel through this service so:

- Progress is tracked in one place and streamed to the UI via SSE.
- The queue survives app restarts / crashes (status 'active' → reset to
  'queued' on startup so incomplete downloads are automatically retried).
- Downloads continue even when the Tauri window is closed (the Python engine
  runs as a background sidecar).
- Each download emits fine-grained byte-level progress events (real percent,
  speed, ETA) using httpx's streaming API.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, AsyncIterator, Callable, Literal, Optional

import httpx

from app.common.system_logger import get_logger
from app.services.local_db.database import get_db

logger = get_logger()

DownloadStatus = Literal["queued", "active", "completed", "failed", "cancelled"]
DownloadCategory = Literal["llm", "whisper", "image_gen", "tts", "file_sync"]

# How often (in bytes) we flush a progress event to SSE subscribers.
# At typical LLM download speeds (10–100 MB/s) this is ~10–100 ms between
# events — frequent enough for smooth UI without flooding the SSE connection.
_PROGRESS_CHUNK_BYTES = 512 * 1024  # 512 KB


@dataclass
class DownloadEntry:
    id: str
    category: str
    filename: str
    display_name: str
    urls: list[str]
    total_bytes: int = 0
    bytes_done: int = 0
    status: str = "queued"
    error_msg: Optional[str] = None
    priority: int = 0
    part_current: int = 1
    part_total: int = 1
    created_at: str = ""
    updated_at: str = ""
    completed_at: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None

    @property
    def percent(self) -> float:
        if self.total_bytes <= 0:
            return 0.0
        return min(100.0, self.bytes_done / self.total_bytes * 100)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["percent"] = self.percent
        return d


@dataclass
class ProgressEvent:
    """Emitted on every meaningful progress tick and status change."""
    id: str
    category: str
    filename: str
    display_name: str
    status: str
    bytes_done: int
    total_bytes: int
    percent: float
    part_current: int
    part_total: int
    speed_bps: float = 0.0
    eta_seconds: Optional[float] = None
    error_msg: Optional[str] = None

    def to_sse(self) -> str:
        payload = json.dumps(asdict(self))
        return f"data: {payload}\n\n"


# SSE subscriber queue type
_Subscriber = asyncio.Queue[str]


class DownloadManager:
    """Singleton download queue manager."""

    def __init__(self) -> None:
        self._entries: dict[str, DownloadEntry] = {}
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._subscribers: list[_Subscriber] = []
        self._cancel_flags: dict[str, asyncio.Event] = {}
        self._worker_task: Optional[asyncio.Task[None]] = None
        self._started = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Start the background worker and re-queue any incomplete downloads."""
        if self._started:
            return
        self._started = True
        await self._load_history()
        await self._resume_incomplete()
        self._worker_task = asyncio.create_task(self._worker(), name="download-manager-worker")
        logger.info("[downloads] Manager started")

    async def stop(self) -> None:
        """Gracefully stop the worker (called during app shutdown)."""
        if self._worker_task and not self._worker_task.done():
            self._worker_task.cancel()
            try:
                await asyncio.wait_for(self._worker_task, timeout=3.0)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
        logger.info("[downloads] Manager stopped")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def enqueue(
        self,
        *,
        category: str,
        filename: str,
        display_name: str,
        urls: list[str],
        metadata: Optional[dict[str, Any]] = None,
        priority: int = 0,
        download_id: Optional[str] = None,
    ) -> DownloadEntry:
        """Add a download to the queue (idempotent by filename+category)."""
        # Idempotency: skip if already queued/active/completed for this file
        for entry in self._entries.values():
            if entry.filename == filename and entry.category == category:
                if entry.status in ("queued", "active"):
                    logger.debug("[downloads] Already queued: %s", filename)
                    return entry
                if entry.status == "completed":
                    logger.debug("[downloads] Already completed: %s", filename)
                    return entry

        dl_id = download_id or str(uuid.uuid4())
        now = _now()
        entry = DownloadEntry(
            id=dl_id,
            category=category,
            filename=filename,
            display_name=display_name,
            urls=urls,
            status="queued",
            priority=priority,
            created_at=now,
            updated_at=now,
            metadata=metadata,
        )

        await self._persist(entry)
        self._entries[dl_id] = entry
        self._cancel_flags[dl_id] = asyncio.Event()

        await self._broadcast(ProgressEvent(
            id=dl_id,
            category=category,
            filename=filename,
            display_name=display_name,
            status="queued",
            bytes_done=0,
            total_bytes=0,
            percent=0.0,
            part_current=1,
            part_total=len(urls) or 1,
        ))

        await self._queue.put(dl_id)
        logger.info("[downloads] Enqueued: %s (%s)", filename, category)
        return entry

    async def cancel(self, download_id: str) -> bool:
        """Request cancellation of a queued or active download."""
        entry = self._entries.get(download_id)
        if not entry:
            return False
        if entry.status not in ("queued", "active"):
            return False

        flag = self._cancel_flags.get(download_id)
        if flag:
            flag.set()

        entry.status = "cancelled"
        entry.updated_at = _now()
        await self._persist(entry)

        await self._broadcast(ProgressEvent(
            id=download_id,
            category=entry.category,
            filename=entry.filename,
            display_name=entry.display_name,
            status="cancelled",
            bytes_done=entry.bytes_done,
            total_bytes=entry.total_bytes,
            percent=entry.percent,
            part_current=entry.part_current,
            part_total=entry.part_total,
        ))
        logger.info("[downloads] Cancelled: %s", entry.filename)
        return True

    def get_all(self, status: Optional[str] = None, category: Optional[str] = None) -> list[DownloadEntry]:
        entries = list(self._entries.values())
        if status:
            entries = [e for e in entries if e.status == status]
        if category:
            entries = [e for e in entries if e.category == category]
        entries.sort(key=lambda e: (
            0 if e.status == "active" else
            1 if e.status == "queued" else
            2 if e.status == "failed" else
            3,
            e.created_at,
        ))
        return entries

    def subscribe(self) -> _Subscriber:
        """Open a new SSE subscription queue."""
        q: _Subscriber = asyncio.Queue()
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: _Subscriber) -> None:
        try:
            self._subscribers.remove(q)
        except ValueError:
            pass

    async def sse_stream(self) -> AsyncIterator[str]:
        """Async generator of SSE-formatted strings for GET /downloads/stream."""
        q = self.subscribe()
        try:
            # Send a snapshot of current state immediately on connect
            for entry in self.get_all():
                yield ProgressEvent(
                    id=entry.id,
                    category=entry.category,
                    filename=entry.filename,
                    display_name=entry.display_name,
                    status=entry.status,
                    bytes_done=entry.bytes_done,
                    total_bytes=entry.total_bytes,
                    percent=entry.percent,
                    part_current=entry.part_current,
                    part_total=entry.part_total,
                    error_msg=entry.error_msg,
                ).to_sse()

            # Yield keep-alive pings every 20s to prevent proxy/browser timeouts
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=20.0)
                    yield msg
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            self.unsubscribe(q)

    # ------------------------------------------------------------------
    # Internal: worker
    # ------------------------------------------------------------------

    async def _worker(self) -> None:
        """Single-worker loop — downloads one file at a time."""
        while True:
            try:
                dl_id = await self._queue.get()
            except asyncio.CancelledError:
                break

            entry = self._entries.get(dl_id)
            if not entry:
                continue
            if entry.status in ("cancelled", "completed"):
                continue

            cancel_flag = self._cancel_flags.get(dl_id, asyncio.Event())
            if cancel_flag.is_set():
                continue

            entry.status = "active"
            entry.updated_at = _now()
            await self._persist(entry)

            await self._broadcast(ProgressEvent(
                id=dl_id,
                category=entry.category,
                filename=entry.filename,
                display_name=entry.display_name,
                status="active",
                bytes_done=entry.bytes_done,
                total_bytes=entry.total_bytes,
                percent=entry.percent,
                part_current=entry.part_current,
                part_total=entry.part_total,
            ))

            try:
                await self._download(entry, cancel_flag)
            except Exception as exc:
                if entry.status not in ("cancelled", "completed"):
                    entry.status = "failed"
                    entry.error_msg = str(exc)
                    entry.updated_at = _now()
                    await self._persist(entry)
                    await self._broadcast(ProgressEvent(
                        id=dl_id,
                        category=entry.category,
                        filename=entry.filename,
                        display_name=entry.display_name,
                        status="failed",
                        bytes_done=entry.bytes_done,
                        total_bytes=entry.total_bytes,
                        percent=entry.percent,
                        part_current=entry.part_current,
                        part_total=entry.part_total,
                        error_msg=str(exc),
                    ))
                    logger.error("[downloads] Failed: %s — %s", entry.filename, exc)

    async def _download(self, entry: DownloadEntry, cancel_flag: asyncio.Event) -> None:
        """Download all URL parts for a single entry with streaming progress."""
        urls = entry.urls
        if not urls:
            raise ValueError("No URLs provided for download")

        entry.part_total = len(urls)
        total_known = entry.total_bytes

        # Phase 1: HEAD requests to determine total size (best-effort)
        if total_known <= 0:
            total_known = await _probe_total_bytes(urls)
            entry.total_bytes = total_known
            await self._persist_progress(entry)

        bytes_before_this_part = 0
        max_retries = 3

        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(connect=30.0, read=120.0, write=30.0, pool=30.0),
        ) as client:
            for part_idx, url in enumerate(urls):
                entry.part_current = part_idx + 1
                entry.updated_at = _now()

                last_error: Optional[Exception] = None
                for attempt in range(max_retries):
                    if cancel_flag.is_set():
                        entry.status = "cancelled"
                        entry.updated_at = _now()
                        await self._persist(entry)
                        return

                    if attempt > 0:
                        await asyncio.sleep(2 ** attempt)

                    try:
                        part_bytes = await self._download_part(
                            client=client,
                            url=url,
                            entry=entry,
                            bytes_before=bytes_before_this_part,
                            cancel_flag=cancel_flag,
                        )
                        bytes_before_this_part += part_bytes
                        last_error = None
                        break
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:
                        last_error = exc
                        logger.warning(
                            "[downloads] Attempt %d/%d failed for %s part %d: %s",
                            attempt + 1, max_retries, entry.filename, part_idx + 1, exc,
                        )

                if last_error is not None:
                    raise RuntimeError(
                        f"Download failed after {max_retries} attempts. Last error: {last_error}"
                    )

        entry.status = "completed"
        entry.bytes_done = entry.total_bytes if entry.total_bytes > 0 else bytes_before_this_part
        entry.completed_at = _now()
        entry.updated_at = _now()
        await self._persist(entry)

        await self._broadcast(ProgressEvent(
            id=entry.id,
            category=entry.category,
            filename=entry.filename,
            display_name=entry.display_name,
            status="completed",
            bytes_done=entry.bytes_done,
            total_bytes=entry.total_bytes,
            percent=100.0,
            part_current=entry.part_total,
            part_total=entry.part_total,
        ))
        logger.info("[downloads] Completed: %s", entry.filename)

    async def _download_part(
        self,
        *,
        client: httpx.AsyncClient,
        url: str,
        entry: DownloadEntry,
        bytes_before: int,
        cancel_flag: asyncio.Event,
    ) -> int:
        """Stream a single URL, updating entry progress on every chunk.
        Returns the number of bytes downloaded for this part."""
        async with client.stream("GET", url) as response:
            response.raise_for_status()

            part_total = int(response.headers.get("content-length", 0))
            if part_total and entry.total_bytes <= 0:
                entry.total_bytes = part_total
                await self._persist_progress(entry)

            part_bytes_done = 0
            start_time = time.monotonic()
            last_emit_bytes = 0
            speed_bps = 0.0

            async for chunk in response.aiter_bytes(chunk_size=65536):
                if cancel_flag.is_set():
                    raise asyncio.CancelledError()

                part_bytes_done += len(chunk)
                entry.bytes_done = bytes_before + part_bytes_done
                entry.updated_at = _now()

                elapsed = time.monotonic() - start_time
                if elapsed > 0:
                    speed_bps = entry.bytes_done / elapsed

                # Emit only once per _PROGRESS_CHUNK_BYTES to avoid flooding
                if entry.bytes_done - last_emit_bytes >= _PROGRESS_CHUNK_BYTES:
                    last_emit_bytes = entry.bytes_done
                    await self._persist_progress(entry)

                    remaining = entry.total_bytes - entry.bytes_done
                    eta: Optional[float] = None
                    if speed_bps > 0 and remaining > 0:
                        eta = remaining / speed_bps

                    await self._broadcast(ProgressEvent(
                        id=entry.id,
                        category=entry.category,
                        filename=entry.filename,
                        display_name=entry.display_name,
                        status="active",
                        bytes_done=entry.bytes_done,
                        total_bytes=entry.total_bytes,
                        percent=entry.percent,
                        part_current=entry.part_current,
                        part_total=entry.part_total,
                        speed_bps=speed_bps,
                        eta_seconds=eta,
                    ))

            return part_bytes_done

    # ------------------------------------------------------------------
    # Internal: persistence
    # ------------------------------------------------------------------

    async def _persist(self, entry: DownloadEntry) -> None:
        """Write or update the full row for an entry."""
        try:
            db = get_db()
            await db.execute(
                """
                INSERT INTO downloads
                    (id, category, filename, display_name, urls,
                     total_bytes, bytes_done, status, error_msg,
                     priority, part_current, part_total,
                     created_at, updated_at, completed_at, metadata)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                    status       = excluded.status,
                    bytes_done   = excluded.bytes_done,
                    total_bytes  = excluded.total_bytes,
                    error_msg    = excluded.error_msg,
                    part_current = excluded.part_current,
                    part_total   = excluded.part_total,
                    updated_at   = excluded.updated_at,
                    completed_at = excluded.completed_at,
                    metadata     = excluded.metadata
                """,
                (
                    entry.id,
                    entry.category,
                    entry.filename,
                    entry.display_name,
                    json.dumps(entry.urls),
                    entry.total_bytes,
                    entry.bytes_done,
                    entry.status,
                    entry.error_msg,
                    entry.priority,
                    entry.part_current,
                    entry.part_total,
                    entry.created_at or _now(),
                    entry.updated_at or _now(),
                    entry.completed_at,
                    json.dumps(entry.metadata) if entry.metadata else None,
                ),
            )
            await db.commit()
        except Exception:
            logger.debug("[downloads] DB persist failed for %s", entry.id, exc_info=True)

    async def _persist_progress(self, entry: DownloadEntry) -> None:
        """Lightweight progress-only update (only writes byte counters + status)."""
        try:
            db = get_db()
            await db.execute(
                "UPDATE downloads SET bytes_done=?, total_bytes=?, part_current=?, updated_at=? WHERE id=?",
                (entry.bytes_done, entry.total_bytes, entry.part_current, _now(), entry.id),
            )
            await db.commit()
        except Exception:
            logger.debug("[downloads] DB progress update failed for %s", entry.id, exc_info=True)

    async def _resume_incomplete(self) -> None:
        """On startup, reset 'active' rows to 'queued' and re-add them to the worker queue."""
        try:
            db = get_db()
            rows = await db.fetchall(
                "SELECT * FROM downloads WHERE status IN ('queued', 'active') ORDER BY priority DESC, created_at ASC"
            )
            for row in rows:
                dl_id = row["id"]
                urls = json.loads(row["urls"] or "[]")
                metadata_raw = row["metadata"]
                metadata = json.loads(metadata_raw) if metadata_raw else None
                entry = DownloadEntry(
                    id=dl_id,
                    category=row["category"],
                    filename=row["filename"],
                    display_name=row["display_name"],
                    urls=urls,
                    total_bytes=row["total_bytes"],
                    bytes_done=0,  # Restart from beginning
                    status="queued",
                    error_msg=None,
                    priority=row["priority"],
                    part_current=1,
                    part_total=row["part_total"],
                    created_at=row["created_at"],
                    updated_at=_now(),
                    metadata=metadata,
                )
                # Reset to queued in DB
                await db.execute(
                    "UPDATE downloads SET status='queued', bytes_done=0, part_current=1, updated_at=? WHERE id=?",
                    (_now(), dl_id),
                )
                self._entries[dl_id] = entry
                self._cancel_flags[dl_id] = asyncio.Event()
                await self._queue.put(dl_id)
                logger.info("[downloads] Resuming incomplete download: %s", entry.filename)

            await db.commit()
        except Exception:
            logger.warning("[downloads] Failed to resume incomplete downloads", exc_info=True)

    async def _load_history(self) -> None:
        """Load completed/failed/cancelled history rows for the UI (last 50)."""
        try:
            db = get_db()
            rows = await db.fetchall(
                "SELECT * FROM downloads WHERE status IN ('completed','failed','cancelled') ORDER BY updated_at DESC LIMIT 50"
            )
            for row in rows:
                if row["id"] in self._entries:
                    continue
                urls = json.loads(row["urls"] or "[]")
                metadata_raw = row["metadata"]
                metadata = json.loads(metadata_raw) if metadata_raw else None
                entry = DownloadEntry(
                    id=row["id"],
                    category=row["category"],
                    filename=row["filename"],
                    display_name=row["display_name"],
                    urls=urls,
                    total_bytes=row["total_bytes"],
                    bytes_done=row["bytes_done"],
                    status=row["status"],
                    error_msg=row["error_msg"],
                    priority=row["priority"],
                    part_current=row["part_current"],
                    part_total=row["part_total"],
                    created_at=row["created_at"],
                    updated_at=row["updated_at"],
                    completed_at=row["completed_at"],
                    metadata=metadata,
                )
                self._entries[row["id"]] = entry
        except Exception:
            logger.debug("[downloads] Failed to load history", exc_info=True)

    # ------------------------------------------------------------------
    # Internal: SSE broadcast
    # ------------------------------------------------------------------

    async def _broadcast(self, event: ProgressEvent) -> None:
        msg = event.to_sse()
        for q in list(self._subscribers):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                pass


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


async def _probe_total_bytes(urls: list[str]) -> int:
    """HEAD each URL and sum the content-length values to get total expected bytes."""
    total = 0
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
            for url in urls:
                try:
                    resp = await client.head(url)
                    cl = int(resp.headers.get("content-length", 0))
                    total += cl
                except Exception:
                    pass
    except Exception:
        pass
    return total


# ------------------------------------------------------------------
# Singleton
# ------------------------------------------------------------------

_instance: Optional[DownloadManager] = None


def get_download_manager() -> DownloadManager:
    global _instance
    if _instance is None:
        _instance = DownloadManager()
    return _instance
