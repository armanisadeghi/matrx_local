from __future__ import annotations

from typing import Any, AsyncGenerator, Optional
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.cache.page_cache import PageCache
from app.config import Settings
from app.core.fetcher.fetcher import UnifiedFetcher
from app.core.orchestrator import ScrapeOrchestrator
from app.core.search import BraveSearchClient
from app.domain_config.config_store import DomainConfigStore
from app.main import create_app
from app.models.enums import ContentType, Firewall


TEST_API_KEY = "test-api-key-123"


class _MockAcquireContext:
    def __init__(self, conn: AsyncMock) -> None:
        self._conn = conn

    async def __aenter__(self) -> AsyncMock:
        return self._conn

    async def __aexit__(self, *args: object) -> None:
        pass


def _make_settings() -> Settings:
    return Settings(
        API_KEY=TEST_API_KEY,
        DATABASE_URL="postgresql://test:test@localhost:5433/test",
        BRAVE_API_KEY="brave-test-key",
        BRAVE_API_KEY_AI="brave-ai-test-key",
        PLAYWRIGHT_POOL_SIZE=1,
    )


def _make_mock_fetch_response(
    *,
    content: str = "<html><body><h1>Test</h1><p>Content</p></body></html>",
    content_type: ContentType = ContentType.HTML,
    status_code: int = 200,
    failed: bool = False,
) -> MagicMock:
    resp = MagicMock()
    resp.content = content
    resp.content_bytes = content.encode()
    resp.content_type = content_type
    resp.status_code = status_code
    resp.failed = failed
    resp.failed_reasons = [] if not failed else ["test failure"]
    resp.failed_primary_reason = "test failure" if failed else None
    resp.proxy_used = False
    resp.cms_primary = None
    resp.firewall = Firewall.NONE
    resp.url = "https://example.com"
    resp.metadata = {}
    return resp


@pytest_asyncio.fixture
async def app_client() -> AsyncGenerator[AsyncClient, None]:
    app = create_app()
    settings = _make_settings()

    mock_conn = AsyncMock()
    mock_conn.fetchval = AsyncMock(return_value=1)
    mock_conn.fetch = AsyncMock(return_value=[])
    mock_conn.fetchrow = AsyncMock(return_value=None)
    mock_conn.execute = AsyncMock()

    mock_pool = MagicMock()
    mock_pool.acquire = MagicMock(return_value=_MockAcquireContext(mock_conn))

    mock_fetcher = MagicMock(spec=UnifiedFetcher)
    mock_fetcher.fetch_with_retry = AsyncMock(return_value=_make_mock_fetch_response())

    mock_domain_store = MagicMock(spec=DomainConfigStore)
    mock_domain_store.is_scrape_allowed = MagicMock(return_value=True)
    mock_domain_store.all_domains = []

    mock_cache = MagicMock(spec=PageCache)
    mock_cache.get = AsyncMock(return_value=None)
    mock_cache.set = AsyncMock()

    mock_search_client = MagicMock(spec=BraveSearchClient)
    mock_search_client.search_with_retry = AsyncMock(return_value={
        "web": {"results": [
            {"title": "Test Result", "url": "https://example.com", "description": "Test desc"},
        ]},
    })
    mock_search_client.multi_search = AsyncMock(return_value=[
        ("test query", {"web": {"results": [
            {"title": "Test Result", "url": "https://example.com", "description": "Test desc"},
        ]}}),
    ])

    orchestrator = ScrapeOrchestrator(
        fetcher=mock_fetcher,
        settings=settings,
        db_pool=mock_pool,
        page_cache=mock_cache,
        domain_config_store=mock_domain_store,
        search_client=mock_search_client,
    )

    app.state.db_pool = mock_pool
    app.state.settings = settings
    app.state.browser_pool = None
    app.state.fetcher = mock_fetcher
    app.state.domain_config_store = mock_domain_store
    app.state.page_cache = mock_cache
    app.state.search_client = mock_search_client
    app.state.orchestrator = orchestrator

    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {TEST_API_KEY}"}
