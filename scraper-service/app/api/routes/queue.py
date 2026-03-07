from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.auth import require_api_key
from app.cache.page_cache import PageCache
from app.db.queries.retry_queue import (
    claim_items,
    fail_item,
    get_pending,
    get_queue_stats,
    submit_result,
)
from app.utils.url import extract_domain, get_url_info

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/queue", tags=["queue"], dependencies=[Depends(require_api_key)])


class ClaimRequest(BaseModel):
    item_ids: list[str] = Field(..., min_length=1, max_length=50)
    client_id: str = Field(..., min_length=1)
    client_type: str = Field(default="desktop", pattern=r"^(desktop|extension)$")


class SubmitRequest(BaseModel):
    queue_item_id: str
    url: str
    content: dict[str, Any]
    content_type: str = "html"
    char_count: int = 0


class FailRequest(BaseModel):
    queue_item_id: str
    error: str
    promote_to_extension: bool = False


@router.get("/pending")
async def queue_pending(
    request: Request,
    tier: str = "desktop",
    limit: int = 10,
    domain: Optional[str] = None,
) -> dict[str, Any]:
    pool = request.app.state.db_pool
    items = await get_pending(pool, tier=tier, limit=min(limit, 50), domain=domain)
    total = items[0]["total_pending"] if items else 0
    for item in items:
        item.pop("total_pending", None)
    return {"items": items, "total_pending": total}


@router.post("/claim")
async def queue_claim(body: ClaimRequest, request: Request) -> dict[str, Any]:
    pool = request.app.state.db_pool
    return await claim_items(pool, body.item_ids, body.client_id)


@router.post("/submit")
async def queue_submit(body: SubmitRequest, request: Request) -> dict[str, Any]:
    pool = request.app.state.db_pool
    page_cache: PageCache = request.app.state.page_cache

    url_info = get_url_info(body.url)

    await page_cache.set(
        page_name=url_info.unique_page_name,
        url=body.url,
        domain=url_info.full_domain,
        content=body.content,
        content_type=body.content_type,
        char_count=body.char_count or len(json.dumps(body.content, default=str)),
    )

    updated = await submit_result(pool, body.queue_item_id)
    if not updated:
        raise HTTPException(404, "Queue item not found or not in 'claimed' status")

    logger.info("Queue item completed: %s → %s", body.queue_item_id, body.url)
    return {
        "status": "stored",
        "page_name": url_info.unique_page_name,
        "url": body.url,
        "char_count": body.char_count,
    }


@router.post("/fail")
async def queue_fail(body: FailRequest, request: Request) -> dict[str, Any]:
    pool = request.app.state.db_pool
    updated = await fail_item(
        pool, body.queue_item_id, body.error, body.promote_to_extension,
    )
    if not updated:
        raise HTTPException(404, "Queue item not found or not in 'claimed' status")

    action = "promoted to extension" if body.promote_to_extension else "marked as failed"
    return {"status": action, "queue_item_id": body.queue_item_id}


@router.get("/stats")
async def queue_stats(request: Request) -> dict[str, Any]:
    pool = request.app.state.db_pool
    return await get_queue_stats(pool)
