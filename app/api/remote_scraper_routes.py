"""Routes that proxy requests to the remote scraper server.

These let the React frontend call the remote scraper server through the
local engine, so all external API keys stay server-side and the frontend
only needs to talk to localhost.

When the user is authenticated (Authorization header present), the JWT is
forwarded to the scraper server. Otherwise, falls back to SCRAPER_API_KEY.
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
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


# ---- SSE streaming proxy endpoints ----

def _ensure_configured():
    client = get_remote_scraper()
    if not client.is_configured:
        raise HTTPException(400, "Remote scraper not configured (SCRAPER_API_KEY missing)")
    return client


@router.post("/scrape/stream")
async def remote_scrape_stream(req: ScrapeRequest, request: Request):
    client = _ensure_configured()
    return StreamingResponse(
        client.stream_sse(
            "/api/v1/scrape/stream",
            {"urls": req.urls, "options": req.options or {}},
            auth_token=_get_user_token(request),
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/search-and-scrape/stream")
async def remote_search_and_scrape_stream(req: SearchAndScrapeRequest, request: Request):
    client = _ensure_configured()
    return StreamingResponse(
        client.stream_sse(
            "/api/v1/search-and-scrape/stream",
            {
                "keywords": req.keywords,
                "total_results_per_keyword": req.total_results_per_keyword,
                "options": req.options or {},
            },
            auth_token=_get_user_token(request),
            timeout=300.0,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/research/stream")
async def remote_research_stream(req: ResearchRequest, request: Request):
    client = _ensure_configured()
    return StreamingResponse(
        client.stream_sse(
            "/api/v1/research/stream",
            {"query": req.query, "effort": req.effort, "country": req.country},
            auth_token=_get_user_token(request),
            timeout=300.0,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Retry queue status routes ─────────────────────────────────────────────────

@router.get("/queue/pending")
async def queue_pending(request: Request, tier: str = "desktop", limit: int = 10):
    """Get URLs in the server's retry queue waiting for local scraping."""
    client = get_remote_scraper()
    if not client.is_configured:
        raise HTTPException(400, "Remote scraper not configured (SCRAPER_API_KEY missing)")
    try:
        return await client.get_pending(tier=tier, limit=limit, auth_token=_get_user_token(request))
    except Exception as e:
        raise HTTPException(502, f"Remote scraper error: {e}")


@router.get("/queue/stats")
async def queue_stats(request: Request):
    """Get retry queue statistics from the remote server."""
    client = get_remote_scraper()
    if not client.is_configured:
        raise HTTPException(400, "Remote scraper not configured (SCRAPER_API_KEY missing)")
    try:
        return await client.queue_stats(auth_token=_get_user_token(request))
    except Exception as e:
        raise HTTPException(502, f"Remote scraper error: {e}")


@router.get("/queue/poller-stats")
async def queue_poller_stats():
    """Get local retry queue poller statistics (this engine's activity)."""
    from app.services.scraper.retry_queue import get_stats
    return get_stats()


@router.get("/config/domains")
async def get_domain_configs(request: Request):
    """Get domain-specific scraping configs from the remote server."""
    client = get_remote_scraper()
    if not client.is_configured:
        raise HTTPException(400, "Remote scraper not configured (SCRAPER_API_KEY missing)")
    try:
        return await client.get_domain_configs(auth_token=_get_user_token(request))
    except Exception as e:
        raise HTTPException(502, f"Remote scraper error: {e}")
