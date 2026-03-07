from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from httpx import AsyncClient

from tests.conftest import TEST_API_KEY, auth_headers


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


# --- JWT Auth Tests ---


@pytest.mark.asyncio
async def test_jwt_auth_valid_token(jwt_app_client: AsyncClient) -> None:
    mock_key = MagicMock()
    mock_key.key = "test-public-key"

    mock_jwk_client = MagicMock()
    mock_jwk_client.get_signing_key_from_jwt = MagicMock(return_value=mock_key)

    fake_jwt = "eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.fake.token"
    fake_payload = {"sub": "user-123", "role": "authenticated"}

    with (
        patch("app.api.auth._get_jwk_client", return_value=mock_jwk_client),
        patch("app.api.auth._validate_jwt_sync", return_value=fake_payload),
    ):
        resp = await jwt_app_client.post(
            "/api/v1/scrape",
            json={"urls": ["https://example.com"]},
            headers={"Authorization": f"Bearer {fake_jwt}"},
        )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_jwt_auth_invalid_token_falls_through(jwt_app_client: AsyncClient) -> None:
    with patch("app.api.auth._validate_jwt_sync", side_effect=Exception("bad token")):
        resp = await jwt_app_client.post(
            "/api/v1/scrape",
            json={"urls": ["https://example.com"]},
            headers={"Authorization": "Bearer invalid-jwt-token"},
        )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_api_key_still_works_with_jwt_enabled(jwt_app_client: AsyncClient) -> None:
    resp = await jwt_app_client.post(
        "/api/v1/scrape",
        json={"urls": ["https://example.com"]},
        headers={"Authorization": f"Bearer {TEST_API_KEY}"},
    )
    assert resp.status_code == 200
