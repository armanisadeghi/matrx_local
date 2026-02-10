"""Network tools — HTTP fetch (scraping proxy) and headless browser fetch.

FetchUrl uses the user's residential IP via httpx — dramatically better than
data-center proxies for bypassing anti-bot systems.

FetchWithBrowser uses Playwright for JS-rendered pages.
"""

from __future__ import annotations

import logging
import time

from app.tools.session import ToolSession
from app.tools.types import ToolResult, ToolResultType

logger = logging.getLogger(__name__)

MAX_RESPONSE_SIZE = 500_000
DEFAULT_TIMEOUT = 30


async def tool_fetch_url(
    session: ToolSession,
    url: str,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: str | None = None,
    follow_redirects: bool = True,
    timeout: int = DEFAULT_TIMEOUT,
) -> ToolResult:
    try:
        import httpx
    except ImportError:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="HTTP fetch requires httpx. Install it with: uv add httpx",
        )

    req_headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if headers:
        req_headers.update(headers)

    start = time.monotonic()
    try:
        async with httpx.AsyncClient(
            follow_redirects=follow_redirects,
            timeout=httpx.Timeout(timeout),
        ) as client:
            response = await client.request(
                method=method.upper(),
                url=url,
                headers=req_headers,
                content=body.encode("utf-8") if body else None,
            )
    except httpx.TimeoutException:
        return ToolResult(type=ToolResultType.ERROR, output=f"Request timed out after {timeout}s")
    except httpx.RequestError as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Request failed: {type(e).__name__}: {e}")

    elapsed_ms = int((time.monotonic() - start) * 1000)

    body_text = response.text
    if len(body_text) > MAX_RESPONSE_SIZE:
        body_text = body_text[:MAX_RESPONSE_SIZE] + "\n\n... [truncated at 500KB]"

    resp_headers = dict(response.headers)

    output_parts = [
        f"HTTP {response.status_code} {response.reason_phrase}",
        f"URL: {response.url}",
        f"Time: {elapsed_ms}ms",
        f"Content-Type: {response.headers.get('content-type', 'unknown')}",
        f"Content-Length: {len(response.content)} bytes",
        "",
        body_text,
    ]

    return ToolResult(
        output="\n".join(output_parts),
        metadata={
            "status_code": response.status_code,
            "headers": resp_headers,
            "url": str(response.url),
            "elapsed_ms": elapsed_ms,
            "content_length": len(response.content),
        },
    )


async def tool_fetch_with_browser(
    session: ToolSession,
    url: str,
    wait_for: str | None = None,
    wait_timeout: int = 30000,
    extract_text: bool = False,
) -> ToolResult:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return ToolResult(
            type=ToolResultType.ERROR,
            output=(
                "Browser fetch requires playwright. Install with:\n"
                "  uv add playwright\n"
                "  playwright install chromium"
            ),
        )

    start = time.monotonic()
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1920, "height": 1080},
            )
            page = await context.new_page()

            response = await page.goto(url, wait_until="domcontentloaded", timeout=wait_timeout)

            if wait_for:
                await page.wait_for_selector(wait_for, timeout=wait_timeout)
            else:
                await page.wait_for_load_state("networkidle", timeout=wait_timeout)

            if extract_text:
                content = await page.inner_text("body")
            else:
                content = await page.content()

            status = response.status if response else 0
            final_url = page.url

            await browser.close()
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Browser fetch failed: {type(e).__name__}: {e}")

    elapsed_ms = int((time.monotonic() - start) * 1000)

    if len(content) > MAX_RESPONSE_SIZE:
        content = content[:MAX_RESPONSE_SIZE] + "\n\n... [truncated at 500KB]"

    output_parts = [
        f"HTTP {status}",
        f"URL: {final_url}",
        f"Time: {elapsed_ms}ms",
        f"Mode: {'text extraction' if extract_text else 'full HTML'}",
        "",
        content,
    ]

    return ToolResult(
        output="\n".join(output_parts),
        metadata={
            "status_code": status,
            "url": final_url,
            "elapsed_ms": elapsed_ms,
            "content_length": len(content),
        },
    )
