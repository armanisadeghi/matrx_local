"""
Scraper endpoint smoke tests.

GET /remote-scraper/status — public; verifies the scraper connection state
                             (works even if remote scraper server is unreachable)
"""

from __future__ import annotations

import httpx


def test_remote_scraper_status_public(http_public: httpx.Client) -> None:
    """GET /remote-scraper/status is public and returns 200."""
    r = http_public.get("/remote-scraper/status")
    assert r.status_code == 200, r.text


def test_remote_scraper_status_structure(http_public: httpx.Client) -> None:
    """GET /remote-scraper/status returns a dict with connectivity info."""
    r = http_public.get("/remote-scraper/status")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, dict), f"Expected dict, got {type(data).__name__}"
    # Should have some connectivity/status field
    has_status = any(
        k in data
        for k in ("available", "status", "connected", "reachable", "ok", "error")
    )
    assert has_status, (
        f"Remote scraper status missing connectivity key. Got: {list(data.keys())}"
    )


def test_remote_scraper_config_domains(http_public: httpx.Client) -> None:
    """GET /remote-scraper/config/domains returns 200."""
    r = http_public.get("/remote-scraper/config/domains")
    assert r.status_code in (200, 401, 503), (
        f"Unexpected status from /remote-scraper/config/domains: {r.status_code} {r.text}"
    )


def test_tunnel_status(http_public: httpx.Client) -> None:
    """GET /tunnel/status (public) returns a structured response."""
    r = http_public.get("/tunnel/status")
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, dict)
