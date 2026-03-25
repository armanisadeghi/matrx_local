"""
Cloud sync endpoint smoke tests.

Covers:
- GET  /cloud/debug    — diagnostic info, always works without Supabase
- GET  /cloud/settings — get current settings (hydrateFromEngine)
- PUT  /cloud/settings — update + persist settings (background syncSettings task)
- POST /cloud/settings/reset — reset to defaults
- GET  /cloud/instance — instance info
- POST /cloud/heartbeat — noop heartbeat
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


def test_cloud_settings_get(http: httpx.Client) -> None:
    """GET /cloud/settings returns 200 with settings dict + configured flag."""
    r = http.get("/cloud/settings")
    assert r.status_code == 200, (
        f"GET /cloud/settings returned {r.status_code}: {r.text}"
    )
    data = r.json()
    assert "settings" in data, f"Response missing 'settings' key: {data}"
    assert "configured" in data, f"Response missing 'configured' key: {data}"
    assert isinstance(data["settings"], dict), (
        f"'settings' should be a dict, got {type(data['settings'])}"
    )
    assert isinstance(data["configured"], bool), (
        f"'configured' should be bool, got {type(data['configured'])}"
    )


def test_cloud_settings_update_and_verify(http: httpx.Client) -> None:
    """PUT /cloud/settings stores values; GET reflects them back."""
    test_payload = {
        "settings": {
            "_test_key": "test_value_matrx_ci",
        }
    }
    r_put = http.put("/cloud/settings", json=test_payload)
    assert r_put.status_code == 200, (
        f"PUT /cloud/settings failed: {r_put.status_code} {r_put.text}"
    )
    put_data = r_put.json()
    assert "settings" in put_data, f"PUT response missing 'settings': {put_data}"

    # Confirm the value is stored
    r_get = http.get("/cloud/settings")
    assert r_get.status_code == 200
    get_settings = r_get.json().get("settings", {})
    assert get_settings.get("_test_key") == "test_value_matrx_ci", (
        f"Stored setting not reflected in GET: {get_settings}"
    )


def test_cloud_settings_reset(http: httpx.Client) -> None:
    """POST /cloud/settings/reset returns 200 with a settings dict."""
    r = http.post("/cloud/settings/reset")
    assert r.status_code == 200, (
        f"POST /cloud/settings/reset failed: {r.status_code} {r.text}"
    )
    data = r.json()
    assert "settings" in data, f"Reset response missing 'settings': {data}"
    assert isinstance(data["settings"], dict)


def test_cloud_instance_endpoint(http: httpx.Client) -> None:
    """GET /cloud/instance returns 200 (may be empty when not configured)."""
    r = http.get("/cloud/instance")
    assert r.status_code in (200, 404, 503), (
        f"Unexpected status from /cloud/instance: {r.status_code} {r.text}"
    )


def test_cloud_heartbeat(http: httpx.Client) -> None:
    """POST /cloud/heartbeat returns 200 (noop when not configured)."""
    r = http.post("/cloud/heartbeat")
    assert r.status_code in (200, 503), (
        f"Unexpected status from /cloud/heartbeat: {r.status_code} {r.text}"
    )
    if r.status_code == 200:
        data = r.json()
        assert isinstance(data, dict), f"Heartbeat response should be a dict: {data}"
