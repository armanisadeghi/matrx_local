"""
Proxy endpoint smoke tests.

GET /proxy/status — public endpoint; returns whether the proxy is running.
POST /proxy/start  — requires auth; starts the proxy.
POST /proxy/stop   — requires auth; stops the proxy.
"""

from __future__ import annotations

import httpx


def test_proxy_status_public(http_public: httpx.Client) -> None:
    """GET /proxy/status is public and returns a running field."""
    r = http_public.get("/proxy/status")
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, dict)
    assert "running" in data or "status" in data, (
        f"Expected 'running' or 'status' in proxy response. Got: {list(data.keys())}"
    )


def test_proxy_status_running_is_bool(http_public: httpx.Client) -> None:
    """The 'running' field in /proxy/status is a boolean."""
    r = http_public.get("/proxy/status")
    assert r.status_code == 200
    data = r.json()
    running = data.get("running")
    if running is not None:
        assert isinstance(running, bool), (
            f"Expected bool for 'running', got {type(running).__name__}"
        )


def test_proxy_start_stop(http: httpx.Client) -> None:
    """POST /proxy/stop then /proxy/start round-trips without errors."""
    # Stop first (idempotent — OK if already stopped)
    r_stop = http.post("/proxy/stop")
    assert r_stop.status_code in (200, 204), (
        f"POST /proxy/stop failed: {r_stop.status_code} {r_stop.text}"
    )

    # Restart on default port
    r_start = http.post("/proxy/start", json={"port": 22180})
    assert r_start.status_code in (200, 201, 204), (
        f"POST /proxy/start failed: {r_start.status_code} {r_start.text}"
    )
