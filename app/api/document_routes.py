"""Notes management API routes.

Architecture: LOCAL FIRST. Always.

Every CRUD operation reads/writes the local filesystem immediately and returns
success to the caller. Supabase sync is kicked off as a background fire-and-
forget task — a failed or missing Supabase connection never causes a failure.

The user is always working with their local files. Sync happens when convenient.

Route prefix: /notes  (was /documents — kept as alias in main.py for compatibility)
"""

from __future__ import annotations

import asyncio
import base64
import json as _json
import logging
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from app.services.documents.file_manager import file_manager
from app.services.documents.supabase_client import supabase_docs
from app.services.documents.sync_engine import sync_engine

logger = logging.getLogger(__name__)

# Router registered under both /notes (new) and /documents (compat) in main.py
router = APIRouter(tags=["notes"])


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def _get_user_id(request: Request) -> str:
    """Extract user_id from the request. Raises 401 if not found.

    Only call this for operations that genuinely require a user identity
    (e.g. cloud sync, sharing). For local-only operations use
    _get_user_id_optional instead.
    """
    uid = _get_user_id_optional(request)
    if uid:
        return uid
    raise HTTPException(
        status_code=401,
        detail="Could not determine user identity — provide Authorization header or X-User-Id",
    )


def _get_user_id_optional(request: Request) -> str | None:
    """Extract user_id from the request without raising — returns None if missing.

    Safe to call on any request; used for local-first endpoints where auth is
    optional (enables background cloud sync when credentials are present but
    never blocks local file operations when they are not).
    """
    explicit = request.headers.get("X-User-Id")
    if explicit and explicit != "local":
        return explicit

    token = getattr(request.state, "user_token", None)
    if token:
        try:
            payload_b64 = token.split(".")[1]
            payload_b64 += "=" * (-len(payload_b64) % 4)
            payload = _json.loads(base64.urlsafe_b64decode(payload_b64))
            sub = payload.get("sub")
            if sub:
                return sub
        except Exception:
            pass

    return None


def _configure_sync(request: Request) -> None:
    """Configure the sync engine with the current user context (best-effort)."""
    try:
        user_id = _get_user_id(request)
        token = getattr(request.state, "user_token", None)
        if token:
            sync_engine.configure(user_id, token)
            supabase_docs.set_jwt(token)
    except HTTPException:
        pass  # Sync config is optional — don't fail the request


def _fire_and_forget(coro) -> None:
    """Schedule a coroutine as a background task, ignore all errors."""
    async def _safe():
        try:
            await coro
        except Exception as exc:
            logger.debug("Background sync task failed (non-critical): %s", exc)

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(_safe())
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class CreateFolderRequest(BaseModel):
    name: str
    parent_id: str | None = None


class UpdateFolderRequest(BaseModel):
    name: str | None = None
    parent_id: str | None = None
    path: str | None = None
    position: int | None = None


class CreateNoteRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    label: str = Field("New Note", validation_alias=AliasChoices("label", "title"))
    content: str = ""
    folder_name: str = "General"
    folder_id: str | None = None
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class UpdateNoteRequest(BaseModel):
    label: str | None = None
    content: str | None = None
    folder_name: str | None = None
    folder_id: str | None = None
    tags: list[str] | None = None
    metadata: dict[str, Any] | None = None
    position: int | None = None


class RevertRequest(BaseModel):
    version_number: int


class ShareRequest(BaseModel):
    note_id: str | None = None
    folder_id: str | None = None
    shared_with_id: str | None = None
    permission: str = "read"
    is_public: bool = False


class UpdateShareRequest(BaseModel):
    permission: str | None = None
    is_public: bool | None = None


class MappingRequest(BaseModel):
    folder_id: str
    local_path: str


class ConflictResolveRequest(BaseModel):
    resolution: str = "keep_remote"


class PullRemoteChangeRequest(BaseModel):
    note_id: str


# ---------------------------------------------------------------------------
# Folder helpers — local filesystem is the source of truth
# ---------------------------------------------------------------------------

