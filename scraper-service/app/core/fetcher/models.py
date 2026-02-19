from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field

from app.models.enums import CMS, ContentType, FailureReason, Firewall, RequestType


class FetchResponse(BaseModel):
    request_url: str
    proxy_used: bool
    request_type: RequestType
    content_type: ContentType
    extension: str = ""
    content_type_raw: str = ""
    response_url: str
    response_headers: dict[str, str] = Field(default_factory=dict)
    status_code: int = 500
    content: str = ""
    content_bytes: Optional[bytes] = Field(default=None, exclude=True)
    failed: bool = False
    failed_primary_reason: Optional[FailureReason] = None
    failed_reasons: list[dict[str, str]] = Field(default_factory=list)
    published_at: Optional[str] = None
    modified_at: Optional[str] = None
    cms_primary: Optional[CMS] = None
    cms_other: list[CMS] = Field(default_factory=list)
    firewall: Firewall = Firewall.NONE
    other_extensions: list[str] = Field(default_factory=list)
    title: Optional[str] = None

    model_config = {"arbitrary_types_allowed": True}


CLOUDFLARE_RETRY_CSS_SELECTORS: list[str] = [
    '#turnstile-wrapper iframe[src^="https://challenges.cloudflare.com"]',
]

RETRY_CSS_SELECTORS: list[str] = [
    *CLOUDFLARE_RETRY_CSS_SELECTORS,
    'div#infoDiv0 a[href*="//www.google.com/policies/terms/"]',
    'iframe[src*="_Incapsula_Resource"]',
]

ROTATE_PROXY_ERRORS: list[str] = [
    "ECONNRESET",
    "ECONNREFUSED",
    "ERR_PROXY_CONNECTION_FAILED",
    "ERR_TUNNEL_CONNECTION_FAILED",
    "Proxy responded with",
    "unsuccessful tunnel",
    "TunnelUnsuccessful",
]

URL_EXT_MAP: dict[str, ContentType] = {
    "pdf": ContentType.PDF,
    "json": ContentType.JSON,
    "xml": ContentType.XML,
    "md": ContentType.MARKDOWN,
    "txt": ContentType.PLAIN_TEXT,
    "jpg": ContentType.IMAGE,
    "jpeg": ContentType.IMAGE,
    "png": ContentType.IMAGE,
    "gif": ContentType.IMAGE,
    "webp": ContentType.IMAGE,
    "bmp": ContentType.IMAGE,
    "tiff": ContentType.IMAGE,
    "svg": ContentType.IMAGE,
}

EXTENSION_MAP: dict[ContentType, str] = {
    ContentType.HTML: "html",
    ContentType.MARKDOWN: "md",
    ContentType.PDF: "pdf",
    ContentType.JSON: "json",
    ContentType.XML: "xml",
    ContentType.PLAIN_TEXT: "txt",
}
