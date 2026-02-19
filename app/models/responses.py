from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class ScrapeResult(BaseModel):
    status: str  # "success" | "error"
    url: str
    error: Optional[str] = None
    scraped_at: Optional[str] = None

    overview: Optional[dict[str, Any]] = None
    organized_data: Optional[Any] = None
    structured_data: Optional[dict[str, Any]] = None
    text_data: Optional[str] = None
    main_image: Optional[str] = None
    hashes: Optional[list[str]] = None
    links: Optional[dict[str, Any]] = None
    content_filter_removal_details: Optional[list[dict[str, Any]]] = None

    ai_research_content: Optional[str] = None

    content_type: Optional[str] = None
    cms: Optional[str] = None
    firewall: Optional[str] = None
    status_code: Optional[int] = None
    from_cache: bool = False


class BatchScrapeResponse(BaseModel):
    status: str
    execution_time_ms: float
    results: list[ScrapeResult]


class SearchResultItem(BaseModel):
    keyword: str
    type: str = "web"
    title: str
    url: str
    description: str = ""
    age: Optional[str] = None
    thumbnail: Optional[str] = None
    extra_snippets: Optional[list[str]] = None


class SearchResponse(BaseModel):
    results: list[SearchResultItem]
    total: int


class ResearchPageEvent(BaseModel):
    url: str
    title: str = ""
    scraped_content: Optional[str] = None
    scrape_failure_reason: Optional[str] = None


class ResearchDoneEvent(BaseModel):
    total_urls: int
    scraped: int
    text_content: str
    execution_time_ms: float
