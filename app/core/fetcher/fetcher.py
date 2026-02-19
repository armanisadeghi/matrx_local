from __future__ import annotations

import asyncio
import json
import logging
import random
import re
from datetime import datetime
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from curl_cffi.requests import AsyncSession
from httpx import Timeout
from selectolax.parser import HTMLParser

from app.config import Settings
from app.core.fetcher.browser_pool import PlaywrightBrowserPool
from app.core.fetcher.models import (
    CLOUDFLARE_RETRY_CSS_SELECTORS,
    EXTENSION_MAP,
    RETRY_CSS_SELECTORS,
    ROTATE_PROXY_ERRORS,
    URL_EXT_MAP,
    FetchResponse,
)
from app.core.fetcher.profiles import get_random_profile
from app.models.enums import (
    BINARY_CONTENT_TYPES,
    EXTRACTABLE_CONTENT_TYPES,
    CMS,
    ContentType,
    FailureReason,
    Firewall,
    RequestType,
)

logger = logging.getLogger(__name__)


def _detect_content_type_from_url(url: str) -> Optional[ContentType]:
    parsed = urlparse(url)
    path_part = parsed.path.rstrip("/")
    ext = path_part.rsplit(".", 1)[-1].lower() if "." in path_part else ""
    return URL_EXT_MAP.get(ext)


def _is_retryable_failure(response: FetchResponse) -> bool:
    if not response.failed:
        return False
    retryable = {FailureReason.REQUEST_ERROR.value, FailureReason.PROXY_ERROR.value, FailureReason.BAD_STATUS.value}
    for reason_dict in response.failed_reasons:
        for key in reason_dict:
            if key in retryable:
                return True
    return False


def _to_iso(timestamp: Optional[str]) -> Optional[str]:
    if not timestamp:
        return None
    try:
        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        return dt.isoformat()
    except (ValueError, TypeError):
        return timestamp


