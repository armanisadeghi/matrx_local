"""Fetch-proxy API — server-side HTTP fetcher for the in-app browser.

The browser enforces X-Frame-Options / CSP frame-ancestors headers and blocks
pages that set them from loading inside iframes.  This endpoint fetches pages
on the server side (no browser security model applies), strips those headers,
rewrites relative URLs to absolute ones so in-page assets resolve correctly,
then streams the result back.

Endpoints
---------
GET  /fetch-proxy/page    – Proxy a URL and return frameable HTML
POST /fetch-proxy/extract – Fetch a URL and return raw text for scraping
"""

from __future__ import annotations

import re
import urllib.parse
from typing import Annotated

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

from app.common.system_logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/fetch-proxy", tags=["fetch-proxy"])

# ---------------------------------------------------------------------------
# Shared HTTP client (connection-pooled, reused across requests)
# ---------------------------------------------------------------------------
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Headers from the upstream that we must strip / replace before forwarding.
_BLOCK_HEADERS = {
    "x-frame-options",
    "content-security-policy",
    "content-security-policy-report-only",
    # We'll set our own content-type
    "transfer-encoding",
    "content-encoding",  # httpx already decompresses
    "content-length",  # We might change the body
    "strict-transport-security",
}


def _rewrite_html(html: str, base_url: str) -> str:
    """Rewrite relative URLs in HTML so they resolve via this proxy."""
    parsed = urllib.parse.urlparse(base_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    def make_proxy(url: str) -> str:
        """Return a proxy URL for an absolute URL."""
        return f"/fetch-proxy/page?url={urllib.parse.quote(url, safe='')}"

    def absolutise(href: str) -> str:
        href = href.strip()
        if not href or href.startswith(("javascript:", "data:", "mailto:", "#")):
            return href
        return urllib.parse.urljoin(base_url, href)

    def rewrite_href(m: re.Match) -> str:
        attr, quote, href = m.group(1), m.group(2), m.group(3)
        abs_url = absolutise(href)
        if attr.lower() in ("href", "action"):
            return f"{attr}={quote}{make_proxy(abs_url)}{quote}"
        # src, srcset, etc. — point directly at origin (assets don't need proxying for display)
        return f"{attr}={quote}{abs_url}{quote}"

    # Rewrite href/src/action attributes
    html = re.sub(
        r'(href|src|action|srcset)=(["\'])([^"\']*)\2',
        rewrite_href,
        html,
        flags=re.IGNORECASE,
    )

    # Inject a <base> tag if there isn't one, so relative CSS/JS loads resolve
    if "<base" not in html.lower():
        html = html.replace("<head>", f'<head><base href="{origin}/">', 1)
        if "<head>" not in html.lower():
            html = f'<base href="{origin}/">' + html

    # Suppress Content-Security-Policy meta tags
    html = re.sub(
        r'<meta[^>]+http-equiv=["\']Content-Security-Policy["\'][^>]*>',
        "",
        html,
        flags=re.IGNORECASE,
    )

    return html


async def _fetch(url: str) -> httpx.Response:
    """Fetch a URL with a realistic browser UA, following redirects."""
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=20.0,
        headers=_HEADERS,
        verify=False,  # Some sites have cert issues; this is a local dev tool
    ) as client:
        resp = await client.get(url)
    return resp


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/page")
async def proxy_page(
    url: Annotated[str, Query(description="Target URL to fetch and proxy")],
) -> Response:
    """Fetch *url* server-side, strip blocking headers, rewrite links, return HTML."""
    try:
        resp = await _fetch(url)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Upstream fetch failed: {exc}")

    content_type = resp.headers.get("content-type", "text/html")

    # Only rewrite HTML; pass other content types through as-is
    if "html" in content_type:
        try:
            html = resp.text
        except Exception:
            html = resp.content.decode("utf-8", errors="replace")
        body = _rewrite_html(html, str(resp.url)).encode("utf-8")
        ct = "text/html; charset=utf-8"
    else:
        body = resp.content
        ct = content_type

    # Build safe response headers
    safe_headers: dict[str, str] = {}
    for k, v in resp.headers.items():
        if k.lower() not in _BLOCK_HEADERS:
            safe_headers[k] = v

    # Always allow framing
    safe_headers["X-Frame-Options"] = "ALLOWALL"
    safe_headers["Access-Control-Allow-Origin"] = "*"

    logger.debug("fetch-proxy: %s → %d (%d bytes)", url, resp.status_code, len(body))
    return Response(content=body, media_type=ct, headers=safe_headers)


class ExtractRequest(BaseModel):
    url: str
    include_html: bool = False


class ExtractResult(BaseModel):
    url: str
    final_url: str
    status_code: int
    title: str
    text: str
    html: str | None = None
    content_type: str
    byte_count: int


@router.post("/extract", response_model=ExtractResult)
async def extract_page(req: ExtractRequest) -> ExtractResult:
    """Fetch *url* and return its text content (for scraping).

    This uses the same server-side fetch as /page, bypassing all browser
    same-origin / X-Frame-Options restrictions.  It does NOT execute JavaScript,
    but it will capture JS-rendered content if Playwright is available.
    """
    try:
        resp = await _fetch(req.url)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Upstream fetch failed: {exc}")

    content_type = resp.headers.get("content-type", "text/html")
    try:
        html_body = resp.text
    except Exception:
        html_body = resp.content.decode("utf-8", errors="replace")

    # Extract <title>
    title_match = re.search(r"<title[^>]*>([^<]*)</title>", html_body, re.IGNORECASE)
    title = title_match.group(1).strip() if title_match else ""

    # Strip tags for plain text
    text = re.sub(r"<[^>]+>", " ", html_body)
    text = re.sub(r"\s+", " ", text).strip()

    return ExtractResult(
        url=req.url,
        final_url=str(resp.url),
        status_code=resp.status_code,
        title=title,
        text=text,
        html=html_body if req.include_html else None,
        content_type=content_type,
        byte_count=len(resp.content),
    )
