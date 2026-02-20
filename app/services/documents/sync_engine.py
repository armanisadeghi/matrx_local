"""Document sync engine — bidirectional sync between local .md files and Supabase.

Handles:
- Push: local changes → Supabase
- Pull: Supabase changes → local files
- Full reconciliation on startup
- Conflict detection and flagging
- File watcher integration for external edits
- Directory mapping sync (canonical → additional targets)
"""

from __future__ import annotations

import asyncio
import logging
import platform
import time
import uuid
from pathlib import Path
from typing import Any

from app.services.documents.file_manager import DocumentFileManager, content_hash, file_manager
from app.services.documents.supabase_client import SupabaseDocClient, supabase_docs

logger = logging.getLogger(__name__)


class SyncEngine:
    """Coordinates sync between local documents and Supabase."""

    def __init__(
        self,
        fm: DocumentFileManager | None = None,
        sb: SupabaseDocClient | None = None,
    ) -> None:
        self.fm = fm or file_manager
        self.sb = sb or supabase_docs
        self._device_id: str | None = None
        self._user_id: str | None = None
        self._watch_task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._sync_lock = asyncio.Lock()
        self._last_push_hashes: dict[str, str] = {}

    @property
    def device_id(self) -> str:
        if not self._device_id:
            state = self.fm.load_sync_state()
            if state.get("device_id"):
                self._device_id = state["device_id"]
            else:
                self._device_id = str(uuid.uuid4())[:12]
                state["device_id"] = self._device_id
                self.fm.save_sync_state(state)
        return self._device_id

    def configure(self, user_id: str, jwt: str) -> None:
        """Set user context for sync operations."""
        self._user_id = user_id
        self.sb.set_jwt(jwt)

    @property
    def is_configured(self) -> bool:
        return bool(self._user_id and self.sb.available)

    # ── Push: local → Supabase ───────────────────────────────────────────────

    async def push_note(
        self,
        note_id: str,
        label: str,
        content: str,
        folder_name: str = "General",
        folder_id: str | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Create or update a note both locally and in Supabase."""
        if not self._user_id:
            raise RuntimeError("Sync engine not configured — call configure() first")

        # Write to local file
        file_path = self.fm.write_note(folder_name, label, content)
        c_hash = content_hash(content)

        # Check if note exists in Supabase
        existing = await self.sb.get_note(note_id)

        if existing:
            # Get current version count for versioning
            versions = await self.sb.list_versions(note_id)
            next_version = (versions[0]["version_number"] + 1) if versions else 1

            # Create version snapshot before updating
            if existing.get("content") and existing["content"] != content:
                await self.sb.create_version(
                    note_id=note_id,
                    user_id=self._user_id,
                    content=existing["content"],
                    label=existing.get("label", label),
                    version_number=next_version,
                    change_source="desktop",
                    change_type="edit",
                )

            # Update note
            result = await self.sb.update_note(
                note_id,
                {
                    "label": label,
                    "content": content,
                    "folder_name": folder_name,
                    "folder_id": folder_id,
                    "file_path": file_path,
                    "tags": tags or [],
                    "metadata": metadata or {},
                },
                device_id=self.device_id,
            )
        else:
            # Create new note
            result = await self.sb.create_note(
                user_id=self._user_id,
                label=label,
                content=content,
                folder_name=folder_name,
                folder_id=folder_id,
                file_path=file_path,
                tags=tags,
                metadata=metadata,
                device_id=self.device_id,
            )

        # Track push hash to avoid echo when file watcher detects our own write
        self._last_push_hashes[file_path] = c_hash

        # Sync to mapped directories
        await self._sync_mappings(file_path, folder_id)

        # Log sync
        if self.sb.available:
            await self.sb.log_sync(
                user_id=self._user_id,
                device_id=self.device_id,
                action="push",
                note_id=note_id,
                sync_version=result.get("sync_version"),
                content_hash=c_hash,
            )

        # Update local sync state
        state = self.fm.load_sync_state()
        state["note_hashes"][file_path] = c_hash
        sv = result.get("sync_version", 0)
        if sv and sv > state.get("last_sync_version", 0):
            state["last_sync_version"] = sv
        self.fm.save_sync_state(state)

        return result

    # ── Pull: Supabase → local ───────────────────────────────────────────────

    async def pull_note(self, note_id: str) -> dict[str, Any] | None:
        """Pull a single note from Supabase and write to local file."""
        if not self._user_id:
            return None

        note = await self.sb.get_note(note_id)
        if not note:
            return None

        content = note.get("content", "")
        label = note.get("label", "Untitled")
        folder_name = note.get("folder_name", "General")
        file_path = note.get("file_path")

        # Check for local conflict
        if file_path:
            local_hash = self.fm.note_hash(file_path)
            remote_hash = note.get("content_hash")
            state = self.fm.load_sync_state()
            last_known_hash = state.get("note_hashes", {}).get(file_path)

            if (
                local_hash
                and remote_hash
                and local_hash != remote_hash
                and last_known_hash
                and local_hash != last_known_hash
            ):
                # Both sides changed since last sync — conflict
                local_content = self.fm.read_note(file_path) or ""
                self.fm.save_conflict(
                    file_path, local_content, content, note_id
                )
                logger.warning(
                    "Sync conflict detected for %s (note %s)", file_path, note_id
                )
                if self.sb.available:
                    await self.sb.log_sync(
                        user_id=self._user_id,
                        device_id=self.device_id,
                        action="conflict_detected",
                        note_id=note_id,
                        content_hash=remote_hash,
                        details={
                            "local_hash": local_hash,
                            "remote_hash": remote_hash,
                        },
                    )
                return {**note, "_conflict": True}

        # Write to local file
        file_path = self.fm.write_note(folder_name, label, content, file_path)
        c_hash = content_hash(content)

        # Track to avoid echo
        self._last_push_hashes[file_path] = c_hash

        # Update sync state
        state = self.fm.load_sync_state()
        state["note_hashes"][file_path] = c_hash
        sv = note.get("sync_version", 0)
        if sv and sv > state.get("last_sync_version", 0):
            state["last_sync_version"] = sv
        self.fm.save_sync_state(state)

        # Sync to mapped directories
        folder_id = note.get("folder_id")
        await self._sync_mappings(file_path, folder_id)

        return note

    async def pull_changes(self) -> dict[str, Any]:
        """Pull all notes changed since last sync."""
        if not self._user_id:
            return {"pulled": 0, "conflicts": 0}

        state = self.fm.load_sync_state()
        last_version = state.get("last_sync_version", 0)

        notes = await self.sb.get_notes_since(self._user_id, last_version)

        pulled = 0
        conflicts = 0
        for note in notes:
            # Skip notes we just pushed
            fp = note.get("file_path")
            if fp and self._last_push_hashes.get(fp) == note.get("content_hash"):
                continue

            result = await self.pull_note(note["id"])
            if result:
                pulled += 1
                if result.get("_conflict"):
                    conflicts += 1

        return {"pulled": pulled, "conflicts": conflicts}

    # ── Full reconciliation ──────────────────────────────────────────────────

    async def full_sync(self) -> dict[str, Any]:
        """Full bidirectional sync.

        1. Get all notes from Supabase with hashes
        2. Scan all local .md files
        3. Push local-only files to Supabase
        4. Pull remote-only files to local
        5. Detect conflicts for files changed on both sides
        """
        async with self._sync_lock:
            if not self._user_id:
                return {"error": "Not configured"}

            stats = {
                "pushed": 0,
                "pulled": 0,
                "conflicts": 0,
                "unchanged": 0,
                "deleted_local": 0,
            }

            # Get remote state
            remote_notes = await self.sb.get_all_notes_with_hashes(self._user_id)
            remote_by_path: dict[str, dict] = {}
            remote_by_id: dict[str, dict] = {}
            for n in remote_notes:
                if n.get("file_path"):
                    remote_by_path[n["file_path"]] = n
                remote_by_id[n["id"]] = n

            # Get local state
            local_files = self.fm.scan_all()
            local_by_path: dict[str, dict] = {f["file_path"]: f for f in local_files}

            state = self.fm.load_sync_state()
            known_hashes = state.get("note_hashes", {})

            # ── Compare and sync ──

            # Files that exist remotely
            for fp, remote in remote_by_path.items():
                local = local_by_path.get(fp)

                if local is None:
                    # Remote-only → pull
                    await self.pull_note(remote["id"])
                    stats["pulled"] += 1

                elif local["content_hash"] == remote.get("content_hash"):
                    # Same content → no action
                    stats["unchanged"] += 1

                elif known_hashes.get(fp) == local["content_hash"]:
                    # Local unchanged since last sync, remote changed → pull
                    await self.pull_note(remote["id"])
                    stats["pulled"] += 1

                elif known_hashes.get(fp) == remote.get("content_hash"):
                    # Remote unchanged since last sync, local changed → push
                    content = self.fm.read_note(fp)
                    if content is not None:
                        await self.push_note(
                            note_id=remote["id"],
                            label=remote.get("label", local["label"]),
                            content=content,
                            folder_name=remote.get("folder_name", "General"),
                            folder_id=remote.get("folder_id"),
                        )
                        stats["pushed"] += 1
                else:
                    # Both changed → conflict
                    local_content = self.fm.read_note(fp) or ""
                    full_note = await self.sb.get_note(remote["id"])
                    remote_content = full_note.get("content", "") if full_note else ""
                    self.fm.save_conflict(
                        fp, local_content, remote_content, remote["id"]
                    )
                    stats["conflicts"] += 1

            # Files that exist only locally
            for fp, local in local_by_path.items():
                if fp not in remote_by_path:
                    # Local-only → push new note to Supabase
                    content = self.fm.read_note(fp)
                    if content is not None:
                        parts = Path(fp).parts
                        folder = parts[0] if len(parts) > 1 else "General"
                        note_id = str(uuid.uuid4())
                        await self.push_note(
                            note_id=note_id,
                            label=local["label"],
                            content=content,
                            folder_name=folder,
                        )
                        stats["pushed"] += 1

            # Update last sync timestamp
            state["last_full_sync"] = time.time()
            max_sv = max(
                (n.get("sync_version", 0) for n in remote_notes),
                default=state.get("last_sync_version", 0),
            )
            state["last_sync_version"] = max_sv
            self.fm.save_sync_state(state)

            if self.sb.available:
                await self.sb.log_sync(
                    user_id=self._user_id,
                    device_id=self.device_id,
                    action="full_sync",
                    details=stats,
                )

            return stats

    # ── Directory mapping sync ───────────────────────────────────────────────

    async def _sync_mappings(
        self, file_path: str, folder_id: str | None
    ) -> None:
        """Copy a note to all mapped directories for its folder."""
        if not folder_id:
            return

        local_mappings = self.fm.load_local_mappings()
        mapped_paths = local_mappings.get(folder_id, [])
        if mapped_paths:
            self.fm.sync_to_mapped_dirs(file_path, mapped_paths)

    # ── Device registration ──────────────────────────────────────────────────

    async def register_device(self) -> dict[str, Any]:
        """Register this device with Supabase."""
        if not self._user_id or not self.sb.available:
            return {}

        return await self.sb.register_device(
            user_id=self._user_id,
            device_id=self.device_id,
            device_name=platform.node() or "Unknown",
            platform=platform.system(),
            base_path=str(self.fm.base_dir),
        )

    # ── File watcher integration ─────────────────────────────────────────────

    async def start_watcher(self) -> None:
        """Start watching the documents directory for external changes."""
        if self._watch_task and not self._watch_task.done():
            return

        self._stop_event.clear()
        self._watch_task = asyncio.create_task(self._watch_loop())
        logger.info("Document file watcher started: %s", self.fm.base_dir)

    async def stop_watcher(self) -> None:
        """Stop the file watcher."""
        self._stop_event.set()
        if self._watch_task:
            self._watch_task.cancel()
            try:
                await self._watch_task
            except asyncio.CancelledError:
                pass
            self._watch_task = None
        logger.info("Document file watcher stopped")

    async def _watch_loop(self) -> None:
        """Watch for file changes and push to Supabase."""
        try:
            import watchfiles

            async for changes in watchfiles.awatch(
                str(self.fm.base_dir),
                recursive=True,
                stop_event=self._stop_event,
            ):
                if not self.is_configured:
                    continue

                for change_type, change_path in changes:
                    # Only process .md files outside .sync
                    path = Path(change_path)
                    if not path.suffix == ".md":
                        continue
                    if ".sync" in path.parts:
                        continue

                    try:
                        rel_path = self.fm.relative_path(path)
                    except ValueError:
                        continue

                    # Skip our own writes
                    if path.is_file():
                        current_hash = content_hash(
                            path.read_text(encoding="utf-8")
                        )
                        if self._last_push_hashes.get(rel_path) == current_hash:
                            continue

                    # Debounce: wait a moment for editor save to complete
                    await asyncio.sleep(0.5)

                    if change_type == watchfiles.Change.deleted:
                        logger.info("External delete detected: %s", rel_path)
                        # Don't auto-delete from Supabase — just log
                    else:
                        logger.info("External change detected: %s", rel_path)
                        await self._handle_external_change(rel_path)

        except ImportError:
            # Fallback: polling every 5 seconds
            logger.info("watchfiles not available, using polling for document watch")
            state = self.fm.load_sync_state()
            known = dict(state.get("note_hashes", {}))

            while not self._stop_event.is_set():
                await asyncio.sleep(5)
                if not self.is_configured:
                    continue

                current_files = self.fm.scan_all()
                for f in current_files:
                    fp = f["file_path"]
                    if f["content_hash"] != known.get(fp):
                        if self._last_push_hashes.get(fp) == f["content_hash"]:
                            known[fp] = f["content_hash"]
                            continue
                        logger.info("Polling detected change: %s", fp)
                        await self._handle_external_change(fp)
                        known[fp] = f["content_hash"]

        except asyncio.CancelledError:
            pass

    async def _handle_external_change(self, file_path: str) -> None:
        """Handle an externally modified .md file."""
        async with self._sync_lock:
            content = self.fm.read_note(file_path)
            if content is None:
                return

            c_hash = content_hash(content)
            state = self.fm.load_sync_state()

            # Find the corresponding note in Supabase by file_path
            if not self._user_id:
                return

            try:
                all_notes = await self.sb.get_all_notes_with_hashes(self._user_id)
                matching = [n for n in all_notes if n.get("file_path") == file_path]

                if matching:
                    note = matching[0]
                    if note.get("content_hash") == c_hash:
                        return  # Already up to date

                    await self.push_note(
                        note_id=note["id"],
                        label=note.get("label", Path(file_path).stem),
                        content=content,
                        folder_name=note.get("folder_name", "General"),
                        folder_id=note.get("folder_id"),
                    )
                else:
                    # New file not tracked in Supabase
                    parts = Path(file_path).parts
                    folder = parts[0] if len(parts) > 1 else "General"
                    note_id = str(uuid.uuid4())
                    await self.push_note(
                        note_id=note_id,
                        label=Path(file_path).stem,
                        content=content,
                        folder_name=folder,
                    )

                state["note_hashes"][file_path] = c_hash
                self.fm.save_sync_state(state)

            except Exception:
                logger.warning(
                    "Failed to push external change for %s", file_path, exc_info=True
                )

    # ── Conflict resolution ──────────────────────────────────────────────────

    async def resolve_conflict(
        self, note_id: str, resolution: str = "keep_remote"
    ) -> dict[str, Any] | None:
        """Resolve a sync conflict.

        resolution: 'keep_local', 'keep_remote', or 'keep_both'
        """
        if not self._user_id:
            return None

        conflict_dir = self.fm.base_dir / ".sync" / "conflicts" / note_id
        if not conflict_dir.exists():
            return None

        local_content = (conflict_dir / "local.md").read_text(encoding="utf-8")
        remote_content = (conflict_dir / "remote.md").read_text(encoding="utf-8")

        note = await self.sb.get_note(note_id)
        if not note:
            self.fm.resolve_conflict(note_id)
            return None

        if resolution == "keep_local":
            result = await self.push_note(
                note_id=note_id,
                label=note["label"],
                content=local_content,
                folder_name=note.get("folder_name", "General"),
                folder_id=note.get("folder_id"),
            )
        elif resolution == "keep_remote":
            result = await self.pull_note(note_id)
        elif resolution == "keep_both":
            # Keep remote as-is, create a new note for local version
            result = await self.pull_note(note_id)
            new_id = str(uuid.uuid4())
            await self.push_note(
                note_id=new_id,
                label=f"{note['label']} (conflict copy)",
                content=local_content,
                folder_name=note.get("folder_name", "General"),
                folder_id=note.get("folder_id"),
            )
        else:
            return None

        self.fm.resolve_conflict(note_id)

        if self.sb.available:
            await self.sb.log_sync(
                user_id=self._user_id,
                device_id=self.device_id,
                action="conflict_resolved",
                note_id=note_id,
                details={"resolution": resolution},
            )

        return result

    # ── Status ───────────────────────────────────────────────────────────────

    def get_status(self) -> dict[str, Any]:
        state = self.fm.load_sync_state()
        conflicts = self.fm.list_conflicts()
        return {
            "configured": self.is_configured,
            "device_id": self.device_id,
            "last_sync_version": state.get("last_sync_version", 0),
            "last_full_sync": state.get("last_full_sync"),
            "tracked_files": len(state.get("note_hashes", {})),
            "conflicts": conflicts,
            "conflict_count": len(conflicts),
            "watcher_active": self._watch_task is not None
                              and not self._watch_task.done(),
            "base_dir": str(self.fm.base_dir),
        }


# Module-level singleton
sync_engine = SyncEngine()
