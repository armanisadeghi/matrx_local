"""Cloud sync API routes.

Endpoints for managing cloud-synced settings, instance registration,
and synchronization between local and cloud storage.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel

from app.services.cloud_sync.instance_manager import get_instance_manager
from app.services.cloud_sync.settings_sync import get_settings_sync
from app.config import SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY

router = APIRouter(prefix="/cloud", tags=["cloud-sync"])


class ConfigureRequest(BaseModel):
    jwt: str
    user_id: str


class SettingsUpdateRequest(BaseModel):
    settings: dict[str, Any]


class SyncResult(BaseModel):
    status: str
    reason: str | None = None
    settings: dict[str, Any] | None = None


class InstanceInfo(BaseModel):
    instance_id: str
    instance_name: str
    platform: str | None = None
    os_version: str | None = None
    architecture: str | None = None
    hostname: str | None = None
    username: str | None = None
    python_version: str | None = None
    home_dir: str | None = None
    cpu_model: str | None = None
    cpu_cores: int | None = None
    ram_total_gb: float | None = None


# ── Configuration ───────────────────────────────────────────────────────

@router.post("/configure")
async def configure_sync(req: ConfigureRequest) -> dict:
    """Configure the sync engine with user credentials.

    Called by the frontend after user authentication.
    """
    sync = get_settings_sync()
    mgr = get_instance_manager()

    sync.configure(
        supabase_url=SUPABASE_URL,
        supabase_key=SUPABASE_PUBLISHABLE_KEY,
        jwt=req.jwt,
        user_id=req.user_id,
        instance_id=mgr.instance_id,
    )

    # Register this instance with the cloud
    registration = mgr.get_registration_payload()
    await sync.register_instance(registration)

    # Attempt initial sync
    result = await sync.sync()

    return {
        "configured": True,
        "instance_id": mgr.instance_id,
        "sync_result": result,
    }


@router.post("/reconfigure")
async def reconfigure_sync(req: ConfigureRequest) -> dict:
    """Re-configure with a fresh JWT (e.g. after token refresh)."""
    sync = get_settings_sync()
    mgr = get_instance_manager()

    sync.configure(
        supabase_url=SUPABASE_URL,
        supabase_key=SUPABASE_PUBLISHABLE_KEY,
        jwt=req.jwt,
        user_id=req.user_id,
        instance_id=mgr.instance_id,
    )

    return {"configured": True, "instance_id": mgr.instance_id}


# ── Settings CRUD ───────────────────────────────────────────────────────

@router.get("/settings")
async def get_cloud_settings() -> dict:
    """Get all current settings (local, merged with defaults)."""
    sync = get_settings_sync()
    return {
        "settings": sync.get_all(),
        "configured": sync.is_configured,
    }


@router.put("/settings")
async def update_cloud_settings(req: SettingsUpdateRequest) -> dict:
    """Update one or more settings locally and trigger cloud sync."""
    sync = get_settings_sync()
    sync.set_many(req.settings)

    # Attempt to push to cloud if configured
    push_result = None
    if sync.is_configured:
        push_result = await sync.push_to_cloud()

    return {
        "settings": sync.get_all(),
        "push_result": push_result,
    }


@router.post("/settings/reset")
async def reset_settings() -> dict:
    """Reset all settings to defaults."""
    sync = get_settings_sync()
    sync.reset_to_defaults()
    return {"settings": sync.get_all()}


# ── Sync Operations ────────────────────────────────────────────────────

@router.post("/sync", response_model=SyncResult)
async def trigger_sync() -> SyncResult:
    """Trigger a bidirectional sync with the cloud."""
    sync = get_settings_sync()
    result = await sync.sync()
    return SyncResult(
        status=result.get("status", "error"),
        reason=result.get("reason"),
        settings=sync.get_all() if result.get("status") in ("pulled", "in_sync") else None,
    )


@router.post("/sync/push", response_model=SyncResult)
async def push_settings() -> SyncResult:
    """Force push local settings to cloud."""
    sync = get_settings_sync()
    result = await sync.push_to_cloud()
    return SyncResult(
        status=result.get("status", "error"),
        reason=result.get("reason"),
    )


@router.post("/sync/pull", response_model=SyncResult)
async def pull_settings() -> SyncResult:
    """Force pull cloud settings to local."""
    sync = get_settings_sync()
    result = await sync.pull_from_cloud()
    return SyncResult(
        status=result.get("status", "error"),
        reason=result.get("reason"),
        settings=result.get("settings"),
    )


# ── Instance Management ────────────────────────────────────────────────

@router.get("/instance", response_model=InstanceInfo)
async def get_instance_info() -> InstanceInfo:
    """Get this instance's identifying information."""
    mgr = get_instance_manager()
    payload = mgr.get_registration_payload()
    return InstanceInfo(**payload)


@router.get("/instances")
async def list_instances() -> dict:
    """List all registered instances for the current user."""
    sync = get_settings_sync()
    instances = await sync.list_instances()
    return {"instances": instances}


@router.put("/instance/name")
async def update_instance_name(req: dict) -> dict:
    """Update this instance's display name."""
    name = req.get("name", "My Computer")
    mgr = get_instance_manager()
    mgr.instance_name = name

    # Update in settings too
    sync = get_settings_sync()
    sync.set("instance_name", name)

    # Push to cloud
    if sync.is_configured:
        registration = mgr.get_registration_payload()
        await sync.register_instance(registration)

    return {"instance_name": name}


@router.post("/heartbeat")
async def heartbeat() -> dict:
    """Update the last_seen timestamp for this instance."""
    sync = get_settings_sync()
    await sync.heartbeat()
    return {"status": "ok"}
