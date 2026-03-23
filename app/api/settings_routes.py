"""Engine runtime settings — configurable from the desktop UI.

Includes:
- Engine settings (headless_scraping, scrape_delay)
- Wake word engine preference (whisper vs openWakeWord, model, threshold)
- Forbidden URL list
- Storage path overrides (GET /settings/paths, PUT /settings/paths/{name},
  DELETE /settings/paths/{name} to reset to default)
"""

from __future__ import annotations

import re
from typing import Any, List, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.cloud_sync.settings_sync import get_settings_sync
from app.services.local_db.repositories import AppSettingsRepo
from app.services.paths.manager import all_paths, set_path, reset_path, safe_dir

router = APIRouter(prefix="/settings", tags=["settings"])


class EngineSettings(BaseModel):
    headless_scraping: bool = True
    scrape_delay: float = 1.0


class ForbiddenUrlsResponse(BaseModel):
    urls: List[str]


class ForbiddenUrlEntry(BaseModel):
    url: str


def _normalize_forbidden_url(raw: str) -> str:
    """Normalise to bare domain/pattern for storage (strips scheme, trailing slash)."""
    url = raw.strip()
    url = re.sub(r"^https?://", "", url, flags=re.IGNORECASE)
    url = url.rstrip("/")
    return url.lower()


def is_url_forbidden(target_url: str) -> bool:
    """Return True if ``target_url`` matches any forbidden URL pattern."""
    sync = get_settings_sync()
    forbidden: list[str] = sync.get("forbidden_urls", [])
    if not forbidden:
        return False
    target = target_url.lower()
    target_norm = re.sub(r"^https?://", "", target).rstrip("/")
    for pattern in forbidden:
        if pattern.startswith("*"):
            suffix = pattern.lstrip("*").lstrip(".")
            if target_norm == suffix or target_norm.endswith("." + suffix) or ("/" + suffix) in target_norm:
                return True
        elif target_norm == pattern or target_norm.startswith(pattern + "/"):
            return True
    return False


@router.get("", response_model=EngineSettings)
async def get_settings() -> EngineSettings:
    sync = get_settings_sync()
    return EngineSettings(
        headless_scraping=sync.get("headless_scraping", True),
        scrape_delay=sync.get("scrape_delay", 1.0),
    )


@router.put("", response_model=EngineSettings)
async def update_settings(req: EngineSettings) -> EngineSettings:
    sync = get_settings_sync()
    sync.set_many({
        "headless_scraping": req.headless_scraping,
        "scrape_delay": req.scrape_delay,
    })
    return req


# ── Forbidden URL list ────────────────────────────────────────────────────────

@router.get("/forbidden-urls", response_model=ForbiddenUrlsResponse)
async def get_forbidden_urls() -> ForbiddenUrlsResponse:
    sync = get_settings_sync()
    return ForbiddenUrlsResponse(urls=sync.get("forbidden_urls", []))


@router.post("/forbidden-urls", response_model=ForbiddenUrlsResponse)
async def add_forbidden_url(entry: ForbiddenUrlEntry) -> ForbiddenUrlsResponse:
    normalized = _normalize_forbidden_url(entry.url)
    if not normalized:
        raise HTTPException(status_code=422, detail="URL must not be empty")
    sync = get_settings_sync()
    current: list[str] = sync.get("forbidden_urls", [])
    if normalized not in current:
        current = [*current, normalized]
        sync.set("forbidden_urls", current)
    return ForbiddenUrlsResponse(urls=current)


@router.delete("/forbidden-urls/{url:path}", response_model=ForbiddenUrlsResponse)
async def remove_forbidden_url(url: str) -> ForbiddenUrlsResponse:
    normalized = _normalize_forbidden_url(url)
    sync = get_settings_sync()
    current: list[str] = sync.get("forbidden_urls", [])
    updated = [u for u in current if u != normalized]
    sync.set("forbidden_urls", updated)
    return ForbiddenUrlsResponse(urls=updated)


@router.put("/forbidden-urls", response_model=ForbiddenUrlsResponse)
async def replace_forbidden_urls(body: ForbiddenUrlsResponse) -> ForbiddenUrlsResponse:
    normalized = [_normalize_forbidden_url(u) for u in body.urls if u.strip()]
    normalized = list(dict.fromkeys(normalized))  # deduplicate, preserve order
    sync = get_settings_sync()
    sync.set("forbidden_urls", normalized)
    return ForbiddenUrlsResponse(urls=normalized)


# ── Wake word settings ────────────────────────────────────────────────────────

_WW_SETTINGS_KEY = "wake_word"

_WW_DEFAULTS: dict[str, Any] = {
    "engine": "whisper",          # "whisper" | "oww"
    "oww_model": "hey_jarvis",    # OWW model name (when engine == "oww")
    "oww_threshold": 0.5,         # detection confidence threshold
    "custom_keyword": "hey matrix",  # keyword for the whisper engine
}


class WakeWordSettings(BaseModel):
    engine: Literal["whisper", "oww"] = "whisper"
    oww_model: str = "hey_jarvis"
    oww_threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    custom_keyword: str = "hey matrix"


@router.get("/wake-word", response_model=WakeWordSettings)
async def get_wake_word_settings() -> WakeWordSettings:
    repo = AppSettingsRepo()
    stored: dict[str, Any] = await repo.get(_WW_SETTINGS_KEY, {})
    merged = {**_WW_DEFAULTS, **stored}
    return WakeWordSettings(**merged)


@router.put("/wake-word", response_model=WakeWordSettings)
async def save_wake_word_settings(req: WakeWordSettings) -> WakeWordSettings:
    repo = AppSettingsRepo()
    await repo.set(_WW_SETTINGS_KEY, req.model_dump())
    return req


# ── Storage paths ─────────────────────────────────────────────────────────────

class PathEntry(BaseModel):
    name: str
    label: str
    current: str
    default: str
    is_custom: bool
    user_visible: bool


class PathUpdateRequest(BaseModel):
    path: str


@router.get("/paths", response_model=list[PathEntry])
async def get_paths() -> list[dict[str, Any]]:
    """Return all storage path configurations with their current resolved values."""
    return all_paths()


@router.put("/paths/{name}", response_model=PathEntry)
async def update_path(name: str, req: PathUpdateRequest) -> dict[str, Any]:
    """Set a custom path for a named storage location.

    The directory is created immediately to validate accessibility.
    If creation fails, a 422 is returned with the error message.
    """
    result = set_path(name, req.path)
    if not result.get("ok"):
        raise HTTPException(status_code=422, detail=result.get("error", "Could not create directory"))
    # Return the updated entry
    entries = all_paths()
    entry = next((e for e in entries if e["name"] == name), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Path '{name}' not found")
    return entry


@router.delete("/paths/{name}", response_model=PathEntry)
async def reset_path_to_default(name: str) -> dict[str, Any]:
    """Reset a path override back to the compiled default."""
    result = reset_path(name)
    if not result.get("ok"):
        raise HTTPException(status_code=422, detail=result.get("error", "Reset failed"))
    entries = all_paths()
    entry = next((e for e in entries if e["name"] == name), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Path '{name}' not found")
    return entry