def _local_folder_tree() -> dict[str, Any]:
    """Build folder tree by scanning the local Notes directory.

    Returns a structure compatible with the old Supabase-sourced tree so
    the frontend doesn't need any changes.
    """
    folders_raw = file_manager.list_folders()
    all_files = file_manager.scan_all()

    # Count notes per top-level folder
    folder_counts: dict[str, int] = {}
    for f in all_files:
        # file_path is like "Work/project-plan.md" — folder is the first segment
        parts = Path(f["file_path"]).parts
        folder_name = parts[0] if len(parts) > 1 else "__root__"
        folder_counts[folder_name] = folder_counts.get(folder_name, 0) + 1

    # Build flat list of folder objects with stable pseudo-UUIDs derived from name
    # (deterministic so the frontend can track them across refreshes)
    folders: list[dict[str, Any]] = []
    for name in folders_raw:
        folder_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"matrx-notes-folder:{name}"))
        folders.append({
            "id": folder_id,
            "name": name,
            "path": name,
            "parent_id": None,
            "position": 0,
            "is_deleted": False,
            "note_count": folder_counts.get(name, 0),
            "children": [],
            "_source": "local",
        })

    return {
        "folders": folders,
        "total_notes": len(all_files),
        "unfiled_notes": folder_counts.get("__root__", 0),
    }


def _note_id_for_path(file_path: str) -> str:
    """Generate a deterministic note ID from its relative file path."""
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"matrx-note:{file_path}"))


def _build_note_record(file_path: str, folder_name: str | None = None) -> dict[str, Any] | None:
    """Read a local note file and return a record compatible with the old API shape."""
    content = file_manager.read_note(file_path)
    if content is None:
        return None
    p = Path(file_path)
    folder = folder_name or (p.parts[0] if len(p.parts) > 1 else "General")
    return {
        "id": _note_id_for_path(file_path),
        "label": p.stem,
        "content": content,
        "folder_name": folder,
        "folder_id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"matrx-notes-folder:{folder}")),
        "file_path": file_path,
        "tags": [],
        "metadata": {},
        "content_hash": file_manager.note_hash(file_path),
        "sync_version": 1,
        "is_deleted": False,
        "_source": "local",
    }


# ---------------------------------------------------------------------------
# Folder endpoints
# ---------------------------------------------------------------------------

@router.get("/tree")
async def get_folder_tree(request: Request) -> dict[str, Any]:
    """Get folder tree — always from local filesystem."""
    _configure_sync(request)
    return _local_folder_tree()


@router.post("/folders")
async def create_folder(req: CreateFolderRequest, request: Request) -> dict[str, Any]:
    """Create a folder locally. Background-syncs to Supabase if available."""
    _configure_sync(request)
    user_id = _get_user_id_optional(request)

    # Build path: if parent specified, prefix with parent name
    path = req.name
    if req.parent_id:
        # Find parent by its deterministic ID
        folders = file_manager.list_folders()
        for f in folders:
            fid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"matrx-notes-folder:{f}"))
            if fid == req.parent_id:
                path = f"{f}/{req.name}"
                break

    # ── Local first ──────────────────────────────────────────────────────────
    local_path = file_manager.create_folder(path)
    folder_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"matrx-notes-folder:{path}"))

    result: dict[str, Any] = {
        "id": folder_id,
        "name": req.name,
        "path": path,
        "parent_id": req.parent_id,
        "position": 0,
        "is_deleted": False,
        "_source": "local",
    }

    # ── Fire-and-forget Supabase sync ─────────────────────────────────────────
    if sync_engine.is_configured and user_id:
        async def _sync_folder():
            await supabase_docs.create_folder(
                user_id=user_id,
                name=req.name,
                parent_id=req.parent_id,
                path=path,
            )
        _fire_and_forget(_sync_folder())

    return result


