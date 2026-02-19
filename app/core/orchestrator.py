from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, AsyncGenerator, Optional

import asyncpg

from app.cache.page_cache import PageCache
from app.config import Settings
from app.core.fetcher.fetcher import UnifiedFetcher
from app.core.fetcher.models import FetchResponse
from app.core.parser.parser import ParseResult, UnifiedParser
from app.core.search import BraveSearchClient, extract_urls_from_search_results
from app.db.queries.failure_log import log_failure
from app.domain_config.config_store import DomainConfigStore
from app.extractors.content_extractors import (
    extract_text_content,
    extract_text_from_image_bytes,
    extract_text_from_pdf_bytes,
)
from app.models.enums import ContentType, FailureReason, OutputMode
from app.models.options import FetchOptions
from app.models.responses import (
    ResearchDoneEvent,
    ResearchPageEvent,
    ScrapeResult,
)
from app.utils.url import get_url_info, validate_and_correct_url

logger = logging.getLogger(__name__)


class ScrapeOrchestrator:
    def __init__(
        self,
        fetcher: UnifiedFetcher,
        settings: Settings,
        db_pool: asyncpg.Pool,
        page_cache: PageCache,
        domain_config_store: DomainConfigStore,
        search_client: Optional[BraveSearchClient] = None,
    ) -> None:
        self._fetcher = fetcher
        self._settings = settings
        self._pool = db_pool
        self._cache = page_cache
        self._domain_config = domain_config_store
        self._search_client = search_client
        self._parser = UnifiedParser()

    async def scrape(self, urls: list[str], options: FetchOptions) -> list[ScrapeResult]:
        semaphore = asyncio.Semaphore(self._settings.MAX_SCRAPE_CONCURRENCY)

        async def _bounded(url: str) -> ScrapeResult:
            async with semaphore:
                return await self._scrape_single(url, options)

        tasks = [asyncio.create_task(_bounded(u)) for u in urls]
        return list(await asyncio.gather(*tasks))

    async def stream_scrape(self, urls: list[str], options: FetchOptions) -> AsyncGenerator[ScrapeResult, None]:
        semaphore = asyncio.Semaphore(self._settings.MAX_SCRAPE_CONCURRENCY)
        queue: asyncio.Queue[Optional[ScrapeResult]] = asyncio.Queue()

        async def _worker(url: str) -> None:
            async with semaphore:
                result = await self._scrape_single(url, options)
                await queue.put(result)

        tasks = [asyncio.create_task(_worker(u)) for u in urls]

        done_count = 0
        total = len(urls)
        while done_count < total:
            result = await queue.get()
            if result is not None:
                done_count += 1
                yield result

        await asyncio.gather(*tasks, return_exceptions=True)

    async def _scrape_single(self, raw_url: str, options: FetchOptions) -> ScrapeResult:
        try:
            url = validate_and_correct_url(raw_url)
        except ValueError as e:
            return ScrapeResult(status="error", url=raw_url, error=str(e))

        if not self._domain_config.is_scrape_allowed(url):
            return ScrapeResult(status="error", url=url, error="Domain scraping not allowed")

        url_info = get_url_info(url)

        if options.use_cache:
            cached = await self._cache.get(url_info.unique_page_name)
            if cached:
                content = cached["content"]
                return ScrapeResult(
                    status="success",
                    url=url,
                    from_cache=True,
                    scraped_at=cached.get("scraped_at"),
                    content_type=cached.get("content_type"),
                    text_data=content.get("text_data"),
                    organized_data=content.get("organized_data"),
                    overview=content.get("overview"),
                    ai_research_content=content.get("ai_research_content"),
                    main_image=content.get("main_image"),
                    hashes=content.get("hashes"),
                    links=content.get("links"),
                )

        fetch_response = await self._fetcher.fetch_with_retry(url, use_random_proxy=True)

        if fetch_response.failed:
            primary_reason = fetch_response.failed_primary_reason
            if primary_reason:
                await log_failure(
                    pool=self._pool,
                    target_url=url,
                    failure_reason=primary_reason,
                    status_code=fetch_response.status_code,
                    error_log=str(fetch_response.failed_reasons),
                    proxy_used=fetch_response.proxy_used,
                )
            return ScrapeResult(
                status="error",
                url=url,
                error=str(fetch_response.failed_reasons),
                status_code=fetch_response.status_code,
                cms=fetch_response.cms_primary.value if fetch_response.cms_primary else None,
                firewall=fetch_response.firewall.value,
            )

        return await self._process_fetch_response(fetch_response, url, url_info, options)

    async def _process_fetch_response(
        self,
        resp: FetchResponse,
        url: str,
        url_info: Any,
        options: FetchOptions,
    ) -> ScrapeResult:
        ct = resp.content_type

        if ct == ContentType.HTML:
            output_mode = options.output_mode
            parse_result = await asyncio.to_thread(
                self._parser.parse,
                resp.content,
                url,
                OutputMode(output_mode),
            )
            return await self._build_result_from_parse(parse_result, resp, url, url_info, options)

        elif ct == ContentType.PDF:
            pdf_bytes = resp.content_bytes or resp.content.encode("utf-8", errors="replace")
            text = await asyncio.to_thread(extract_text_from_pdf_bytes, pdf_bytes)
            return await self._build_text_result(text, resp, url, url_info, options)

        elif ct == ContentType.IMAGE:
            image_bytes = resp.content_bytes
            text = await asyncio.to_thread(extract_text_from_image_bytes, image_bytes) if image_bytes else None
            return await self._build_text_result(text, resp, url, url_info, options)

        elif ct in (ContentType.JSON, ContentType.XML, ContentType.MARKDOWN, ContentType.PLAIN_TEXT):
            text = extract_text_content(resp.content, ct.value)
            return await self._build_text_result(text, resp, url, url_info, options)

        return ScrapeResult(
            status="error",
            url=url,
            error=f"Unsupported content type: {ct.value}",
            content_type=ct.value,
            status_code=resp.status_code,
        )

    async def _build_result_from_parse(
        self,
        parse_result: ParseResult,
        resp: FetchResponse,
        url: str,
        url_info: Any,
        options: FetchOptions,
    ) -> ScrapeResult:
        import datetime
        scraped_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
        text_data = parse_result.text_data or parse_result.ai_research_content or ""

        cache_content: dict[str, Any] = {}
        if parse_result.text_data:
            cache_content["text_data"] = parse_result.text_data
        if parse_result.ai_research_content:
            cache_content["ai_research_content"] = parse_result.ai_research_content
        if parse_result.overview:
            cache_content["overview"] = parse_result.overview
        if parse_result.main_image:
            cache_content["main_image"] = parse_result.main_image
        if parse_result.hashes:
            cache_content["hashes"] = parse_result.hashes
        if parse_result.links:
            cache_content["links"] = parse_result.links

        if options.use_cache:
            await self._cache.set(
                page_name=url_info.unique_page_name,
                url=url,
                domain=url_info.full_domain,
                content=cache_content,
                content_type=ContentType.HTML.value,
                char_count=len(text_data),
                ttl_days=options.cache_ttl_days,
            )

        return ScrapeResult(
            status="success",
            url=url,
            scraped_at=scraped_at,
            content_type=ContentType.HTML.value,
            overview=parse_result.overview if options.get_overview else None,
            text_data=parse_result.text_data if options.get_text_data else None,
            ai_research_content=parse_result.ai_research_content,
            main_image=parse_result.main_image if options.get_main_image else None,
            hashes=parse_result.hashes,
            links=parse_result.links if options.get_links else None,
            content_filter_removal_details=parse_result.content_filter_removal_details if options.get_content_filter_removal_details else None,
            cms=resp.cms_primary.value if resp.cms_primary else None,
            firewall=resp.firewall.value,
            status_code=resp.status_code,
        )

    async def _build_text_result(
        self,
        text: Optional[str],
        resp: FetchResponse,
        url: str,
        url_info: Any,
        options: FetchOptions,
    ) -> ScrapeResult:
        import datetime
        scraped_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

        if not text:
            return ScrapeResult(
                status="error",
                url=url,
                error="No extractable text content",
                content_type=resp.content_type.value,
                status_code=resp.status_code,
            )

        if options.use_cache:
            await self._cache.set(
                page_name=url_info.unique_page_name,
                url=url,
                domain=url_info.full_domain,
                content={"text_data": text, "ai_research_content": text},
                content_type=resp.content_type.value,
                char_count=len(text),
                ttl_days=options.cache_ttl_days,
            )

        return ScrapeResult(
            status="success",
            url=url,
            scraped_at=scraped_at,
            content_type=resp.content_type.value,
            text_data=text,
            ai_research_content=text,
            status_code=resp.status_code,
        )

    async def research(
        self,
        query: str,
        country: str = "us",
        effort: str = "extreme",
        freshness: Optional[str] = None,
        safe_search: str = "off",
    ) -> AsyncGenerator[ResearchPageEvent | ResearchDoneEvent, None]:
        if not self._search_client:
            raise RuntimeError("Search client not configured")

        start_time = time.time()
        effort_limits = {"low": 10, "medium": 25, "high": 50, "extreme": 100}
        max_urls = effort_limits.get(effort, 100)

        search_results = await self._search_client.search_with_retry(
            query=query, count=20, country=country, extra_snippets=True,
            safe_search=safe_search, freshness=freshness,
        )

        url_entries = extract_urls_from_search_results([(query, search_results)])
        urls_to_scrape = [e["url"] for e in url_entries[:max_urls]]

        options = FetchOptions(
            use_cache=True,
            output_mode=OutputMode.RESEARCH,
            get_text_data=False,
            get_organized_data=False,
            get_links=False,
            get_overview=False,
            get_main_image=False,
        )

        scraped_count = 0
        all_content: list[str] = []

        semaphore = asyncio.Semaphore(self._settings.MAX_RESEARCH_CONCURRENCY)
        queue: asyncio.Queue[Optional[ScrapeResult]] = asyncio.Queue()

        async def _worker(url: str) -> None:
            async with semaphore:
                result = await self._scrape_single(url, options)
                await queue.put(result)

        tasks = [asyncio.create_task(_worker(u)) for u in urls_to_scrape]

        done_count = 0
        total = len(urls_to_scrape)
        while done_count < total:
            result = await queue.get()
            done_count += 1
            if result is None:
                continue

            content = result.ai_research_content or result.text_data
            event = ResearchPageEvent(
                url=result.url,
                title="",
                scraped_content=content if content else None,
                scrape_failure_reason=result.error,
            )
            yield event

            if content:
                scraped_count += 1
                all_content.append(f"--- {result.url} ---\n{content}")

        await asyncio.gather(*tasks, return_exceptions=True)

        elapsed_ms = (time.time() - start_time) * 1000
        yield ResearchDoneEvent(
            total_urls=total,
            scraped=scraped_count,
            text_content="\n\n".join(all_content),
            execution_time_ms=elapsed_ms,
        )
