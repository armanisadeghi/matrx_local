"""Engine runtime settings — configurable from the desktop UI.

Now integrates with the cloud settings sync engine so that engine-specific
settings (headless_scraping, scrape_delay) are persisted alongside other
settings in the unified settings store.
"""

from __future__ import annotations

import re
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.cloud_sync.settings_sync import get_settings_sync

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
