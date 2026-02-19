from __future__ import annotations

import json
import time
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.api.auth import require_api_key
from app.core.orchestrator import ScrapeOrchestrator
from app.core.search import BraveSearchClient, extract_urls_from_search_results, generate_search_text_summary
from app.models.requests import ResearchRequest, SearchAndScrapeRequest, SearchRequest
from app.models.responses import ResearchDoneEvent, ResearchPageEvent, SearchResponse, SearchResultItem, ScrapeResult

router = APIRouter(tags=["search"], dependencies=[Depends(require_api_key)])


def _get_search_client(request: Request) -> BraveSearchClient:
    client = request.app.state.search_client
    if not client:
        raise HTTPException(status_code=503, detail="Search client not configured")
    return client


def _get_orchestrator(request: Request) -> ScrapeOrchestrator:
    return request.app.state.orchestrator


@router.post("/search", response_model=SearchResponse)
async def search(body: SearchRequest, request: Request) -> SearchResponse:
    client = _get_search_client(request)
    all_items: list[SearchResultItem] = []

    for keyword in body.keywords:
        result = await client.search_with_retry(
            query=keyword,
            count=body.count,
            offset=body.offset,
            country=body.country,
            safe_search=body.safe_search,
            freshness=body.freshness,
        )
        if result:
            for item in result.get("web", {}).get("results", []):
                all_items.append(SearchResultItem(
                    keyword=keyword,
                    title=item.get("title", ""),
                    url=item.get("url", ""),
                    description=item.get("description", ""),
                    age=item.get("age"),
                    thumbnail=item.get("thumbnail", {}).get("src") if isinstance(item.get("thumbnail"), dict) else None,
                    extra_snippets=item.get("extra_snippets"),
                ))

    return SearchResponse(results=all_items, total=len(all_items))


@router.post("/search-and-scrape")
async def search_and_scrape(body: SearchAndScrapeRequest, request: Request) -> dict[str, Any]:
    client = _get_search_client(request)
    orchestrator = _get_orchestrator(request)
    start = time.time()

    results_pairs = await client.multi_search(
        queries=body.keywords,
        count=body.total_results_per_keyword,
        country=body.country,
    )

    url_entries = extract_urls_from_search_results(results_pairs)
    urls = [e["url"] for e in url_entries]

    scrape_results = await orchestrator.scrape(urls, body.options)
    elapsed_ms = (time.time() - start) * 1000

    return {
        "status": "success",
        "execution_time_ms": round(elapsed_ms, 2),
        "search_results": [SearchResultItem(
            keyword=body.keywords[0] if body.keywords else "",
            title=e.get("title", ""),
            url=e["url"],
            description=e.get("description", ""),
        ).model_dump() for e in url_entries],
        "scrape_results": [r.model_dump() for r in scrape_results],
    }


@router.post("/search-and-scrape/stream")
async def search_and_scrape_stream(body: SearchAndScrapeRequest, request: Request) -> StreamingResponse:
    client = _get_search_client(request)
    orchestrator = _get_orchestrator(request)

    async def event_generator() -> Any:
        results_pairs = await client.multi_search(
            queries=body.keywords,
            count=body.total_results_per_keyword,
            country=body.country,
        )
        url_entries = extract_urls_from_search_results(results_pairs)
        urls = [e["url"] for e in url_entries]

        yield f"event: search_done\ndata: {json.dumps({'urls_found': len(urls)})}\n\n"

        async for result in orchestrator.stream_scrape(urls, body.options):
            yield f"event: page_result\ndata: {result.model_dump_json()}\n\n"

        yield f"event: done\ndata: {json.dumps({'status': 'complete'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/research")
async def research(body: ResearchRequest, request: Request) -> StreamingResponse:
    orchestrator = _get_orchestrator(request)

    async def event_generator() -> Any:
        async for event in orchestrator.research(
            query=body.query,
            country=body.country,
            effort=body.effort,
            freshness=body.freshness,
            safe_search=body.safe_search,
        ):
            if isinstance(event, ResearchPageEvent):
                yield f"event: page_result\ndata: {event.model_dump_json()}\n\n"
            elif isinstance(event, ResearchDoneEvent):
                yield f"event: done\ndata: {event.model_dump_json()}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
