from __future__ import annotations

import enum


class ContentType(enum.StrEnum):
    HTML = "html"
    MARKDOWN = "md"
    PDF = "pdf"
    JSON = "json"
    XML = "xml"
    PLAIN_TEXT = "txt"
    IMAGE = "image"
    OTHER = "other"


BINARY_CONTENT_TYPES: frozenset[ContentType] = frozenset({ContentType.PDF, ContentType.IMAGE})

EXTRACTABLE_CONTENT_TYPES: frozenset[ContentType] = frozenset({
    ContentType.HTML,
    ContentType.PDF,
    ContentType.MARKDOWN,
    ContentType.JSON,
    ContentType.XML,
    ContentType.PLAIN_TEXT,
    ContentType.IMAGE,
})


class FailureReason(enum.StrEnum):
    NON_HTML_CONTENT = "non_html_content"
    LOW_TEXT_CONTENT = "low_text_content"
    BAD_STATUS = "bad_status"
    PARSE_ERROR = "parse_error"
    CLOUDFLARE_BLOCK = "cloudflare_block"
    BLOCKED = "blocked"
    REQUEST_ERROR = "request_error"
    PROXY_ERROR = "proxy_error"


FAILURE_CATEGORY_MAP: dict[FailureReason, str] = {
    FailureReason.BAD_STATUS: "bad_status",
    FailureReason.CLOUDFLARE_BLOCK: "cloudflare_block",
    FailureReason.BLOCKED: "blocked",
    FailureReason.REQUEST_ERROR: "request_error",
    FailureReason.PROXY_ERROR: "proxy_error",
    FailureReason.PARSE_ERROR: "parse_error",
    FailureReason.NON_HTML_CONTENT: "non_html_content",
    FailureReason.LOW_TEXT_CONTENT: "low_text_content",
}


class CMS(enum.StrEnum):
    WORDPRESS = "wordpress"
    SHOPIFY = "shopify"
    UNKNOWN = "unknown"


class Firewall(enum.StrEnum):
    CLOUDFLARE = "cloudflare"
    AWS_WAF = "aws_waf"
    DATADOME = "datadome"
    NONE = "none"


class ProxyType(enum.StrEnum):
    DATACENTER = "datacenter"
    RESIDENTIAL = "residential"
    NONE = "none"


class OutputMode(enum.StrEnum):
    RICH = "rich"
    RESEARCH = "research"


class RequestType(enum.StrEnum):
    BROWSER = "browser"
    NORMAL = "normal"


class Validity(enum.StrEnum):
    ACTIVE = "active"
    STALE = "stale"
    INVALID = "invalid"
