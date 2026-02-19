"""Network tools — HTTP fetch, headless browser fetch, and scraper-engine tools.

Simple tools (FetchUrl, FetchWithBrowser) use httpx/Playwright directly for
quick requests from the user's residential IP.

Advanced tools (Scrape, Search, Research) delegate to the scraper-service
engine for sophisticated scraping with retry logic, Cloudflare handling,
domain configs, caching, and content extraction.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from app.tools.session import ToolSession
from app.tools.types import ToolResult, ToolResultType

logger = logging.getLogger(__name__)

MAX_RESPONSE_SIZE = 500_000
DEFAULT_TIMEOUT = 30


# ---------------------------------------------------------------------------
# Simple tools (original — direct HTTP/browser)
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Advanced tools (scraper-engine powered)
# ---------------------------------------------------------------------------

def _get_engine() -> Any:
    from app.services.scraper.engine import get_scraper_engine
    return get_scraper_engine()


def _scrape_result_to_output(result: Any) -> str:
    """Format a ScrapeResult into a readable string."""
    parts: list[str] = []

    if result.status == "error":
        parts.append(f"SCRAPE ERROR: {result.error}")
        parts.append(f"URL: {result.url}")
        if result.status_code:
            parts.append(f"Status: {result.status_code}")
        if result.firewall:
            parts.append(f"Firewall: {result.firewall}")
        return "\n".join(parts)

    parts.append(f"URL: {result.url}")
    if result.status_code:
        parts.append(f"Status: {result.status_code}")
    if result.content_type:
        parts.append(f"Content-Type: {result.content_type}")
    if result.from_cache:
        parts.append("(from cache)")
    if result.scraped_at:
        parts.append(f"Scraped: {result.scraped_at}")
    if result.cms:
        parts.append(f"CMS: {result.cms}")
    if result.firewall and result.firewall != "none":
        parts.append(f"Firewall: {result.firewall}")

    parts.append("")

    if result.ai_research_content:
        text = result.ai_research_content
    elif result.text_data:
        text = result.text_data
    else:
        text = "(no text content extracted)"

    if len(text) > MAX_RESPONSE_SIZE:
        text = text[:MAX_RESPONSE_SIZE] + "\n\n... [truncated at 500KB]"
    parts.append(text)

    return "\n".join(parts)


def _scrape_result_to_metadata(result: Any) -> dict[str, Any]:
    """Extract metadata from a ScrapeResult."""
    meta: dict[str, Any] = {
        "status": result.status,
        "url": result.url,
    }
    if result.status_code is not None:
        meta["status_code"] = result.status_code
    if result.content_type:
        meta["content_type"] = result.content_type
    if result.from_cache:
        meta["from_cache"] = True
    if result.cms:
        meta["cms"] = result.cms
    if result.firewall:
        meta["firewall"] = result.firewall
    if result.overview:
        meta["overview"] = result.overview
    if result.links:
        meta["links"] = result.links
    if result.error:
        meta["error"] = result.error
    return meta


async def tool_scrape(
    session: ToolSession,
    urls: list[str],
    use_cache: bool = True,
    output_mode: str = "rich",
    get_links: bool = False,
    get_overview: bool = False,
) -> ToolResult:
    """Scrape one or more URLs using the full scraper engine.

    Features: multi-strategy fetching (HTTP → curl-cffi → Playwright fallback),
    Cloudflare detection, proxy rotation, content extraction (HTML, PDF, images),
    domain-specific parsing rules, and two-tier caching.
    """
    engine = _get_engine()
    if not engine.is_ready:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Scraper engine not initialized. Check logs for startup errors.",
        )

    from app.services.scraper.engine import _import_scraper
    options_mod = _import_scraper("app.models.options")
    FetchOptions = options_mod.FetchOptions

    options = FetchOptions(
        use_cache=use_cache,
        output_mode=output_mode,
        get_links=get_links,
        get_overview=get_overview,
    )

    start = time.monotonic()
    try:
        results = await engine.orchestrator.scrape(urls, options)
    except Exception as e:
        logger.exception("Scrape failed")
        return ToolResult(type=ToolResultType.ERROR, output=f"Scrape failed: {type(e).__name__}: {e}")

    elapsed_ms = int((time.monotonic() - start) * 1000)

    if len(results) == 1:
        r = results[0]
        output = _scrape_result_to_output(r)
        return ToolResult(
            output=output,
            type=ToolResultType.SUCCESS if r.status == "success" else ToolResultType.ERROR,
            metadata={**_scrape_result_to_metadata(r), "elapsed_ms": elapsed_ms},
        )

    output_parts = [f"Scraped {len(results)} URLs in {elapsed_ms}ms\n"]
    success_count = sum(1 for r in results if r.status == "success")
    output_parts.append(f"Success: {success_count}/{len(results)}\n")

    for i, r in enumerate(results, 1):
        output_parts.append(f"--- Result {i}/{len(results)} ---")
        output_parts.append(_scrape_result_to_output(r))
        output_parts.append("")

    all_meta = [_scrape_result_to_metadata(r) for r in results]

    return ToolResult(
        output="\n".join(output_parts),
        metadata={
            "results": all_meta,
            "total": len(results),
            "success_count": success_count,
            "elapsed_ms": elapsed_ms,
        },
    )


async def tool_search(
    session: ToolSession,
    keywords: list[str],
    country: str = "us",
    count: int = 10,
    freshness: str | None = None,
) -> ToolResult:
    """Search the web using Brave Search API.

    Returns structured search results with titles, URLs, descriptions, and snippets.
    Requires BRAVE_API_KEY to be set.
    """
    engine = _get_engine()
    if not engine.is_ready:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Scraper engine not initialized.",
        )

    if not engine.search_client:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Search not available — BRAVE_API_KEY not configured.",
        )

    start = time.monotonic()
    all_results: list[dict[str, Any]] = []

    try:
        for keyword in keywords:
            search_results = await engine.search_client.search_with_retry(
                query=keyword,
                count=min(count, 20),
                country=country,
                extra_snippets=True,
                freshness=freshness,
            )

            if search_results and "web" in search_results and "results" in search_results["web"]:
                for item in search_results["web"]["results"]:
                    all_results.append({
                        "keyword": keyword,
                        "title": item.get("title", ""),
                        "url": item.get("url", ""),
                        "description": item.get("description", ""),
                        "age": item.get("age"),
                    })
    except Exception as e:
        logger.exception("Search failed")
        return ToolResult(type=ToolResultType.ERROR, output=f"Search failed: {type(e).__name__}: {e}")

    elapsed_ms = int((time.monotonic() - start) * 1000)

    if not all_results:
        return ToolResult(
            output="No search results found.",
            metadata={"elapsed_ms": elapsed_ms, "total": 0},
        )

    output_parts = [f"Found {len(all_results)} results in {elapsed_ms}ms\n"]
    for i, r in enumerate(all_results, 1):
        output_parts.append(f"{i}. {r['title']}")
        output_parts.append(f"   {r['url']}")
        if r["description"]:
            desc = r["description"][:200]
            output_parts.append(f"   {desc}")
        output_parts.append("")

    return ToolResult(
        output="\n".join(output_parts),
        metadata={
            "results": all_results,
            "total": len(all_results),
            "elapsed_ms": elapsed_ms,
        },
    )


async def tool_research(
    session: ToolSession,
    query: str,
    country: str = "us",
    effort: str = "medium",
    freshness: str | None = None,
) -> ToolResult:
    """Deep research: search + scrape all results + compile findings.

    Combines Brave Search with the scraper engine to search for a query,
    scrape all result pages, and return compiled content. Effort levels
    control how many pages to scrape: low=10, medium=25, high=50, extreme=100.
    """
    engine = _get_engine()
    if not engine.is_ready:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Scraper engine not initialized.",
        )

    if not engine.search_client:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Research not available — BRAVE_API_KEY not configured.",
        )

    start = time.monotonic()
    pages_scraped = 0
    pages_failed = 0
    all_content: list[str] = []

    try:
        async for event in engine.orchestrator.research(
            query=query,
            country=country,
            effort=effort,
            freshness=freshness,
        ):
            event_type = type(event).__name__

            if event_type == "ResearchPageEvent":
                if event.scraped_content:
                    pages_scraped += 1
                else:
                    pages_failed += 1
            elif event_type == "ResearchDoneEvent":
                all_content.append(event.text_content)

    except Exception as e:
        logger.exception("Research failed")
        return ToolResult(type=ToolResultType.ERROR, output=f"Research failed: {type(e).__name__}: {e}")

    elapsed_ms = int((time.monotonic() - start) * 1000)

    compiled = "\n\n".join(all_content)
    if len(compiled) > MAX_RESPONSE_SIZE:
        compiled = compiled[:MAX_RESPONSE_SIZE] + "\n\n... [truncated at 500KB]"

    output_parts = [
        f"Research complete: {query}",
        f"Pages scraped: {pages_scraped} | Failed: {pages_failed}",
        f"Time: {elapsed_ms}ms",
        "",
        compiled,
    ]

    return ToolResult(
        output="\n".join(output_parts),
        metadata={
            "query": query,
            "pages_scraped": pages_scraped,
            "pages_failed": pages_failed,
            "elapsed_ms": elapsed_ms,
            "content_length": len(compiled),
        },
    )
