from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Any, Optional

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

BRAVE_BASE_URL = "https://api.search.brave.com/res/v1/web/search"


class RateLimiter:
    def __init__(self, min_interval: float = 1.3) -> None:
        self._min_interval = min_interval
        self._lock = asyncio.Lock()
        self._last_call_time: Optional[float] = None

    async def acquire(self) -> None:
        async with self._lock:
            now = time.time()
            if self._last_call_time is not None:
                elapsed = now - self._last_call_time
                if elapsed < self._min_interval:
                    await asyncio.sleep(self._min_interval - elapsed)
                    now = time.time()
            self._last_call_time = now


class BraveSearchClient:
    def __init__(self, settings: Settings) -> None:
        self._api_key = settings.BRAVE_API_KEY
        self._ai_api_key = settings.BRAVE_API_KEY_AI
        self._rate_limiter = RateLimiter(min_interval=1.3)

    def _get_headers(self, use_ai_plan: bool = False) -> dict[str, str]:
        api_key = self._ai_api_key if (use_ai_plan and self._ai_api_key) else self._api_key
        if not api_key:
            raise ValueError("Brave Search API key not configured")
        return {
            "X-Subscription-Token": api_key,
            "Accept": "application/json",
            "User-Agent": "ScraperService/1.0",
        }

    async def search(
        self,
        query: str,
        count: int = 20,
        offset: int = 0,
        country: str = "us",
        extra_snippets: bool = True,
        safe_search: str = "off",
        freshness: Optional[str] = None,
        timeout: int = 10,
    ) -> Optional[dict[str, Any]]:
        params: dict[str, Any] = {
            "q": query,
            "count": min(count, 20),
            "offset": offset,
            "country": country,
            "extra_snippets": extra_snippets,
            "text_decorations": False,
            "safesearch": safe_search,
        }
        if freshness:
            params["freshness"] = freshness.lower()

        await self._rate_limiter.acquire()

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    BRAVE_BASE_URL,
                    headers=self._get_headers(use_ai_plan=extra_snippets),
                    params=params,
                    timeout=timeout,
                )
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                logger.warning("Brave Search rate limited for query: %s", query)
                return None
            raise
        except httpx.TimeoutException:
            logger.warning("Brave Search timeout for query: %s", query)
            return None
        except Exception:
            logger.exception("Brave Search error for query: %s", query)
            return None

    async def search_with_retry(
        self,
        query: str,
        count: int = 20,
        offset: int = 0,
        country: str = "us",
        extra_snippets: bool = True,
        safe_search: str = "off",
        freshness: Optional[str] = None,
        max_retries: int = 2,
    ) -> Optional[dict[str, Any]]:
        for attempt in range(max_retries + 1):
            result = await self.search(
                query=query, count=count, offset=offset, country=country,
                extra_snippets=extra_snippets, safe_search=safe_search, freshness=freshness,
            )
            if result is not None:
                return result
            if attempt < max_retries:
                delay = 3 + (attempt * 2) + random.uniform(0, 1.0)
                logger.info("Retrying Brave Search for '%s' in %.1fs (attempt %d/%d)", query, delay, attempt + 1, max_retries)
                await asyncio.sleep(delay)
        return None

    async def multi_search(
        self,
        queries: list[str],
        count: int = 20,
        country: str = "us",
        extra_snippets: bool = True,
        safe_search: str = "off",
        freshness: Optional[str] = None,
    ) -> list[tuple[str, Optional[dict[str, Any]]]]:
        results: list[tuple[str, Optional[dict[str, Any]]]] = []
        for query in queries:
            result = await self.search_with_retry(
                query=query, count=count, country=country,
                extra_snippets=extra_snippets, safe_search=safe_search, freshness=freshness,
            )
            results.append((query, result))
        return results


def generate_search_text_summary(
    queries_with_results: list[tuple[str, Optional[dict[str, Any]]]],
) -> str:
    seen_urls: set[str] = set()
    query_counts: list[tuple[str, int]] = []
    body_parts: list[str] = []
    total_result_count = 0

    for query, result in queries_with_results:
        if result:
            items = (
                result.get("web", {}).get("results", [])
                + result.get("news", {}).get("results", [])
                + result.get("videos", {}).get("results", [])
            )
            query_result_count = 0
            section_lines: list[str] = []
            for item in items:
                url = item.get("url")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    query_result_count += 1
                    total_result_count += 1
                    title = item.get("title", "N/A")
                    description = item.get("description", "N/A")
                    extra = item.get("extra_snippets", [])
                    age = item.get("age", item.get("page_age", "N/A"))
                    age_text = f" ({age})" if age != "N/A" else ""
                    section_lines.append(f"Title: {title}{age_text}\nURL: {url}\nDescription: {description}\n")
                    if extra:
                        section_lines.append(f"Extra Snippets: {' '.join(extra)}\n")
                    section_lines.append("\n")
            query_counts.append((query, query_result_count))
            header = f'---\n## "{query}" ({query_result_count} results)\n\n'
            if query_result_count == 0:
                body_parts.append(header + "(No unique results for this query)\n\n")
            else:
                body_parts.append(header + "".join(section_lines))
        else:
            query_counts.append((query, 0))
            body_parts.append(f'---\n## "{query}" (0 results)\n\n(No results for this query)\n\n')

    top_summary = "Searched: " + ", ".join(f'"{q}" ({c})' for q, c in query_counts) + "\n\n"
    body = "".join(body_parts)
    content_length = len(top_summary) + len(body)
    metrics = [
        f"Query count: {len(queries_with_results)}",
        f"Results count: {total_result_count}",
        f"Total character count: {content_length}",
    ]
    bottom = "\n---\n## Search Summary Metrics:\n\n" + "\n".join(metrics)
    return top_summary + body + bottom


def extract_urls_from_search_results(
    results: list[tuple[str, Optional[dict[str, Any]]]],
) -> list[dict[str, str]]:
    seen: set[str] = set()
    urls: list[dict[str, str]] = []
    for _, result in results:
        if not result:
            continue
        for item in result.get("web", {}).get("results", []):
            url = item.get("url")
            if url and url not in seen:
                seen.add(url)
                urls.append({"url": url, "title": item.get("title", ""), "description": item.get("description", "")})
    return urls
