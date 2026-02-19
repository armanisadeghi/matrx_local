from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.api.auth import require_api_key
from app.core.orchestrator import ScrapeOrchestrator
from app.models.requests import ScrapeRequest
from app.models.responses import BatchScrapeResponse, ScrapeResult

router = APIRouter(tags=["scrape"], dependencies=[Depends(require_api_key)])


def _get_orchestrator(request: Request) -> ScrapeOrchestrator:
    return request.app.state.orchestrator


@router.post("/scrape", response_model=BatchScrapeResponse)
async def scrape_urls(body: ScrapeRequest, request: Request) -> BatchScrapeResponse:
    orchestrator = _get_orchestrator(request)
    start = time.time()
    results = await orchestrator.scrape(body.urls, body.options)
    elapsed_ms = (time.time() - start) * 1000
    return BatchScrapeResponse(
        status="success",
        execution_time_ms=round(elapsed_ms, 2),
        results=results,
    )


@router.post("/scrape/stream")
async def scrape_urls_stream(body: ScrapeRequest, request: Request) -> StreamingResponse:
    orchestrator = _get_orchestrator(request)

    async def event_generator() -> Any:
        async for result in orchestrator.stream_scrape(body.urls, body.options):
            data = result.model_dump_json()
            yield f"event: page_result\ndata: {data}\n\n"
        yield f"event: done\ndata: {json.dumps({'status': 'complete'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
