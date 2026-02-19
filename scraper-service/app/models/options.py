from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.enums import OutputMode, ProxyType


class FetchOptions(BaseModel):
    use_cache: bool = True
    cache_ttl_days: int = Field(default=30, ge=1, le=365)
    proxy_type: ProxyType = ProxyType.DATACENTER
    use_curl_cffi: bool = True
    use_playwright_fallback: bool = False
    force_playwright: bool = False
    output_mode: OutputMode = OutputMode.RICH

    get_text_data: bool = True
    get_organized_data: bool = False
    get_structured_data: bool = False
    get_links: bool = False
    get_main_image: bool = True
    get_overview: bool = False
    get_content_filter_removal_details: bool = False

    include_highlighting_markers: bool = True
    include_media: bool = True
    include_anchors: bool = True
    anchor_size: int = Field(default=100, ge=0)
