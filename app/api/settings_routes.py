"""Engine runtime settings — configurable from the desktop UI.

Now integrates with the cloud settings sync engine so that engine-specific
settings (headless_scraping, scrape_delay) are persisted alongside other
settings in the unified settings store.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.cloud_sync.settings_sync import get_settings_sync

router = APIRouter(prefix="/settings", tags=["settings"])


class EngineSettings(BaseModel):
    headless_scraping: bool = True
    scrape_delay: float = 1.0


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
