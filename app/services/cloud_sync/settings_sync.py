"""Cloud settings sync engine.

Handles bidirectional synchronization of all app settings between
the local JSON file and the Supabase cloud database.

Settings are stored as a single JSON blob per instance. On sync,
the engine compares updated_at timestamps to determine which side
has newer data, and uses that as the source of truth.

Offline mode: if cloud is unreachable, local settings are used and
sync is retried on next startup or manual trigger.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

LOCAL_SETTINGS_FILE = Path.home() / ".matrx" / "settings.json"

# Default settings — every possible setting with its default value
DEFAULT_SETTINGS: dict[str, Any] = {
    # Proxy
    "proxy_enabled": True,
    "proxy_port": 22180,
    # Scraping
    "headless_scraping": True,
    "scrape_delay": 1.0,
    # Application
    "theme": "dark",
    "launch_on_startup": False,
    "minimize_to_tray": True,
    # Instance
    "instance_name": "My Computer",
}


class SettingsSync:
    """Manages local settings persistence and cloud synchronization."""

    def __init__(self) -> None:
        self._settings: dict[str, Any] = {}
        self._local_updated_at: Optional[str] = None
        self._supabase_url: str = ""
        self._supabase_key: str = ""
        self._jwt: Optional[str] = None
        self._user_id: Optional[str] = None
        self._instance_id: Optional[str] = None
        self._configured = False
        self._load_local()

    # ── configuration ───────────────────────────────────────────────────

    def configure(
        self,
        supabase_url: str,
        supabase_key: str,
        jwt: str,
        user_id: str,
        instance_id: str,
    ) -> None:
        """Configure cloud connection parameters."""
        self._supabase_url = supabase_url.rstrip("/")
        self._supabase_key = supabase_key
        self._jwt = jwt
        self._user_id = user_id
        self._instance_id = instance_id
        self._configured = bool(supabase_url and supabase_key and jwt and user_id)

    @property
    def is_configured(self) -> bool:
        return self._configured

    # ── local settings ──────────────────────────────────────────────────

    def get_all(self) -> dict[str, Any]:
        """Get all current settings (merged with defaults)."""
        merged = {**DEFAULT_SETTINGS, **self._settings}
        return merged

    def get(self, key: str, default: Any = None) -> Any:
        """Get a single setting value."""
        return self._settings.get(key, DEFAULT_SETTINGS.get(key, default))

    def set(self, key: str, value: Any) -> None:
        """Set a single setting and persist locally."""
        self._settings[key] = value
        self._save_local()

    def set_many(self, updates: dict[str, Any]) -> None:
        """Update multiple settings at once."""
        self._settings.update(updates)
        self._save_local()

    def reset_to_defaults(self) -> None:
        """Reset all settings to defaults."""
        self._settings = dict(DEFAULT_SETTINGS)
        self._save_local()

    # ── local file I/O ──────────────────────────────────────────────────

    def _load_local(self) -> None:
        """Load settings from local JSON file."""
        if LOCAL_SETTINGS_FILE.exists():
            try:
                data = json.loads(LOCAL_SETTINGS_FILE.read_text())
                self._settings = data.get("settings", {})
                self._local_updated_at = data.get("updated_at")
            except Exception:
                logger.warning("Corrupted local settings file, using defaults")
                self._settings = dict(DEFAULT_SETTINGS)
        else:
            self._settings = dict(DEFAULT_SETTINGS)

    def _save_local(self) -> None:
        """Persist settings to local JSON file."""
        self._local_updated_at = datetime.now(timezone.utc).isoformat()
        payload = {
            "settings": self._settings,
            "updated_at": self._local_updated_at,
        }
        LOCAL_SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        LOCAL_SETTINGS_FILE.write_text(json.dumps(payload, indent=2))

    # ── cloud sync ──────────────────────────────────────────────────────

    async def sync(self) -> dict:
        """Perform a full sync: compare timestamps, merge, push/pull.

        Returns a dict describing what happened.
        """
        if not self._configured:
            return {"status": "skipped", "reason": "not_configured"}

        try:
            cloud = await self._fetch_cloud_settings()

            if cloud is None:
                # No cloud record yet — push local to cloud
                await self._push_to_cloud()
                await self._update_sync_status("push", "success")
                return {"status": "pushed", "reason": "no_cloud_record"}

            cloud_settings = cloud.get("settings_json", {})
            cloud_updated = cloud.get("updated_at", "")

            local_updated = self._local_updated_at or ""

            if cloud_updated > local_updated:
                # Cloud is newer — pull
                self._settings = {**DEFAULT_SETTINGS, **cloud_settings}
                self._local_updated_at = cloud_updated
                self._save_local()
                await self._update_sync_status("pull", "success")
                return {"status": "pulled", "reason": "cloud_newer"}
            elif local_updated > cloud_updated:
                # Local is newer — push
                await self._push_to_cloud()
                await self._update_sync_status("push", "success")
                return {"status": "pushed", "reason": "local_newer"}
            else:
                # Same timestamp — no action needed
                await self._update_sync_status("full", "success")
                return {"status": "in_sync", "reason": "timestamps_match"}

        except Exception as exc:
            logger.warning("Cloud sync failed: %s", exc)
            try:
                await self._update_sync_status("full", "error", str(exc))
            except Exception:
                pass
            return {"status": "error", "reason": str(exc)}

    async def push_to_cloud(self) -> dict:
        """Force push local settings to cloud."""
        if not self._configured:
            return {"status": "error", "reason": "not_configured"}
        try:
            await self._push_to_cloud()
            await self._update_sync_status("push", "success")
            return {"status": "pushed"}
        except Exception as exc:
            return {"status": "error", "reason": str(exc)}

    async def pull_from_cloud(self) -> dict:
        """Force pull cloud settings to local."""
        if not self._configured:
            return {"status": "error", "reason": "not_configured"}
        try:
            cloud = await self._fetch_cloud_settings()
            if cloud is None:
                return {"status": "error", "reason": "no_cloud_record"}
            self._settings = {**DEFAULT_SETTINGS, **cloud.get("settings_json", {})}
            self._local_updated_at = cloud.get("updated_at", "")
            self._save_local()
            await self._update_sync_status("pull", "success")
            return {"status": "pulled", "settings": self.get_all()}
        except Exception as exc:
            return {"status": "error", "reason": str(exc)}

    # ── Supabase REST helpers ───────────────────────────────────────────

    def _headers(self) -> dict[str, str]:
        return {
            "apikey": self._supabase_key,
            "Authorization": f"Bearer {self._jwt}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    async def _fetch_cloud_settings(self) -> Optional[dict]:
        """Fetch this instance's settings from Supabase."""
        import httpx

        url = (
            f"{self._supabase_url}/rest/v1/app_settings"
            f"?user_id=eq.{self._user_id}"
            f"&instance_id=eq.{self._instance_id}"
            f"&select=*"
        )
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, headers=self._headers())
            resp.raise_for_status()
            rows = resp.json()
            return rows[0] if rows else None

    async def _push_to_cloud(self) -> None:
        """Upsert local settings to Supabase."""
        import httpx

        payload = {
            "user_id": self._user_id,
            "instance_id": self._instance_id,
            "settings_json": self.get_all(),
        }
        url = f"{self._supabase_url}/rest/v1/app_settings"
        headers = {
            **self._headers(),
            "Prefer": "resolution=merge-duplicates,return=representation",
        }
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()

    async def _update_sync_status(
        self, direction: str, result: str, error: str = ""
    ) -> None:
        """Update the sync_status record in Supabase."""
        import httpx

        payload = {
            "user_id": self._user_id,
            "instance_id": self._instance_id,
            "last_sync_at": datetime.now(timezone.utc).isoformat(),
            "last_sync_direction": direction,
            "last_sync_result": result,
            "error_message": error or None,
        }
        url = f"{self._supabase_url}/rest/v1/app_sync_status"
        headers = {
            **self._headers(),
            "Prefer": "resolution=merge-duplicates,return=representation",
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(url, json=payload, headers=headers)
        except Exception:
            logger.debug("Failed to update sync status", exc_info=True)

    async def register_instance(self, registration: dict) -> Optional[dict]:
        """Register or update this instance in the cloud."""
        if not self._configured:
            return None

        import httpx

        payload = {
            "user_id": self._user_id,
            **registration,
            "is_active": True,
            "last_seen": datetime.now(timezone.utc).isoformat(),
        }
        url = f"{self._supabase_url}/rest/v1/app_instances"
        headers = {
            **self._headers(),
            "Prefer": "resolution=merge-duplicates,return=representation",
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                rows = resp.json()
                return rows[0] if rows else None
        except Exception as exc:
            logger.warning("Instance registration failed: %s", exc)
            return None

    async def list_instances(self) -> list[dict]:
        """List all instances for the current user."""
        if not self._configured:
            return []

        import httpx

        url = (
            f"{self._supabase_url}/rest/v1/app_instances"
            f"?user_id=eq.{self._user_id}"
            f"&is_active=eq.true"
            f"&select=*"
            f"&order=last_seen.desc"
        )
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(url, headers=self._headers())
                resp.raise_for_status()
                return resp.json()
        except Exception:
            return []

    async def heartbeat(self) -> None:
        """Update last_seen timestamp for this instance."""
        if not self._configured:
            return

        import httpx

        url = (
            f"{self._supabase_url}/rest/v1/app_instances"
            f"?user_id=eq.{self._user_id}"
            f"&instance_id=eq.{self._instance_id}"
        )
        headers = {**self._headers(), "Prefer": "return=minimal"}
        payload = {"last_seen": datetime.now(timezone.utc).isoformat()}
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                await client.patch(url, json=payload, headers=headers)
        except Exception:
            pass


# Module-level singleton
_settings_sync: Optional[SettingsSync] = None


def get_settings_sync() -> SettingsSync:
    global _settings_sync
    if _settings_sync is None:
        _settings_sync = SettingsSync()
    return _settings_sync
