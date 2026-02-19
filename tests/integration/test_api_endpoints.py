from __future__ import annotations

import json

import pytest
from httpx import AsyncClient

from tests.conftest import auth_headers


@pytest.mark.asyncio
async def test_health_no_auth(app_client: AsyncClient) -> None:
    resp = await app_client.get("/api/v1/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("ok", "degraded")


@pytest.mark.asyncio
async def test_scrape_requires_auth(app_client: AsyncClient) -> None:
    resp = await app_client.post("/api/v1/scrape", json={"urls": ["https://example.com"]})
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_scrape_bad_api_key(app_client: AsyncClient) -> None:
    resp = await app_client.post(
        "/api/v1/scrape",
        json={"urls": ["https://example.com"]},
        headers={"Authorization": "Bearer wrong-key"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_scrape_success(app_client: AsyncClient) -> None:
    resp = await app_client.post(
        "/api/v1/scrape",
        json={"urls": ["https://example.com"]},
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert len(data["results"]) == 1
    assert data["results"][0]["url"] == "https://example.com"
    assert "execution_time_ms" in data


@pytest.mark.asyncio
async def test_scrape_empty_urls_rejected(app_client: AsyncClient) -> None:
    resp = await app_client.post(
        "/api/v1/scrape",
        json={"urls": []},
        headers=auth_headers(),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_scrape_stream_sse(app_client: AsyncClient) -> None:
    resp = await app_client.post(
        "/api/v1/scrape/stream",
        json={"urls": ["https://example.com"]},
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    text = resp.text
    assert "event: page_result" in text
    assert "event: done" in text


@pytest.mark.asyncio
async def test_search_success(app_client: AsyncClient) -> None:
    resp = await app_client.post(
        "/api/v1/search",
        json={"keywords": ["python web scraping"]},
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    assert data["results"][0]["url"] == "https://example.com"


@pytest.mark.asyncio
async def test_search_and_scrape_success(app_client: AsyncClient) -> None:
    resp = await app_client.post(
        "/api/v1/search-and-scrape",
        json={"keywords": ["test query"]},
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert "search_results" in data
    assert "scrape_results" in data


@pytest.mark.asyncio
async def test_search_and_scrape_stream_sse(app_client: AsyncClient) -> None:
    resp = await app_client.post(
        "/api/v1/search-and-scrape/stream",
        json={"keywords": ["test query"]},
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    text = resp.text
    assert "event: search_done" in text
    assert "event: done" in text


@pytest.mark.asyncio
async def test_research_sse(app_client: AsyncClient) -> None:
    resp = await app_client.post(
        "/api/v1/research",
        json={"query": "best web scraping practices"},
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    text = resp.text
    assert "event: done" in text


@pytest.mark.asyncio
async def test_domain_config_list(app_client: AsyncClient) -> None:
    resp = await app_client.get(
        "/api/v1/config/domains",
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_scrape_with_options(app_client: AsyncClient) -> None:
    resp = await app_client.post(
        "/api/v1/scrape",
        json={
            "urls": ["https://example.com"],
            "options": {
                "use_cache": False,
                "output_mode": "research",
                "get_text_data": True,
                "get_links": True,
            },
        },
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"


@pytest.mark.asyncio
async def test_search_validation(app_client: AsyncClient) -> None:
    resp = await app_client.post(
        "/api/v1/search",
        json={"keywords": []},
        headers=auth_headers(),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_research_validation(app_client: AsyncClient) -> None:
    resp = await app_client.post(
        "/api/v1/research",
        json={"query": "", "effort": "invalid"},
        headers=auth_headers(),
    )
    assert resp.status_code == 422
