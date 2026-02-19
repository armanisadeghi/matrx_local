from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional

from fastapi import FastAPI

from app.api.router import api_router
from app.cache.page_cache import PageCache
from app.config import get_settings
from app.core.fetcher.browser_pool import PlaywrightBrowserPool
from app.core.fetcher.fetcher import UnifiedFetcher
from app.core.orchestrator import ScrapeOrchestrator
from app.core.search import BraveSearchClient
from app.db.connection import close_pool, create_pool
from app.domain_config.config_store import DomainConfigStore
from app.utils.logging import setup_logging

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    setup_logging()
    settings = get_settings()
    logger.info("Starting scraper-service")

    db_pool = await create_pool(settings.DATABASE_URL)
    app.state.db_pool = db_pool
    app.state.settings = settings

    browser_pool: Optional[PlaywrightBrowserPool] = PlaywrightBrowserPool(
        pool_size=settings.PLAYWRIGHT_POOL_SIZE,
    )
    try:
        await browser_pool.start()
    except Exception:
        logger.warning("Playwright browser pool failed to start — browser fetching disabled")
        browser_pool = None
    app.state.browser_pool = browser_pool

    fetcher = UnifiedFetcher(settings=settings, browser_pool=browser_pool)
    app.state.fetcher = fetcher

    domain_config_store = DomainConfigStore(db_pool)
    try:
        await domain_config_store.start()
    except Exception:
        logger.warning("DomainConfigStore failed to start — domain config unavailable")
    app.state.domain_config_store = domain_config_store

    page_cache = PageCache(
        pool=db_pool,
        max_size=settings.PAGE_CACHE_MAX_SIZE,
        ttl_seconds=settings.PAGE_CACHE_TTL_SECONDS,
    )
    app.state.page_cache = page_cache

    search_client: Optional[BraveSearchClient] = None
    if settings.BRAVE_API_KEY:
        search_client = BraveSearchClient(settings)
    app.state.search_client = search_client

    orchestrator = ScrapeOrchestrator(
        fetcher=fetcher,
        settings=settings,
        db_pool=db_pool,
        page_cache=page_cache,
        domain_config_store=domain_config_store,
        search_client=search_client,
    )
    app.state.orchestrator = orchestrator

    logger.info("Scraper-service started on %s:%d", settings.HOST, settings.PORT)
    yield

    await domain_config_store.stop()
    if browser_pool:
        await browser_pool.stop()
    await close_pool(db_pool)
    logger.info("Scraper-service shut down")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Scraper Service",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.include_router(api_router)
    return app


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=settings.HOST,
        port=settings.PORT,
        reload=True,
    )
