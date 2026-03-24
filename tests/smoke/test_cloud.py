"""
Cloud sync endpoint smoke tests.

GET /cloud/debug — returns structured diagnostic info; does NOT require
                   a real Supabase connection (works when not configured).
"""

from __future__ import annotations

import httpx


def test_cloud_debug_returns_200(http: httpx.Client) -> None:
    """GET /cloud/debug returns 200."""
    r = http.get("/cloud/debug")
    assert r.status_code == 200, r.text


def test_cloud_debug_has_required_fields(http: httpx.Client) -> None:
    """GET /cloud/debug returns expected diagnostic fields."""
    r = http.get("/cloud/debug")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, dict)
    expected_fields = {"is_configured", "is_orphan"}
    missing = expected_fields - set(data.keys())
    assert not missing, (
        f"/cloud/debug response missing fields: {missing}. Got: {list(data.keys())}"
    )


def test_cloud_settings_endpoint(http: httpx.Client) -> None:
    """GET /cloud/settings returns 200 (may be not-configured but not a 500)."""
    r = http.get("/cloud/settings")
    assert r.status_code in (200, 404, 503), (
        f"Unexpected status from /cloud/settings: {r.status_code} {r.text}"
    )


def test_cloud_instance_endpoint(http: httpx.Client) -> None:
    """GET /cloud/instance returns 200 (may be empty when not configured)."""
    r = http.get("/cloud/instance")
    assert r.status_code in (200, 404, 503), (
        f"Unexpected status from /cloud/instance: {r.status_code} {r.text}"
    )
