# User Proxy Integration Guide (Python Backend)

This guide explains how the cloud Python backend can route HTTP requests through a user's local proxy when they've opted in.

## Architecture Overview

When a user has proxy enabled (default: on), their Matrx Local app runs an HTTP forward proxy on `127.0.0.1:22180`. The proxy:

- Supports HTTP CONNECT (HTTPS tunneling) and plain HTTP forwarding
- Binds to `127.0.0.1` only (not exposed to network)
- Auto-selects from port range 22180-22189 if default is taken
- Runs as long as the Matrx Local engine is running

The cloud backend discovers proxy availability via the `app_instances` table in Supabase, which stores each instance's proxy status.

## Cloud Backend: Discovering Available Proxies

```python
from supabase import create_client

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async def get_user_proxies(user_id: str) -> list[dict]:
    """Get all active proxy instances for a user."""
    # Get active instances
    result = supabase.table("app_instances").select("*").eq(
        "user_id", user_id
    ).eq("is_active", True).execute()

    instances = result.data or []

    # Check which ones have proxy enabled in their settings
    proxies = []
    for inst in instances:
        settings_result = supabase.table("app_settings").select(
            "settings_json"
        ).eq("user_id", user_id).eq(
            "instance_id", inst["instance_id"]
        ).execute()

        if settings_result.data:
            settings = settings_result.data[0].get("settings_json", {})
            if settings.get("proxy_enabled", True):
                proxies.append({
                    "instance_id": inst["instance_id"],
                    "hostname": inst["hostname"],
                    "platform": inst["platform"],
                    "last_seen": inst["last_seen"],
                    "proxy_port": settings.get("proxy_port", 22180),
                })

    return proxies
```

## Cloud Backend: Connecting to User's Proxy

The user's proxy is on their local machine at `127.0.0.1`. The cloud server cannot reach it directly. Instead, you need to establish a reverse tunnel or use the proxy information to understand which user's IP to route through.

### Option A: Direct usage within the user's local engine

If code is running on the user's machine (inside the Matrx Local engine), use the proxy directly:

```python
import httpx

PROXY_URL = "http://127.0.0.1:22180"

async def fetch_via_proxy(url: str) -> str:
    """Fetch a URL through the local proxy."""
    async with httpx.AsyncClient(proxy=PROXY_URL, timeout=30) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.text
```

### Option B: Using curl_cffi (for scraping with TLS fingerprinting)

```python
from curl_cffi.requests import AsyncSession

PROXY_URL = "http://127.0.0.1:22180"

async def scrape_via_proxy(url: str) -> str:
    """Scrape a URL through the local proxy with browser TLS fingerprint."""
    async with AsyncSession(impersonate="chrome") as session:
        resp = await session.get(
            url,
            proxies={"http": PROXY_URL, "https": PROXY_URL},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.text
```

### Option C: Using Playwright with proxy

```python
from playwright.async_api import async_playwright

PROXY_URL = "http://127.0.0.1:22180"

async def browser_scrape_via_proxy(url: str) -> str:
    """Scrape a URL via browser through the local proxy."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            proxy={"server": PROXY_URL},
            headless=True,
        )
        page = await browser.new_page()
        await page.goto(url, wait_until="domcontentloaded")
        content = await page.content()
        await browser.close()
        return content
```

## Engine API Endpoints

The Matrx Local engine exposes these proxy management endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/proxy/status` | Get proxy running state, port, stats |
| POST | `/proxy/start` | Start the proxy server |
| POST | `/proxy/stop` | Stop the proxy server |
| POST | `/proxy/test` | Test proxy connectivity |

### Example: Check proxy status

```bash
curl http://127.0.0.1:22140/proxy/status
```

Response:
```json
{
  "running": true,
  "port": 22180,
  "proxy_url": "http://127.0.0.1:22180",
  "request_count": 42,
  "bytes_forwarded": 1048576,
  "active_connections": 2,
  "uptime_seconds": 3600.0
}
```

### Example: Test proxy connectivity

```bash
curl -X POST http://127.0.0.1:22140/proxy/test
```

Response:
```json
{
  "success": true,
  "status_code": 200,
  "body": "{\"origin\": \"203.0.113.45\"}",
  "proxy_url": "http://127.0.0.1:22180"
}
```

## Cloud Database Schema

### `app_instances` table
Stores each registered installation. Key fields for proxy:
- `instance_id` (text) - Stable machine identifier
- `hostname` (text) - Machine hostname
- `platform` (text) - OS (darwin, linux, win32)
- `last_seen` (timestamptz) - Last heartbeat
- `is_active` (boolean) - Whether instance is currently active

### `app_settings` table
Stores settings per instance as a JSON blob:
- `settings_json.proxy_enabled` (boolean, default true)
- `settings_json.proxy_port` (integer, default 22180)

### `app_sync_status` table
Tracks sync state between local and cloud.

## Integration Checklist

1. Query `app_instances` + `app_settings` for user's proxy-enabled instances
2. Filter by `last_seen` within acceptable window (e.g., last 5 minutes = likely online)
3. Use the proxy URL format: `http://127.0.0.1:{proxy_port}`
4. Handle proxy unavailability gracefully (fall back to direct connection or datacenter proxy)
5. Respect user's opt-out: if `proxy_enabled` is false, do not route through their machine