class UnifiedFetcher:
    def __init__(
        self,
        settings: Settings,
        browser_pool: Optional[PlaywrightBrowserPool] = None,
    ) -> None:
        self._settings = settings
        self._browser_pool = browser_pool

    def _get_random_proxy(self, proxy_list: Optional[list[str]] = None) -> Optional[str]:
        proxies = proxy_list or self._settings.datacenter_proxy_list
        return random.choice(proxies) if proxies else None

    def _get_different_proxy(self, exclude: Optional[str] = None) -> Optional[str]:
        proxies = self._settings.datacenter_proxy_list
        if exclude:
            proxies = [p for p in proxies if p != exclude]
        return random.choice(proxies) if proxies else None

    async def fetch(
        self,
        url: str,
        request_type: RequestType = RequestType.NORMAL,
        proxy: Optional[str] = None,
        use_curl_cffi: bool = True,
        header_profile: Optional[dict[str, Any]] = None,
    ) -> FetchResponse:
        proxy_used = bool(proxy)
        content = ""
        content_bytes: Optional[bytes] = None
        title: Optional[str] = None
        response_url = url
        status_code = 500
        headers: dict[str, str] = {}
        content_type_raw = ""
        failed = False
        failed_reasons: list[dict[str, str]] = []
        content_type = ContentType.OTHER
        extension = ""
        other_extensions: list[str] = []
        published_at: Optional[str] = None
        modified_at: Optional[str] = None
        cms_primary: Optional[CMS] = None
        cms_other: list[CMS] = []
        firewall = Firewall.NONE

        url_hint = _detect_content_type_from_url(url)
        is_likely_binary = url_hint in BINARY_CONTENT_TYPES

        try:
            if request_type == RequestType.BROWSER:
                if self._browser_pool is None:
                    raise RuntimeError("Browser pool not available for browser fetch")
                content, response_url, status_code, headers, title = await self._browser_pool.fetch(url, proxy=proxy)
                content_type_raw = headers.get("content-type", "")
            else:
                if not header_profile:
                    header_profile = get_random_profile()

                request_headers = header_profile["headers"].copy()

                if use_curl_cffi:
                    impersonate = header_profile.get("impersonate", "chrome131")
                    async with AsyncSession(impersonate=impersonate) as session:
                        resp = await session.get(
                            url,
                            headers=request_headers,
                            proxies={"http": proxy, "https": proxy} if proxy else None,
                            timeout=15,
                            allow_redirects=True,
                        )
                        status_code = resp.status_code
                        headers = dict(resp.headers)
                        response_url = str(resp.url)
                        content_type_raw = headers.get("content-type", "")
                        ct_check = content_type_raw.lower()
                        if is_likely_binary or "application/pdf" in ct_check or ct_check.startswith("image/"):
                            content_bytes = resp.content
                            content = ""
                        else:
                            content = resp.text
                else:
                    timeout_config = Timeout(15.0, connect=60.0)
                    client_kwargs: dict[str, Any] = {"timeout": timeout_config, "headers": request_headers}
                    if proxy:
                        client_kwargs["proxy"] = proxy

                    async with httpx.AsyncClient(**client_kwargs) as client:
                        resp = await client.get(url, follow_redirects=True)
                        status_code = resp.status_code
                        headers = dict(resp.headers)
                        response_url = str(resp.url)
                        content_type_raw = headers.get("content-type", "")
                        ct_check = content_type_raw.lower()
                        if is_likely_binary or "application/pdf" in ct_check or ct_check.startswith("image/"):
                            content_bytes = resp.content
                            content = ""
                        else:
                            content = resp.text

        except Exception as e:
            failed = True
            failed_reasons.append({FailureReason.REQUEST_ERROR.value: str(e)})
            if any(err in str(e) for err in ROTATE_PROXY_ERRORS):
                failed_reasons.append({FailureReason.PROXY_ERROR.value: str(e)})

        ct_lower = content_type_raw.lower()
        is_html = False
        if "text/html" in ct_lower:
            if re.search(r"<html|<body|<head|<!doctype", content, re.I):
                content_type = ContentType.HTML
                is_html = True
            else:
                content_type = ContentType.OTHER
        elif "text/markdown" in ct_lower or "text/x-markdown" in ct_lower:
            content_type = ContentType.MARKDOWN
        elif "application/pdf" in ct_lower:
            if (content_bytes and content_bytes[:5] == b"%PDF-") or content.startswith("%PDF-"):
                content_type = ContentType.PDF
            else:
                content_type = ContentType.OTHER
        elif "application/json" in ct_lower:
            content_type = ContentType.JSON
        elif "application/xml" in ct_lower or "text/xml" in ct_lower:
            content_type = ContentType.XML
        elif "text/plain" in ct_lower:
            content_type = ContentType.PLAIN_TEXT
        elif ct_lower.startswith("image/"):
            content_type = ContentType.IMAGE
        else:
            if (content_bytes and content_bytes[:5] == b"%PDF-") or content.startswith("%PDF-"):
                content_type = ContentType.PDF
            elif re.search(r"<html|<body|<head|<!doctype", content, re.I):
                content_type = ContentType.HTML
                is_html = True
            elif url_hint:
                content_type = url_hint
            else:
                content_type = ContentType.OTHER

        parsed_url = urlparse(response_url)
        path = parsed_url.path
        if "." in path:
            ext_parts = path.split(".")[1:]
            extension = ext_parts[-1].lower()
            if len(ext_parts) > 1:
                other_extensions = ["." + e for e in ext_parts[:-1]]
        if content_type in EXTENSION_MAP:
            extension = EXTENSION_MAP[content_type]

        meta_tags: dict[str, str] = {}
        json_ld: list[Any] = []
        selectolax_tree: Optional[HTMLParser] = None

        if is_html and content:
            try:
                selectolax_tree = HTMLParser(content)
                if title is None:
                    title_tag = selectolax_tree.css_first("title")
                    title = title_tag.text(strip=True) if title_tag else ""
                for meta in selectolax_tree.css("meta"):
                    name = (
                        meta.attrs.get("name") or meta.attrs.get("property") or meta.attrs.get("http-equiv") or ""
                    ).lower()
                    if name:
                        meta_tags[name] = meta.attrs.get("content", "")
                for script in selectolax_tree.css('script[type="application/ld+json"]'):
                    try:
                        data = json.loads(script.text())
                        json_ld.append(data)
                    except json.JSONDecodeError:
                        pass
            except Exception as e:
                failed = True
                failed_reasons.append({FailureReason.PARSE_ERROR.value: str(e)})

        if status_code >= 400:
            failed = True
            failed_reasons.append({FailureReason.BAD_STATUS.value: f"Status code {status_code}"})
        if not is_html and content_type not in EXTRACTABLE_CONTENT_TYPES:
            failed = True
            failed_reasons.append({FailureReason.NON_HTML_CONTENT.value: content_type_raw})
        if is_html and selectolax_tree:
            for selector in RETRY_CSS_SELECTORS:
                if selectolax_tree.css_first(selector):
                    failed = True
                    if selector in CLOUDFLARE_RETRY_CSS_SELECTORS:
                        failed_reasons.append({FailureReason.CLOUDFLARE_BLOCK.value: f"Selector: {selector}"})
                    else:
                        failed_reasons.append({FailureReason.BLOCKED.value: f"Selector: {selector}"})
        if title and any(kw in title.lower() for kw in ("cloudflare", "attention required", "just a moment")):
            failed = True
            failed_reasons.append({FailureReason.CLOUDFLARE_BLOCK.value: f"Title indicates block: {title}"})

        if is_html and selectolax_tree:
            generator = (meta_tags.get("generator") or "").lower()
            if "wordpress" in generator:
                cms_primary = CMS.WORDPRESS
            elif selectolax_tree.css_first('meta[content*="shopify"]'):
                cms_primary = CMS.SHOPIFY
            if re.search(r"wp-content|wp-includes", content, re.I):
                if cms_primary is None:
                    cms_primary = CMS.WORDPRESS
                elif cms_primary != CMS.WORDPRESS:
                    cms_other.append(CMS.WORDPRESS)
            if re.search(r"cdn\.shopify\.com|shopify", content, re.I):
                if cms_primary is None:
                    cms_primary = CMS.SHOPIFY
                elif cms_primary != CMS.SHOPIFY:
                    cms_other.append(CMS.SHOPIFY)
            if cms_primary is None:
                cms_primary = CMS.UNKNOWN

        if is_html and selectolax_tree:
            body_copy = selectolax_tree.body
            if body_copy:
                for node in body_copy.css("nav, header, footer, script, noscript, style"):
                    node.decompose()
                text_content = body_copy.text(separator=" ", strip=True)
                if len(text_content) < 100:
                    failed_reasons.append({FailureReason.LOW_TEXT_CONTENT.value: f"Text length {len(text_content)}"})

        if failed_reasons:
            failed = True
            first_key = list(failed_reasons[0].keys())[0]
            try:
                failed_primary_reason = FailureReason(first_key)
            except ValueError:
                failed_primary_reason = None
        else:
            failed_primary_reason = None

        if "cf-ray" in headers or "cloudflare" in headers.get("server", "").lower():
            firewall = Firewall.CLOUDFLARE
        elif "x-amzn-requestid" in headers and "aws" in headers.get("server", "").lower():
            firewall = Firewall.AWS_WAF
        if any(FailureReason.CLOUDFLARE_BLOCK.value in r for r in failed_reasons):
            firewall = Firewall.CLOUDFLARE
        if any(k.startswith("x-datadome") for k in headers):
            firewall = Firewall.DATADOME

        if is_html:
            published = (
                meta_tags.get("article:published_time")
                or meta_tags.get("og:article:published_time")
                or meta_tags.get("datepublished")
                or meta_tags.get("date")
            )
            modified = (
                meta_tags.get("article:modified_time")
                or meta_tags.get("og:article:modified_time")
                or meta_tags.get("datemodified")
                or meta_tags.get("last-modified")
            )
            if not published or not modified:
                for ld in json_ld:
                    if isinstance(ld, dict):
                        published = published or ld.get("datePublished")
                        modified = modified or ld.get("dateModified")
                        if "@graph" in ld:
                            for item in ld["@graph"]:
                                if isinstance(item, dict):
                                    published = published or item.get("datePublished")
                                    modified = modified or item.get("dateModified")
                    elif isinstance(ld, list):
                        for item in ld:
                            if isinstance(item, dict):
                                published = published or item.get("datePublished")
                                modified = modified or item.get("dateModified")

            published_at = _to_iso(published)
            modified_at = _to_iso(modified)

        return FetchResponse(
            request_url=url,
            proxy_used=proxy_used,
            request_type=request_type,
            content_type=content_type,
            extension=extension,
            other_extensions=other_extensions,
            content_type_raw=content_type_raw,
            title=title,
            response_url=response_url,
            response_headers=headers,
            status_code=status_code,
            failed=failed,
            failed_primary_reason=failed_primary_reason,
            failed_reasons=failed_reasons,
            published_at=published_at,
            modified_at=modified_at,
            cms_primary=cms_primary,
            cms_other=cms_other,
            firewall=firewall,
            content=content,
            content_bytes=content_bytes,
        )

    async def fetch_with_retry(
        self,
        url: str,
        use_random_proxy: bool = True,
    ) -> FetchResponse:
        proxy = self._get_random_proxy() if use_random_proxy else (
            self._settings.datacenter_proxy_list[0] if self._settings.datacenter_proxy_list else None
        )

        response = await self.fetch(url, RequestType.NORMAL, proxy)

        if not _is_retryable_failure(response) or not proxy:
            return response

        alt_proxy = self._get_different_proxy(exclude=proxy)
        if alt_proxy:
            logger.info("[RETRY] Different proxy for: %s", url)
            response = await self.fetch(url, RequestType.NORMAL, alt_proxy)
            if not response.failed:
                logger.info("[RETRY] Alt proxy worked: %s", url)
                return response

        logger.info("[RETRY] Direct (no proxy) for: %s", url)
        response = await self.fetch(url, RequestType.NORMAL, None)
        return response

    async def fetch_many(
        self,
        urls: list[str],
        max_concurrency: int = 20,
        use_random_proxy: bool = True,
    ) -> list[FetchResponse]:
        semaphore = asyncio.Semaphore(max_concurrency)

        async def _bounded_fetch(url: str) -> FetchResponse:
            async with semaphore:
                return await self.fetch_with_retry(url, use_random_proxy=use_random_proxy)

        tasks = [asyncio.create_task(_bounded_fetch(u)) for u in urls]
        return list(await asyncio.gather(*tasks))