@router.put("/folders/{folder_id}")
async def update_folder(
    folder_id: str, req: UpdateFolderRequest, request: Request
) -> dict[str, Any]:
    """Rename a folder locally. Background-syncs to Supabase if available."""
    _configure_sync(request)

    # Rename on disk if name changed
    if req.name:
        # Find current folder name by its deterministic ID
        for f in file_manager.list_folders():
            fid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"matrx-notes-folder:{f}"))
            if fid == folder_id:
                new_path = file_manager.rename_folder(f, req.name)
                break

    updates: dict[str, Any] = {}
    if req.name is not None:
        updates["name"] = req.name
    if req.parent_id is not None:
        updates["parent_id"] = req.parent_id
    if req.path is not None:
        updates["path"] = req.path
    if req.position is not None:
        updates["position"] = req.position

    if updates and sync_engine.is_configured:
        _fire_and_forget(supabase_docs.update_folder(folder_id, updates))

    return {"id": folder_id, **updates, "_source": "local"}


@router.delete("/folders/{folder_id}")
async def delete_folder(folder_id: str, request: Request) -> dict[str, str]:
    """Delete a folder locally. Background-syncs soft-delete to Supabase."""
    _configure_sync(request)

    for f in file_manager.list_folders():
        fid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"matrx-notes-folder:{f}"))
        if fid == folder_id:
            file_manager.delete_folder(f)
            break

    if sync_engine.is_configured:
        _fire_and_forget(supabase_docs.delete_folder(folder_id))

    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Note endpoints
# ---------------------------------------------------------------------------

@router.get("/notes")
async def list_notes(
    request: Request,
    folder_id: str | None = None,
    search: str | None = None,
) -> list[dict[str, Any]]:
    """List notes — always from local filesystem."""
    _configure_sync(request)

    all_files = file_manager.scan_all()
    results: list[dict[str, Any]] = []

    for f in all_files:
        # Filter by folder if requested
        if folder_id:
            p = Path(f["file_path"])
            folder_name = p.parts[0] if len(p.parts) > 1 else "General"
            fid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"matrx-notes-folder:{folder_name}"))
            if fid != folder_id:
                continue

        # Filter by search
        if search:
            content = file_manager.read_note(f["file_path"]) or ""
            label = f.get("label", "")
            if search.lower() not in content.lower() and search.lower() not in label.lower():
                continue

        p = Path(f["file_path"])
        folder_name = p.parts[0] if len(p.parts) > 1 else "General"
        results.append({
            "id": _note_id_for_path(f["file_path"]),
            "label": f["label"],
            "folder_name": folder_name,
            "folder_id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"matrx-notes-folder:{folder_name}")),
            "file_path": f["file_path"],
            "content_hash": f["content_hash"],
            "tags": [],
            "metadata": {},
            "is_deleted": False,
            "_source": "local",
        })

    return results


@router.get("/notes/{note_id}")
async def get_note(note_id: str, request: Request) -> dict[str, Any]:
    """Get a note — reads local file. Falls back to Supabase if not found locally."""
    _configure_sync(request)

    # Find by deterministic ID
    for f in file_manager.scan_all():
        if _note_id_for_path(f["file_path"]) == note_id:
            record = _build_note_record(f["file_path"])
            if record:
                return record

    # Not found locally — try Supabase as fallback (e.g. note created on another device)
    if sync_engine.is_configured:
        remote = await supabase_docs.get_note(note_id)
        if remote:
            # Pull it locally for next time
            _fire_and_forget(sync_engine.pull_note(note_id))
            return remote

    raise HTTPException(status_code=404, detail="Note not found")


@router.post("/notes")
async def create_note(req: CreateNoteRequest, request: Request) -> dict[str, Any]:
    """Create a note locally. Background-syncs to Supabase."""
    _configure_sync(request)
    user_id = _get_user_id_optional(request)
    note_id = str(uuid.uuid4())

    # ── Local first ──────────────────────────────────────────────────────────
    file_path = file_manager.write_note(req.folder_name, req.label, req.content)

    result: dict[str, Any] = {
        "id": note_id,
        "label": req.label,
        "content": req.content,
        "folder_name": req.folder_name,
        "folder_id": req.folder_id,
        "file_path": file_path,
        "tags": req.tags,
        "metadata": req.metadata,
        "content_hash": file_manager.note_hash(file_path),
        "_synced_to_cloud": False,
        "_source": "local",
    }

    # ── Fire-and-forget Supabase sync ─────────────────────────────────────────
    if sync_engine.is_configured and user_id:
        _fire_and_forget(sync_engine.push_note(
            note_id=note_id,
            label=req.label,
            content=req.content,
            folder_name=req.folder_name,
            folder_id=req.folder_id,
            tags=req.tags,
            metadata=req.metadata,
            is_new_note=True,
        ))

    return result


