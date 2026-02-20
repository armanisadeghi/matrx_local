"""Browser automation tools — navigate, interact, extract, and screenshot web pages.

Uses Playwright for full browser control. Falls back gracefully if not installed.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import uuid
from pathlib import Path

from app.config import TEMP_DIR
from app.tools.session import ToolSession
from app.tools.types import ImageData, ToolResult, ToolResultType

logger = logging.getLogger(__name__)

# Module-level browser state (shared across sessions for efficiency)
_browser_context = None
_browser_instance = None
_playwright_instance = None

SCREENSHOTS_DIR = TEMP_DIR / "browser_screenshots"


async def _get_browser():
    """Get or create a shared browser instance."""
    global _browser_instance, _playwright_instance, _browser_context

    if _browser_instance and _browser_instance.is_connected():
        return _browser_context

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return None

    _playwright_instance = await async_playwright().start()

    try:
        _browser_instance = await _playwright_instance.chromium.launch(
            headless=False,  # User can see the browser
            args=["--no-first-run", "--no-default-browser-check"],
        )
    except Exception:
        # Fallback to headless if headed fails
        _browser_instance = await _playwright_instance.chromium.launch(headless=True)

    _browser_context = await _browser_instance.new_context(
        viewport={"width": 1280, "height": 720},
        user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    )

    return _browser_context


async def _get_page(context, url: str | None = None):
    """Get the current active page or create a new one."""
    pages = context.pages
    if pages:
        page = pages[-1]
        if url:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        return page

    page = await context.new_page()
    if url:
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
    return page


async def tool_browser_navigate(
    session: ToolSession,
    url: str,
    wait_for: str | None = None,
    timeout: int = 30,
) -> ToolResult:
    """Navigate to a URL in a controlled browser. Optionally wait for a CSS selector."""
    context = await _get_browser()
    if context is None:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Playwright not installed. Install: pip install playwright && playwright install chromium",
        )

    try:
        page = await _get_page(context, url)

        if wait_for:
            await page.wait_for_selector(wait_for, timeout=timeout * 1000)

        title = await page.title()
        current_url = page.url

        return ToolResult(
            output=f"Navigated to: {current_url}\nTitle: {title}",
            metadata={
                "url": current_url,
                "title": title,
            },
        )

    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Navigation failed: {e}")


async def tool_browser_click(
    session: ToolSession,
    selector: str,
    timeout: int = 10,
) -> ToolResult:
    """Click an element on the current page by CSS selector."""
    context = await _get_browser()
    if context is None:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Playwright not installed. Install: pip install playwright && playwright install chromium",
        )

    try:
        page = await _get_page(context)

        await page.click(selector, timeout=timeout * 1000)

        # Wait briefly for any navigation/updates
        await asyncio.sleep(0.5)

        return ToolResult(
            output=f"Clicked: {selector}\nCurrent URL: {page.url}",
            metadata={"selector": selector, "url": page.url},
        )

    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Click failed: {e}")


async def tool_browser_type(
    session: ToolSession,
    selector: str,
    text: str,
    clear_first: bool = True,
    press_enter: bool = False,
    timeout: int = 10,
) -> ToolResult:
    """Type text into an input element by CSS selector."""
    context = await _get_browser()
    if context is None:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Playwright not installed. Install: pip install playwright && playwright install chromium",
        )

    try:
        page = await _get_page(context)

        if clear_first:
            await page.fill(selector, text, timeout=timeout * 1000)
        else:
            await page.type(selector, text, timeout=timeout * 1000)

        if press_enter:
            await page.press(selector, "Enter")
            await asyncio.sleep(1)

        return ToolResult(
            output=f"Typed into {selector}: '{text[:50]}{'...' if len(text) > 50 else ''}'",
            metadata={"selector": selector, "url": page.url},
        )

    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Type failed: {e}")


async def tool_browser_extract(
    session: ToolSession,
    selector: str | None = None,
    extract_type: str = "text",
    attribute: str | None = None,
    all_matches: bool = False,
) -> ToolResult:
    """Extract content from the current page.

    extract_type: text, html, attribute, links, tables, all_text
    """
    context = await _get_browser()
    if context is None:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Playwright not installed. Install: pip install playwright && playwright install chromium",
        )

    try:
        page = await _get_page(context)

        if extract_type == "all_text":
            text = await page.inner_text("body")
            return ToolResult(
                output=text[:10000] + ("..." if len(text) > 10000 else ""),
                metadata={"url": page.url, "length": len(text)},
            )

        if extract_type == "links":
            links = await page.eval_on_selector_all(
                "a[href]",
                """elements => elements.map(el => ({
                    text: el.innerText.trim().substring(0, 100),
                    href: el.href
                })).filter(l => l.href && !l.href.startsWith('javascript:'))"""
            )
            lines = [f"Links on {page.url}:"]
            for link in links[:100]:
                lines.append(f"  [{link['text'][:60]}] → {link['href']}")
            return ToolResult(
                output="\n".join(lines),
                metadata={"links": links[:100], "count": len(links)},
            )

        if extract_type == "tables":
            tables = await page.eval_on_selector_all(
                "table",
                """tables => tables.map(table => {
                    const rows = Array.from(table.querySelectorAll('tr'));
                    return rows.map(row => {
                        const cells = Array.from(row.querySelectorAll('td, th'));
                        return cells.map(cell => cell.innerText.trim());
                    });
                })"""
            )
            lines = [f"Tables on {page.url}: {len(tables)} found"]
            for i, table in enumerate(tables[:5]):
                lines.append(f"\nTable {i + 1}:")
                for row in table[:20]:
                    lines.append("  | " + " | ".join(row) + " |")
            return ToolResult(
                output="\n".join(lines),
                metadata={"tables": tables[:5]},
            )

        if not selector:
            return ToolResult(type=ToolResultType.ERROR, output="Selector required for this extract_type.")

        if all_matches:
            if extract_type == "text":
                results = await page.eval_on_selector_all(
                    selector, "els => els.map(el => el.innerText.trim())"
                )
            elif extract_type == "html":
                results = await page.eval_on_selector_all(
                    selector, "els => els.map(el => el.innerHTML)"
                )
            elif extract_type == "attribute" and attribute:
                results = await page.eval_on_selector_all(
                    selector, f"els => els.map(el => el.getAttribute('{attribute}'))"
                )
            else:
                results = await page.eval_on_selector_all(
                    selector, "els => els.map(el => el.innerText.trim())"
                )

            output = "\n---\n".join(str(r) for r in results[:50])
            return ToolResult(
                output=f"Found {len(results)} matches:\n{output}",
                metadata={"results": results[:50], "count": len(results)},
            )
        else:
            element = await page.query_selector(selector)
            if not element:
                return ToolResult(type=ToolResultType.ERROR, output=f"Element not found: {selector}")

            if extract_type == "text":
                result = await element.inner_text()
            elif extract_type == "html":
                result = await element.inner_html()
            elif extract_type == "attribute" and attribute:
                result = await element.get_attribute(attribute) or ""
            else:
                result = await element.inner_text()

            return ToolResult(
                output=result[:10000],
                metadata={"selector": selector, "url": page.url},
            )

    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Extraction failed: {e}")


async def tool_browser_screenshot(
    session: ToolSession,
    full_page: bool = False,
    selector: str | None = None,
) -> ToolResult:
    """Take a screenshot of the current browser page or a specific element."""
    context = await _get_browser()
    if context is None:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Playwright not installed. Install: pip install playwright && playwright install chromium",
        )

    try:
        page = await _get_page(context)

        SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
        filename = f"browser_{uuid.uuid4().hex[:8]}.png"
        filepath = SCREENSHOTS_DIR / filename

        if selector:
            element = await page.query_selector(selector)
            if not element:
                return ToolResult(type=ToolResultType.ERROR, output=f"Element not found: {selector}")
            screenshot_bytes = await element.screenshot()
        else:
            screenshot_bytes = await page.screenshot(full_page=full_page)

        filepath.write_bytes(screenshot_bytes)
        b64 = base64.b64encode(screenshot_bytes).decode()

        return ToolResult(
            output=f"Browser screenshot: {filepath} ({len(screenshot_bytes)} bytes)\nURL: {page.url}",
            image=ImageData(media_type="image/png", base64_data=b64),
            metadata={"path": str(filepath), "url": page.url},
        )

    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Screenshot failed: {e}")


async def tool_browser_eval(
    session: ToolSession,
    javascript: str,
) -> ToolResult:
    """Execute JavaScript in the current browser page and return the result."""
    context = await _get_browser()
    if context is None:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Playwright not installed. Install: pip install playwright && playwright install chromium",
        )

    try:
        page = await _get_page(context)
        result = await page.evaluate(javascript)

        output = str(result) if result is not None else "(no return value)"
        if len(output) > 10000:
            output = output[:10000] + "..."

        return ToolResult(
            output=output,
            metadata={"url": page.url, "result": result if isinstance(result, (str, int, float, bool, list, dict)) else str(result)},
        )

    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"JS evaluation failed: {e}")


async def tool_browser_tabs(
    session: ToolSession,
    action: str = "list",
    tab_index: int | None = None,
    url: str | None = None,
) -> ToolResult:
    """Manage browser tabs. Actions: list, new, close, switch.

    list: List all open tabs
    new: Open new tab (optionally with url)
    close: Close tab at index
    switch: Switch to tab at index
    """
    context = await _get_browser()
    if context is None:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Playwright not installed. Install: pip install playwright && playwright install chromium",
        )

    try:
        pages = context.pages

        if action == "list":
            lines = ["Open tabs:"]
            for i, page in enumerate(pages):
                title = await page.title()
                lines.append(f"  [{i}] {title[:60]} — {page.url}")
            return ToolResult(
                output="\n".join(lines),
                metadata={"tabs": [{"index": i, "url": p.url} for i, p in enumerate(pages)]},
            )

        elif action == "new":
            page = await context.new_page()
            if url:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            title = await page.title()
            return ToolResult(output=f"New tab [{len(pages)}]: {title} — {page.url}")

        elif action == "close":
            if tab_index is None or tab_index >= len(pages):
                return ToolResult(type=ToolResultType.ERROR, output=f"Invalid tab index. {len(pages)} tabs open.")
            await pages[tab_index].close()
            return ToolResult(output=f"Closed tab [{tab_index}]")

        elif action == "switch":
            if tab_index is None or tab_index >= len(pages):
                return ToolResult(type=ToolResultType.ERROR, output=f"Invalid tab index. {len(pages)} tabs open.")
            await pages[tab_index].bring_to_front()
            title = await pages[tab_index].title()
            return ToolResult(output=f"Switched to tab [{tab_index}]: {title}")

        else:
            return ToolResult(type=ToolResultType.ERROR, output="Action must be: list, new, close, switch")

    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Tab operation failed: {e}")
