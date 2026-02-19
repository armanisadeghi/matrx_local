"""Routes that proxy requests to the remote scraper server.

These let the React frontend call the remote scraper server through the
local engine, so all external API keys stay server-side and the frontend
only needs to talk to localhost.

When the user is authenticated (Authorization header present), the JWT is
forwarded to the scraper server. Otherwise, falls back to SCRAPER_API_KEY.
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from app.services.scraper.remote_client import get_remote_scraper
from app.common.system_logger import get_logger

router = APIRouter(prefix="/remote-scraper", tags=["remote-scraper"])
logger = get_logger()


def _get_user_token(request: Request) -> str | None:
    return getattr(request.state, "user_token", None)


class ScrapeRequest(BaseModel):
    urls: list[str]
    options: dict | None = None


class SearchRequest(BaseModel):
    keywords: list[str]
    count: int = 10
    country: str = "US"


class SearchAndScrapeRequest(BaseModel):
    keywords: list[str]
    total_results_per_keyword: int = 5
    options: dict | None = None


class ResearchRequest(BaseModel):
    query: str
    effort: str = "thorough"
    country: str = "US"


@router.get("/status")
async def remote_scraper_status():
    client = get_remote_scraper()
    if not client.is_configured:
        return {"available": False, "reason": "SCRAPER_API_KEY not configured"}
    try:
        health = await client.health()
        return {"available": True, **health}
    except Exception as e:
        return {"available": False, "reason": str(e)}


@router.post("/scrape")
async def remote_scrape(req: ScrapeRequest, request: Request):
    client = get_remote_scraper()
    if not client.is_configured:
        raise HTTPException(400, "Remote scraper not configured (SCRAPER_API_KEY missing)")
    try:
        return await client.scrape(req.urls, req.options, auth_token=_get_user_token(request))
    except Exception as e:
        logger.error(f"Remote scrape failed: {e}")
        raise HTTPException(502, f"Remote scraper error: {e}")


@router.post("/search")
async def remote_search(req: SearchRequest, request: Request):
    client = get_remote_scraper()
    if not client.is_configured:
        raise HTTPException(400, "Remote scraper not configured (SCRAPER_API_KEY missing)")
    try:
        return await client.search(
            req.keywords, req.count, req.country, auth_token=_get_user_token(request),
        )
    except Exception as e:
        logger.error(f"Remote search failed: {e}")
        raise HTTPException(502, f"Remote scraper error: {e}")


@router.post("/search-and-scrape")
async def remote_search_and_scrape(req: SearchAndScrapeRequest, request: Request):
    client = get_remote_scraper()
    if not client.is_configured:
        raise HTTPException(400, "Remote scraper not configured (SCRAPER_API_KEY missing)")
    try:
        return await client.search_and_scrape(
            req.keywords, req.total_results_per_keyword, req.options,
            auth_token=_get_user_token(request),
        )
    except Exception as e:
        logger.error(f"Remote search-and-scrape failed: {e}")
        raise HTTPException(502, f"Remote scraper error: {e}")


@router.post("/research")
async def remote_research(req: ResearchRequest, request: Request):
    client = get_remote_scraper()
    if not client.is_configured:
        raise HTTPException(400, "Remote scraper not configured (SCRAPER_API_KEY missing)")
    try:
        return await client.research(
            req.query, req.effort, req.country, auth_token=_get_user_token(request),
        )
    except Exception as e:
        logger.error(f"Remote research failed: {e}")
        raise HTTPException(502, f"Remote scraper error: {e}")