@router.put("/notes/{note_id}")
async def update_note(
    note_id: str, req: UpdateNoteRequest, request: Request
) -> dict[str, Any]:
    """Update a note locally. Background-syncs to Supabase."""
    _configure_sync(request)

    # Find the existing local file
    existing_record: dict[str, Any] | None = None
    for f in file_manager.scan_all():
        if _note_id_for_path(f["file_path"]) == note_id:
            existing_record = _build_note_record(f["file_path"])
            break

    if existing_record is None:
        # Try Supabase as fallback (note may have been created on another device)
        if sync_engine.is_configured:
            existing_record = await supabase_docs.get_note(note_id)
        if existing_record is None:
            raise HTTPException(status_code=404, detail="Note not found")

    label = req.label if req.label is not None else existing_record.get("label", "")
    content = req.content if req.content is not None else existing_record.get("content", "")
    folder_name = req.folder_name if req.folder_name is not None else existing_record.get("folder_name", "General")
    folder_id = req.folder_id if req.folder_id is not None else existing_record.get("folder_id")
    tags = req.tags if req.tags is not None else existing_record.get("tags", [])
    metadata = req.metadata if req.metadata is not None else existing_record.get("metadata", {})

    # ── Local first ──────────────────────────────────────────────────────────
    old_file_path = existing_record.get("file_path", "")
    file_path = file_manager.write_note(folder_name, label, content, old_file_path if old_file_path else None)

    result: dict[str, Any] = {
        "id": note_id,
        "label": label,
        "content": content,
        "folder_name": folder_name,
        "folder_id": folder_id,
        "file_path": file_path,
        "tags": tags,
        "metadata": metadata,
        "content_hash": file_manager.note_hash(file_path),
        "_synced_to_cloud": False,
        "_source": "local",
    }

    # ── Fire-and-forget Supabase sync ─────────────────────────────────────────
    if sync_engine.is_configured:
        _fire_and_forget(sync_engine.push_note(
            note_id=note_id,
            label=label,
            content=content,
            folder_name=folder_name,
            folder_id=folder_id,
            tags=tags,
            metadata=metadata,
        ))

    return result


@router.delete("/notes/{note_id}")
async def delete_note(note_id: str, request: Request) -> dict[str, str]:
    """Delete a note locally. Background soft-deletes in Supabase."""
    _configure_sync(request)

    for f in file_manager.scan_all():
        if _note_id_for_path(f["file_path"]) == note_id:
            file_manager.delete_note(f["file_path"])
            break

    if sync_engine.is_configured:
        _fire_and_forget(supabase_docs.soft_delete_note(note_id))

    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Version endpoints (Supabase-only — version history lives in the cloud)
# ---------------------------------------------------------------------------

@router.get("/notes/{note_id}/versions")
async def list_versions(note_id: str, request: Request) -> list[dict[str, Any]]:
    _configure_sync(request)
    if not sync_engine.is_configured:
        return []
    return await supabase_docs.list_versions(note_id)


@router.post("/notes/{note_id}/revert")
async def revert_note(note_id: str, req: RevertRequest, request: Request) -> dict[str, Any]:
    _configure_sync(request)
    user_id = _get_user_id(request)

    if not sync_engine.is_configured:
        raise HTTPException(status_code=503, detail="Cloud sync not configured — cannot revert to version")

    version = await supabase_docs.get_version(note_id, req.version_number)
    if not version:
        raise HTTPException(status_code=404, detail=f"Version {req.version_number} not found")

    existing = await supabase_docs.get_note(note_id)
    folder_name = existing.get("folder_name", "General") if existing else "General"
    folder_id = existing.get("folder_id") if existing else None

    # Write old content locally, then push to Supabase
    file_path = file_manager.write_note(folder_name, version["label"], version["content"])
    result: dict[str, Any] = {
        "id": note_id,
        "label": version["label"],
        "content": version["content"],
        "folder_name": folder_name,
        "folder_id": folder_id,
        "file_path": file_path,
        "_source": "local",
    }

    _fire_and_forget(sync_engine.push_note(
        note_id=note_id,
        label=version["label"],
        content=version["content"],
        folder_name=folder_name,
        folder_id=folder_id,
    ))

    return result


