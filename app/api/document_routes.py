"""Document management API routes.

Provides REST endpoints for:
- Folder CRUD and tree retrieval
- Note CRUD with version history
- Sync operations (push/pull, full reconciliation)
- Sharing and collaboration
- Directory mapping management
- Conflict resolution
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.services.documents.file_manager import file_manager
from app.services.documents.supabase_client import supabase_docs
from app.services.documents.sync_engine import sync_engine

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/documents", tags=["documents"])


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_user_id(request: Request) -> str:
    """Extract user_id from the JWT (set by auth middleware)."""
    # The JWT payload includes sub (subject) = user_id
    # For now, we need the frontend to pass it; auth middleware stores the token
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    return user_id


def _configure_sync(request: Request) -> None:
    """Ensure sync engine is configured with current user context."""
    user_id = _get_user_id(request)
    token = getattr(request.state, "user_token", None)
    if token:
        sync_engine.configure(user_id, token)
        supabase_docs.set_jwt(token)


# ── Request models ───────────────────────────────────────────────────────────

class CreateFolderRequest(BaseModel):
    name: str
    parent_id: str | None = None
    path: str = ""


class UpdateFolderRequest(BaseModel):
    name: str | None = None
    parent_id: str | None = None
    path: str | None = None
    position: int | None = None


class CreateNoteRequest(BaseModel):
    label: str = "New Note"
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
    resolution: str = "keep_remote"  # keep_local, keep_remote, keep_both


class PullRemoteChangeRequest(BaseModel):
    note_id: str


# ── Folder endpoints ─────────────────────────────────────────────────────────

@router.get("/tree")
async def get_folder_tree(request: Request) -> dict[str, Any]:
    """Get the full folder tree with note counts."""
    _configure_sync(request)
    user_id = _get_user_id(request)

    folders = await supabase_docs.list_folders(user_id)
    notes = await supabase_docs.list_notes(user_id)

    # Count notes per folder
    folder_counts: dict[str, int] = {}
    for note in notes:
        fid = note.get("folder_id") or "__none__"
        folder_counts[fid] = folder_counts.get(fid, 0) + 1

    # Build tree structure
    tree: list[dict[str, Any]] = []
    folder_map: dict[str, dict[str, Any]] = {}

    for f in folders:
        node = {
            **f,
            "note_count": folder_counts.get(f["id"], 0),
            "children": [],
        }
        folder_map[f["id"]] = node

    for f in folders:
        node = folder_map[f["id"]]
        parent_id = f.get("parent_id")
        if parent_id and parent_id in folder_map:
            folder_map[parent_id]["children"].append(node)
        else:
            tree.append(node)

    return {
        "folders": tree,
        "total_notes": len(notes),
        "unfiled_notes": folder_counts.get("__none__", 0),
    }


@router.post("/folders")
async def create_folder(req: CreateFolderRequest, request: Request) -> dict[str, Any]:
    _configure_sync(request)
    user_id = _get_user_id(request)

    # Build path from parent
    path = req.name
    if req.parent_id:
        folders = await supabase_docs.list_folders(user_id)
        parent = next((f for f in folders if f["id"] == req.parent_id), None)
        if parent:
            path = f"{parent['path']}/{req.name}" if parent["path"] else req.name

    folder = await supabase_docs.create_folder(
        user_id=user_id,
        name=req.name,
        parent_id=req.parent_id,
        path=path,
    )

    # Create local directory
    file_manager.create_folder(path)

    return folder


@router.put("/folders/{folder_id}")
async def update_folder(
    folder_id: str, req: UpdateFolderRequest, request: Request
) -> dict[str, Any]:
    _configure_sync(request)

    updates: dict[str, Any] = {}
    if req.name is not None:
        updates["name"] = req.name
    if req.parent_id is not None:
        updates["parent_id"] = req.parent_id
    if req.path is not None:
        updates["path"] = req.path
    if req.position is not None:
        updates["position"] = req.position

    return await supabase_docs.update_folder(folder_id, updates)


@router.delete("/folders/{folder_id}")
async def delete_folder(folder_id: str, request: Request) -> dict[str, str]:
    _configure_sync(request)
    await supabase_docs.delete_folder(folder_id)
    return {"status": "deleted"}


# ── Note endpoints ───────────────────────────────────────────────────────────

@router.get("/notes")
async def list_notes(
    request: Request,
    folder_id: str | None = None,
    search: str | None = None,
) -> list[dict[str, Any]]:
    _configure_sync(request)
    user_id = _get_user_id(request)
    return await supabase_docs.list_notes(
        user_id, folder_id=folder_id, search=search
    )


@router.get("/notes/{note_id}")
async def get_note(note_id: str, request: Request) -> dict[str, Any]:
    _configure_sync(request)
    note = await supabase_docs.get_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@router.post("/notes")
async def create_note(req: CreateNoteRequest, request: Request) -> dict[str, Any]:
    _configure_sync(request)
    user_id = _get_user_id(request)

    import uuid
    note_id = str(uuid.uuid4())

    result = await sync_engine.push_note(
        note_id=note_id,
        label=req.label,
        content=req.content,
        folder_name=req.folder_name,
        folder_id=req.folder_id,
        tags=req.tags,
        metadata=req.metadata,
    )

    return result


@router.put("/notes/{note_id}")
async def update_note(
    note_id: str, req: UpdateNoteRequest, request: Request
) -> dict[str, Any]:
    _configure_sync(request)

    # Get existing note to fill in unchanged fields
    existing = await supabase_docs.get_note(note_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Note not found")

    label = req.label if req.label is not None else existing.get("label", "")
    content = req.content if req.content is not None else existing.get("content", "")
    folder_name = req.folder_name if req.folder_name is not None else existing.get("folder_name", "General")
    folder_id = req.folder_id if req.folder_id is not None else existing.get("folder_id")
    tags = req.tags if req.tags is not None else existing.get("tags", [])
    metadata = req.metadata if req.metadata is not None else existing.get("metadata", {})

    # Handle non-content updates (position, etc.)
    if req.position is not None:
        await supabase_docs.update_note(note_id, {"position": req.position})

    result = await sync_engine.push_note(
        note_id=note_id,
        label=label,
        content=content,
        folder_name=folder_name,
        folder_id=folder_id,
        tags=tags,
        metadata=metadata,
    )

    return result


@router.delete("/notes/{note_id}")
async def delete_note(note_id: str, request: Request) -> dict[str, str]:
    _configure_sync(request)

    # Get file path to delete local file
    note = await supabase_docs.get_note(note_id)
    if note and note.get("file_path"):
        file_manager.delete_note(note["file_path"])

    await supabase_docs.soft_delete_note(note_id)
    return {"status": "deleted"}


# ── Version endpoints ────────────────────────────────────────────────────────

@router.get("/notes/{note_id}/versions")
async def list_versions(note_id: str, request: Request) -> list[dict[str, Any]]:
    _configure_sync(request)
    return await supabase_docs.list_versions(note_id)


@router.post("/notes/{note_id}/revert")
async def revert_note(
    note_id: str, req: RevertRequest, request: Request
) -> dict[str, Any]:
    _configure_sync(request)
    user_id = _get_user_id(request)

    version = await supabase_docs.get_version(note_id, req.version_number)
    if not version:
        raise HTTPException(
            status_code=404,
            detail=f"Version {req.version_number} not found",
        )

    existing = await supabase_docs.get_note(note_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Note not found")

    # Push the old version content as current
    result = await sync_engine.push_note(
        note_id=note_id,
        label=version["label"],
        content=version["content"],
        folder_name=existing.get("folder_name", "General"),
        folder_id=existing.get("folder_id"),
        tags=existing.get("tags", []),
        metadata=existing.get("metadata", {}),
    )

    return result


# ── Sync endpoints ───────────────────────────────────────────────────────────

@router.get("/sync/status")
async def sync_status(request: Request) -> dict[str, Any]:
    _configure_sync(request)
    return sync_engine.get_status()


@router.post("/sync/trigger")
async def trigger_sync(request: Request) -> dict[str, Any]:
    """Force a full bidirectional sync."""
    _configure_sync(request)

    if not sync_engine.is_configured:
        raise HTTPException(
            status_code=400,
            detail="Sync not configured — Supabase credentials required",
        )

    result = await sync_engine.full_sync()
    return result


@router.post("/sync/pull")
async def pull_changes(request: Request) -> dict[str, Any]:
    """Pull incremental changes from Supabase."""
    _configure_sync(request)
    return await sync_engine.pull_changes()


@router.post("/sync/pull-note")
async def pull_single_note(
    req: PullRemoteChangeRequest, request: Request
) -> dict[str, Any]:
    """Pull a specific note from Supabase (e.g., after Realtime notification)."""
    _configure_sync(request)
    result = await sync_engine.pull_note(req.note_id)
    if not result:
        raise HTTPException(status_code=404, detail="Note not found in Supabase")
    return result


@router.post("/sync/register-device")
async def register_device(request: Request) -> dict[str, Any]:
    _configure_sync(request)
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


# ── Conflict endpoints ───────────────────────────────────────────────────────

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


# ── Share endpoints ──────────────────────────────────────────────────────────

@router.get("/shares")
async def list_shares(request: Request) -> list[dict[str, Any]]:
    _configure_sync(request)
    user_id = _get_user_id(request)
    owned = await supabase_docs.list_shares(owner_id=user_id)
    shared_with_me = await supabase_docs.list_shares(shared_with_id=user_id)
    return [
        *[{**s, "_direction": "owned"} for s in owned],
        *[{**s, "_direction": "shared_with_me"} for s in shared_with_me],
    ]


@router.post("/shares")
async def create_share(
    req: ShareRequest, request: Request
) -> dict[str, Any]:
    _configure_sync(request)
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
async def update_share(
    share_id: str, req: UpdateShareRequest, request: Request
) -> dict[str, Any]:
    _configure_sync(request)

    updates: dict[str, Any] = {}
    if req.permission is not None:
        updates["permission"] = req.permission
    if req.is_public is not None:
        updates["is_public"] = req.is_public

    return await supabase_docs.update_share(share_id, updates)


@router.delete("/shares/{share_id}")
async def delete_share(share_id: str, request: Request) -> dict[str, str]:
    _configure_sync(request)
    await supabase_docs.delete_share(share_id)
    return {"status": "deleted"}


# ── Directory mapping endpoints ──────────────────────────────────────────────

@router.get("/mappings")
async def list_mappings(request: Request) -> dict[str, Any]:
    _configure_sync(request)
    user_id = _get_user_id(request)

    # Get cloud mappings
    cloud_mappings: list[dict[str, Any]] = []
    if supabase_docs.available:
        cloud_mappings = await supabase_docs.list_mappings(
            user_id, sync_engine.device_id
        )

    # Get local mappings
    local_mappings = file_manager.load_local_mappings()

    return {
        "cloud_mappings": cloud_mappings,
        "local_mappings": local_mappings,
        "device_id": sync_engine.device_id,
    }


@router.post("/mappings")
async def create_mapping(
    req: MappingRequest, request: Request
) -> dict[str, Any]:
    _configure_sync(request)
    user_id = _get_user_id(request)

    # Save to cloud
    cloud_result: dict[str, Any] = {}
    if supabase_docs.available:
        cloud_result = await supabase_docs.create_mapping(
            user_id=user_id,
            device_id=sync_engine.device_id,
            folder_id=req.folder_id,
            local_path=req.local_path,
        )

    # Save locally
    local_mappings = file_manager.load_local_mappings()
    if req.folder_id not in local_mappings:
        local_mappings[req.folder_id] = []
    if req.local_path not in local_mappings[req.folder_id]:
        local_mappings[req.folder_id].append(req.local_path)
    file_manager.save_local_mappings(local_mappings)

    return {**cloud_result, "local_path": req.local_path}


@router.delete("/mappings/{mapping_id}")
async def delete_mapping(
    mapping_id: str, request: Request,
    folder_id: str | None = None,
    local_path: str | None = None,
) -> dict[str, str]:
    _configure_sync(request)

    # Remove from cloud
    if supabase_docs.available:
        await supabase_docs.delete_mapping(mapping_id)

    # Remove locally
    if folder_id and local_path:
        local_mappings = file_manager.load_local_mappings()
        if folder_id in local_mappings:
            local_mappings[folder_id] = [
                p for p in local_mappings[folder_id] if p != local_path
            ]
            if not local_mappings[folder_id]:
                del local_mappings[folder_id]
            file_manager.save_local_mappings(local_mappings)

    return {"status": "deleted"}


# ── Local file operations (for tools / AI integration) ───────────────────────

@router.get("/local/folders")
async def list_local_folders() -> list[str]:
    """List folders on the local filesystem."""
    return file_manager.list_folders()


@router.get("/local/files")
async def scan_local_files() -> list[dict[str, str]]:
    """Scan all .md files in the documents directory."""
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
