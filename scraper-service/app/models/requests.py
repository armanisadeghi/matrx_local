from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from app.models.options import FetchOptions


class ScrapeRequest(BaseModel):
    urls: list[str] = Field(..., min_length=1, max_length=100)
    options: FetchOptions = Field(default_factory=FetchOptions)


class SearchRequest(BaseModel):
    keywords: list[str] = Field(..., min_length=1, max_length=10)
    country: str = "us"
    count: int = Field(default=20, ge=1, le=20)
    offset: int = Field(default=0, ge=0)
    freshness: Optional[str] = None
    safe_search: str = "off"


class SearchAndScrapeRequest(BaseModel):
    keywords: list[str] = Field(..., min_length=1, max_length=10)
    country: str = "us"
    total_results_per_keyword: int = Field(default=10, ge=1, le=20)
    options: FetchOptions = Field(default_factory=FetchOptions)


class ResearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    country: str = "us"
    effort: str = Field(default="extreme", pattern=r"^(low|medium|high|extreme)$")
    freshness: Optional[str] = None
    safe_search: str = "off"