# ---------------------------------------------------------------------------
# Sync endpoints — explicit user-triggered sync operations
# ---------------------------------------------------------------------------

@router.get("/sync/status")
async def sync_status(request: Request) -> dict[str, Any]:
    _configure_sync(request)
    return sync_engine.get_status()


@router.post("/sync/trigger")
async def trigger_sync(request: Request) -> dict[str, Any]:
    """Full bidirectional sync — user-triggered only."""
    _configure_sync(request)
    if not sync_engine.is_configured:
        raise HTTPException(status_code=400, detail="Sync not configured — Supabase credentials required")
    return await sync_engine.full_sync()


@router.post("/sync/pull")
async def pull_changes(request: Request) -> dict[str, Any]:
    """Pull incremental changes from Supabase."""
    _configure_sync(request)
    if not sync_engine.is_configured:
        return {"pulled": 0, "conflicts": 0, "reason": "not_configured"}
    return await sync_engine.pull_changes()


@router.post("/sync/pull-note")
async def pull_single_note(req: PullRemoteChangeRequest, request: Request) -> dict[str, Any]:
    """Pull a specific note from Supabase (e.g. after Realtime notification)."""
    _configure_sync(request)
    if not sync_engine.is_configured:
        raise HTTPException(status_code=400, detail="Sync not configured")
    result = await sync_engine.pull_note(req.note_id)
    if not result:
        raise HTTPException(status_code=404, detail="Note not found in Supabase")
    return result


@router.post("/sync/register-device")
async def register_device(request: Request) -> dict[str, Any]:
    _configure_sync(request)
    if not sync_engine.is_configured:
        return {"status": "not_configured"}
    return await sync_engine.register_device()


@router.post("/sync/start-watcher")
async def start_watcher(request: Request) -> dict[str, str]:
    _configure_sync(request)
    await sync_engine.start_watcher()
    return {"status": "watcher started"}


@router.post("/sync/stop-watcher")
async def stop_watcher(request: Request) -> dict[str, str]:
    await sync_engine.stop_watcher()
    return {"status": "watcher stopped"}


# ---------------------------------------------------------------------------
# Conflict endpoints
# ---------------------------------------------------------------------------

@router.get("/conflicts")
async def list_conflicts(request: Request) -> dict[str, Any]:
    conflicts = file_manager.list_conflicts()
    return {"conflicts": conflicts, "count": len(conflicts)}


@router.post("/conflicts/{note_id}/resolve")
async def resolve_conflict(
    note_id: str, req: ConflictResolveRequest, request: Request
) -> dict[str, Any]:
    _configure_sync(request)
    result = await sync_engine.resolve_conflict(note_id, req.resolution)
    if result is None:
        raise HTTPException(status_code=404, detail="Conflict not found")
    return {"status": "resolved", "resolution": req.resolution}


# ---------------------------------------------------------------------------
# Share endpoints (cloud-only — sharing metadata lives in Supabase)
# ---------------------------------------------------------------------------

@router.get("/shares")
async def list_shares(request: Request) -> list[dict[str, Any]]:
    _configure_sync(request)
    if not sync_engine.is_configured:
        return []
    user_id = _get_user_id(request)
    owned = await supabase_docs.list_shares(owner_id=user_id)
    shared_with_me = await supabase_docs.list_shares(shared_with_id=user_id)
    return [
        *[{**s, "_direction": "owned"} for s in owned],
        *[{**s, "_direction": "shared_with_me"} for s in shared_with_me],
    ]


