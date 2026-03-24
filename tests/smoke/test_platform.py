"""
Platform context and hardware endpoint smoke tests.
"""

from __future__ import annotations

import httpx


def test_platform_context_200(http: httpx.Client) -> None:
    """GET /platform/context returns 200."""
    r = http.get("/platform/context")
    assert r.status_code == 200, r.text


def test_platform_context_has_os(http: httpx.Client) -> None:
    """GET /platform/context includes OS and architecture info."""
    r = http.get("/platform/context")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, dict)
    # At least one of these should be present
    has_os_info = any(
        k in data
        for k in ("os", "platform", "arch", "architecture", "is_mac", "is_windows", "is_linux")
    )
    assert has_os_info, (
        f"Platform context missing OS info. Keys: {list(data.keys())}"
    )


def test_platform_context_refresh(http: httpx.Client) -> None:
    """POST /platform/context/refresh returns 200."""
    r = http.post("/platform/context/refresh")
    assert r.status_code in (200, 204), (
        f"POST /platform/context/refresh returned {r.status_code}: {r.text}"
    )


def test_hardware_200(http: httpx.Client) -> None:
    """GET /hardware returns 200."""
    r = http.get("/hardware")
    assert r.status_code == 200, r.text


def test_hardware_has_data(http: httpx.Client) -> None:
    """GET /hardware returns a non-empty hardware profile."""
    r = http.get("/hardware")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, dict)
    assert len(data) > 0, "Hardware endpoint returned empty dict"


def test_hardware_refresh(http: httpx.Client) -> None:
    """POST /hardware/refresh triggers a hardware re-detection."""
    r = http.post("/hardware/refresh")
    assert r.status_code in (200, 202, 204), (
        f"POST /hardware/refresh returned {r.status_code}: {r.text}"
    )
