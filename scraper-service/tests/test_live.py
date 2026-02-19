"""
Live integration tests — no mocks, real database, real HTTP requests.

Run one function at a time:
    cd scraper-service
    uv run python tests/test_live.py
"""

from __future__ import annotations

import asyncio
import time

from rich import print


async def test_db_connection():
    from app.config import get_settings
    from app.db.connection import close_pool, create_pool

    settings = get_settings()
    pool = await create_pool(settings.DATABASE_URL)
    async with pool.acquire() as conn:
        version = await conn.fetchval("SELECT version()")
        tables = await conn.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
        )
    await close_pool(pool)
    print({"postgres_version": version, "tables": [t["tablename"] for t in tables]})


async def test_domain_config_store():
    from app.config import get_settings
    from app.db.connection import close_pool, create_pool
    from app.domain_config.config_store import DomainConfigStore

    settings = get_settings()
    pool = await create_pool(settings.DATABASE_URL)
    store = DomainConfigStore(pool)
    await store.start()

    print({
        "total_domains": len(store.all_domains),
        "base_config_rules": len(store.base_config),
        "domains": [d.model_dump() for d in store.all_domains],
    })

    await store.stop()
    await close_pool(pool)


async def test_fetch_single_page():
    from app.config import get_settings
    from app.core.fetcher.fetcher import UnifiedFetcher

    settings = get_settings()
    fetcher = UnifiedFetcher(settings=settings, browser_pool=None)

    url = "https://example.com"
    start = time.time()
    response = await fetcher.fetch_with_retry(url, use_random_proxy=False)
    elapsed = time.time() - start

    print({
        "url": url,
        "elapsed_seconds": round(elapsed, 3),
        "status_code": response.status_code,
        "content_type": response.content_type.value if response.content_type else None,
        "failed": response.failed,
        "failed_reasons": response.failed_reasons,
        "content_length": len(response.content) if response.content else 0,
        "cms": response.cms_primary.value if response.cms_primary else None,
        "firewall": response.firewall.value if response.firewall else None,
    })


async def test_parse_html():
    from app.core.fetcher.fetcher import UnifiedFetcher
    from app.core.parser.parser import UnifiedParser
    from app.config import get_settings
    from app.models.enums import OutputMode

    settings = get_settings()
    fetcher = UnifiedFetcher(settings=settings, browser_pool=None)
    parser = UnifiedParser()

    url = "https://docs.python.org/3/library/asyncio.html"
    response = await fetcher.fetch_with_retry(url, use_random_proxy=False)

    if response.failed:
        print({"error": "fetch failed", "reasons": response.failed_reasons})
        return

    start = time.time()
    result = parser.parse(response.content, url, OutputMode.RICH)
    elapsed = time.time() - start

    print({
        "url": url,
        "parse_time_seconds": round(elapsed, 3),
        "has_text_data": bool(result.text_data),
        "text_data_length": len(result.text_data) if result.text_data else 0,
        "has_ai_research_content": bool(result.ai_research_content),
        "ai_research_length": len(result.ai_research_content) if result.ai_research_content else 0,
        "has_overview": bool(result.overview),
        "has_links": bool(result.links),
        "has_main_image": bool(result.main_image),
        "hash_count": len(result.hashes) if result.hashes else 0,
        "overview": result.overview,
    })


async def test_full_scrape_pipeline():
    from app.cache.page_cache import PageCache
    from app.config import get_settings
    from app.core.fetcher.fetcher import UnifiedFetcher
    from app.core.orchestrator import ScrapeOrchestrator
    from app.db.connection import close_pool, create_pool
    from app.domain_config.config_store import DomainConfigStore
    from app.models.options import FetchOptions

    settings = get_settings()
    pool = await create_pool(settings.DATABASE_URL)
    fetcher = UnifiedFetcher(settings=settings, browser_pool=None)
    cache = PageCache(pool=pool, max_size=100, ttl_seconds=300)
    domain_store = DomainConfigStore(pool)
    await domain_store.start()

    orchestrator = ScrapeOrchestrator(
        fetcher=fetcher,
        settings=settings,
        db_pool=pool,
        page_cache=cache,
        domain_config_store=domain_store,
    )

    urls = ["https://example.com", "https://httpbin.org/html"]
    options = FetchOptions(use_cache=True, get_text_data=True, get_links=False)

    start = time.time()
    results = await orchestrator.scrape(urls, options)
    elapsed = time.time() - start

    for r in results:
        print({
            "url": r.url,
            "status": r.status,
            "from_cache": r.from_cache,
            "content_type": r.content_type,
            "text_length": len(r.text_data) if r.text_data else 0,
            "error": r.error,
        })

    print({"total_time_seconds": round(elapsed, 3), "results_count": len(results)})

    await domain_store.stop()
    await close_pool(pool)


async def test_brave_search():
    from app.config import get_settings
    from app.core.search import BraveSearchClient

    settings = get_settings()
    client = BraveSearchClient(settings)

    result = await client.search_with_retry(
        query="python asyncio tutorial",
        count=5,
        country="us",
    )
    print(result)


async def test_cache_roundtrip():
    from app.cache.page_cache import PageCache
    from app.config import get_settings
    from app.db.connection import close_pool, create_pool

    settings = get_settings()
    pool = await create_pool(settings.DATABASE_URL)
    cache = PageCache(pool=pool, max_size=100, ttl_seconds=300)

    test_page = "test__cache_roundtrip__example_com"
    test_content = {"text_data": "Hello world", "ai_research_content": "Test content"}

    await cache.set(
        page_name=test_page,
        url="https://example.com/test",
        domain="example.com",
        content=test_content,
        content_type="html",
        char_count=11,
        ttl_days=1,
    )

    result = await cache.get(test_page)
    print({"cached_result": result})

    await cache.invalidate(test_page)
    after_invalidate = await cache.get(test_page)
    print({"after_invalidate": after_invalidate})

    await close_pool(pool)


async def test_failure_logging():
    from app.config import get_settings
    from app.db.connection import close_pool, create_pool
    from app.db.queries.failure_log import log_failure

    settings = get_settings()
    pool = await create_pool(settings.DATABASE_URL)

    await log_failure(
        pool=pool,
        target_url="https://blocked-site.example.com/page",
        failure_reason="connection_timeout",
        status_code=None,
        error_log="Connection timed out after 30s",
        proxy_used=True,
    )

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM scrape_failure_log ORDER BY created_at DESC LIMIT 1"
        )

    print(dict(row) if row else "No rows found")
    await close_pool(pool)


if __name__ == "__main__":
    # Uncomment one at a time and run: uv run python tests/test_live.py

    asyncio.run(test_db_connection())
    # asyncio.run(test_domain_config_store())
    # asyncio.run(test_fetch_single_page())
    # asyncio.run(test_parse_html())
    # asyncio.run(test_full_scrape_pipeline())
    # asyncio.run(test_brave_search())
    # asyncio.run(test_cache_roundtrip())
    # asyncio.run(test_failure_logging())
    # asyncio.run(test_fetch_single_page())
    # asyncio.run(test_parse_html())
    # asyncio.run(test_full_scrape_pipeline())
    # asyncio.run(test_brave_search())
    # asyncio.run(test_cache_roundtrip())
    # asyncio.run(test_failure_logging())