@router.post("/shares")
async def create_share(req: ShareRequest, request: Request) -> dict[str, Any]:
    _configure_sync(request)
    if not sync_engine.is_configured:
        raise HTTPException(status_code=503, detail="Cloud sync not configured — sharing requires Supabase")
    user_id = _get_user_id(request)
    return await supabase_docs.create_share(
        owner_id=user_id,
        note_id=req.note_id,
        folder_id=req.folder_id,
        shared_with_id=req.shared_with_id,
        permission=req.permission,
        is_public=req.is_public,
    )


@router.put("/shares/{share_id}")
async def update_share(share_id: str, req: UpdateShareRequest, request: Request) -> dict[str, Any]:
    _configure_sync(request)
    updates: dict[str, Any] = {}
    if req.permission is not None:
        updates["permission"] = req.permission
    if req.is_public is not None:
        updates["is_public"] = req.is_public
    if not updates:
        return {"id": share_id}
    return await supabase_docs.update_share(share_id, updates)


@router.delete("/shares/{share_id}")
async def delete_share(share_id: str, request: Request) -> dict[str, str]:
    _configure_sync(request)
    await supabase_docs.delete_share(share_id)
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Directory mapping endpoints
# ---------------------------------------------------------------------------

@router.get("/mappings")
async def list_mappings(request: Request) -> dict[str, Any]:
    _configure_sync(request)
    user_id = _get_user_id_optional(request)

    cloud_mappings: list[dict[str, Any]] = []
    if sync_engine.is_configured and user_id:
        cloud_mappings = await supabase_docs.list_mappings(user_id, sync_engine.device_id)

    local_mappings = file_manager.load_local_mappings()
    return {
        "cloud_mappings": cloud_mappings,
        "local_mappings": local_mappings,
        "device_id": sync_engine.device_id,
    }


@router.post("/mappings")
async def create_mapping(req: MappingRequest, request: Request) -> dict[str, Any]:
    _configure_sync(request)
    user_id = _get_user_id_optional(request)

    # Save locally first
    local_mappings = file_manager.load_local_mappings()
    if req.folder_id not in local_mappings:
        local_mappings[req.folder_id] = []
    if req.local_path not in local_mappings[req.folder_id]:
        local_mappings[req.folder_id].append(req.local_path)
    file_manager.save_local_mappings(local_mappings)

    cloud_result: dict[str, Any] = {}
    if sync_engine.is_configured and user_id:
        _fire_and_forget(supabase_docs.create_mapping(
            user_id=user_id,
            device_id=sync_engine.device_id,
            folder_id=req.folder_id,
            local_path=req.local_path,
        ))

    return {"folder_id": req.folder_id, "local_path": req.local_path, **cloud_result}


@router.delete("/mappings/{mapping_id}")
async def delete_mapping(
    mapping_id: str,
    request: Request,
    folder_id: str | None = None,
    local_path: str | None = None,
) -> dict[str, str]:
    _configure_sync(request)

    if folder_id and local_path:
        local_mappings = file_manager.load_local_mappings()
        if folder_id in local_mappings:
            local_mappings[folder_id] = [p for p in local_mappings[folder_id] if p != local_path]
            if not local_mappings[folder_id]:
                del local_mappings[folder_id]
            file_manager.save_local_mappings(local_mappings)

    if sync_engine.is_configured:
        _fire_and_forget(supabase_docs.delete_mapping(mapping_id))

    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Local file operations (for tools / AI agent integration)
# ---------------------------------------------------------------------------

@router.get("/local/folders")
async def list_local_folders() -> list[str]:
    """List folders on the local filesystem."""
    return file_manager.list_folders()


@router.get("/local/files")
async def scan_local_files() -> list[dict[str, str]]:
    """Scan all .md files in the notes directory."""
    return file_manager.scan_all()


@router.get("/local/files/{file_path:path}")
async def read_local_file(file_path: str) -> dict[str, Any]:
    """Read a local .md file by its relative path."""
    content = file_manager.read_note(file_path)
    if content is None:
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    return {
        "file_path": file_path,
        "content": content,
        "content_hash": file_manager.note_hash(file_path),
    }
