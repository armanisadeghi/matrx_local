"""Endpoint for external clients to save scraped content to the database.

This is the primary way matrx-local, Chrome extension, and other clients
store scraped data. They scrape locally (residential IP) and push the
parsed result here for centralized storage.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.api.auth import require_api_key
from app.cache.page_cache import PageCache
from app.utils.url import get_url_info

logger = logging.getLogger(__name__)

router = APIRouter(tags=["content"], dependencies=[Depends(require_api_key)])


class SaveContentRequest(BaseModel):
    url: str = Field(..., min_length=1)
    content: dict[str, Any] = Field(
        ...,
        description="Parsed page content. Expected keys: text_data, ai_research_content, "
        "overview, links, main_image, hashes (all optional).",
    )
    content_type: str = Field(default="html")
    char_count: Optional[int] = None
    ttl_days: int = Field(default=30, ge=1, le=365)


class SaveContentResponse(BaseModel):
    status: str
    page_name: str
    url: str
    domain: str
    char_count: int


@router.post("/content/save", response_model=SaveContentResponse)
async def save_content(body: SaveContentRequest, request: Request) -> SaveContentResponse:
    page_cache: PageCache = request.app.state.page_cache
    url_info = get_url_info(body.url)

    char_count = body.char_count or len(json.dumps(body.content, default=str))

    await page_cache.set(
        page_name=url_info.unique_page_name,
        url=body.url,
        domain=url_info.full_domain,
        content=body.content,
        content_type=body.content_type,
        char_count=char_count,
        ttl_days=body.ttl_days,
    )

    logger.info("Content saved: %s (%d chars)", body.url, char_count)
    return SaveContentResponse(
        status="stored",
        page_name=url_info.unique_page_name,
        url=body.url,
        domain=url_info.full_domain,
        char_count=char_count,
    )
