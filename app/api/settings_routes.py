"""Engine runtime settings — configurable from the desktop UI."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/settings", tags=["settings"])


class EngineSettings(BaseModel):
    headless_scraping: bool = True
    scrape_delay: float = 1.0


# In-memory settings (not persisted — desktop app re-sends on startup).
_current = EngineSettings()


@router.get("", response_model=EngineSettings)
async def get_settings() -> EngineSettings:
    return _current


@router.put("", response_model=EngineSettings)
async def update_settings(req: EngineSettings) -> EngineSettings:
    global _current
    _current = req
    return _current
