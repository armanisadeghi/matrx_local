"""
Settings endpoint smoke tests.

IMPORTANT — architecture note:
  The engine's GET/PUT /settings endpoint manages ONLY engine-level settings
  (headless_scraping, scrape_delay) and cloud-sync-level settings stored in
  the local settings file (~/.matrx/settings.json via SettingsSync).
  
  The full 48-key AppSettings (LLM params, UI prefs, etc.) lives in the
  frontend localStorage. The parity tests verify those stay in sync with
  the Python DEFAULT_SETTINGS definition. Here we test the engine's own
  settings endpoint behavior.
"""

from __future__ import annotations

import httpx


# ---------------------------------------------------------------------------
# Engine-controlled settings keys (what the engine actually stores)
# ---------------------------------------------------------------------------

ENGINE_SETTINGS_KEYS = {
    "headless_scraping",
    "scrape_delay",
}


def test_settings_get_returns_200(http_public: httpx.Client) -> None:
    """GET /settings is public and returns 200."""
    r = http_public.get("/settings")
    assert r.status_code == 200, r.text


def test_settings_get_returns_dict(http_public: httpx.Client) -> None:
    """GET /settings returns a dict."""
    r = http_public.get("/settings")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, dict), f"Expected dict, got {type(data).__name__}"


def test_settings_contains_engine_keys(http_public: httpx.Client) -> None:
    """GET /settings contains the engine-controlled settings."""
    r = http_public.get("/settings")
    assert r.status_code == 200
    data = r.json()
    missing = ENGINE_SETTINGS_KEYS - set(data.keys())
    assert not missing, (
        f"GET /settings missing engine settings: {missing}. Got keys: {list(data.keys())}"
    )


def test_settings_headless_is_bool(http_public: httpx.Client) -> None:
    """headless_scraping setting is a boolean."""
    r = http_public.get("/settings")
    assert r.status_code == 200
    data = r.json()
    if "headless_scraping" in data:
        assert isinstance(data["headless_scraping"], bool), (
            f"headless_scraping should be bool, got {type(data['headless_scraping']).__name__}"
        )


def test_settings_scrape_delay_is_numeric(http_public: httpx.Client) -> None:
    """scrape_delay setting is a number."""
    r = http_public.get("/settings")
    assert r.status_code == 200
    data = r.json()
    if "scrape_delay" in data:
        assert isinstance(data["scrape_delay"], (int, float)), (
            f"scrape_delay should be numeric, got {type(data['scrape_delay']).__name__}"
        )


def test_settings_put_headless_roundtrip(http_public: httpx.Client) -> None:
    """PUT /settings round-trips headless_scraping correctly."""
    r_get = http_public.get("/settings")
    assert r_get.status_code == 200
    original = r_get.json().get("headless_scraping", True)

    flipped = not original
    r_put = http_public.put("/settings", json={"headless_scraping": flipped})
    assert r_put.status_code in (200, 204), (
        f"PUT /settings returned {r_put.status_code}: {r_put.text}"
    )

    r_verify = http_public.get("/settings")
    assert r_verify.status_code == 200
    updated = r_verify.json()
    assert updated.get("headless_scraping") == flipped, (
        f"headless_scraping did not persist: expected {flipped}, got {updated.get('headless_scraping')}"
    )

    # Restore
    http_public.put("/settings", json={"headless_scraping": original})


def test_settings_forbidden_urls(http: httpx.Client) -> None:
    """GET /settings/forbidden-urls returns a list."""
    r = http.get("/settings/forbidden-urls")
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, (list, dict)), (
        f"Expected list or dict from /settings/forbidden-urls, got {type(data).__name__}"
    )


def test_settings_paths(http: httpx.Client) -> None:
    """GET /settings/paths returns the storage paths configuration."""
    r = http.get("/settings/paths")
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, (list, dict)), (
        f"Expected list or dict from /settings/paths, got {type(data).__name__}"
    )
