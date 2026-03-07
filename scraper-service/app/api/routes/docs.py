"""Public API documentation endpoint — no secrets, agent-friendly."""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(tags=["docs"])

API_DOCS = {
    "service": "scraper-service",
    "base_url": "https://scraper.app.matrxserver.com/api/v1",
    "swagger_ui": "https://scraper.app.matrxserver.com/docs",
    "openapi_json": "https://scraper.app.matrxserver.com/openapi.json",
    "authentication": {
        "method": "Authorization: Bearer <token>",
        "accepts": ["API key (static string)", "Supabase JWT (user-scoped)"],
        "header": "Authorization",
        "format": "Bearer <token>",
        "note": "X-API-Key header is NOT supported",
    },
    "endpoints": [
        {
            "method": "GET",
            "path": "/api/v1/health",
            "auth_required": False,
            "description": "Health check — returns service and database status",
        },
        {
            "method": "POST",
            "path": "/api/v1/scrape",
            "auth_required": True,
            "description": "Scrape one or more URLs. Fetches, parses, stores, and returns content.",
            "request_body": {
                "urls": {"type": "array[string]", "required": True, "max_length": 100},
                "options": {"type": "FetchOptions", "required": False, "description": "See /docs for full schema"},
            },
            "response": "BatchScrapeResponse with results array",
        },
        {
            "method": "POST",
            "path": "/api/v1/scrape/stream",
            "auth_required": True,
            "description": "Same as /scrape but returns Server-Sent Events as each URL completes",
            "request_body": "Same as /scrape",
            "response": "SSE stream: event=page_result, event=done",
        },
        {
            "method": "POST",
            "path": "/api/v1/search",
            "auth_required": True,
            "description": "Search via Brave Search API",
            "request_body": {
                "keywords": {"type": "array[string]", "required": True},
                "country": {"type": "string", "default": "us"},
                "count": {"type": "integer", "default": 20, "max": 20},
            },
        },
        {
            "method": "POST",
            "path": "/api/v1/search-and-scrape",
            "auth_required": True,
            "description": "Search + scrape the top results",
            "request_body": {
                "keywords": {"type": "array[string]", "required": True},
                "total_results_per_keyword": {"type": "integer", "default": 10},
                "options": {"type": "FetchOptions", "required": False},
            },
        },
        {
            "method": "POST",
            "path": "/api/v1/search-and-scrape/stream",
            "auth_required": True,
            "description": "Same as /search-and-scrape but returns SSE stream",
        },
        {
            "method": "POST",
            "path": "/api/v1/research",
            "auth_required": True,
            "description": "Deep research — iterative search + scrape + compile",
            "request_body": {
                "query": {"type": "string", "required": True},
                "effort": {"type": "string", "default": "extreme", "options": ["low", "medium", "high", "extreme"]},
            },
        },
        {
            "method": "GET",
            "path": "/api/v1/config/domains",
            "auth_required": True,
            "description": "List all domain scrape configurations",
        },
        {
            "method": "POST",
            "path": "/api/v1/config/domains",
            "auth_required": True,
            "description": "Create or update a domain scrape configuration",
        },
        {
            "method": "POST",
            "path": "/api/v1/content/save",
            "auth_required": True,
            "description": "Save externally-scraped content to the database. Used by matrx-local and Chrome extension to store content scraped with residential IP.",
            "request_body": {
                "url": {"type": "string", "required": True},
                "content": {"type": "object", "required": True, "description": "Parsed content with keys: text_data, ai_research_content, overview, links, etc."},
                "content_type": {"type": "string", "default": "html"},
                "char_count": {"type": "integer", "required": False},
                "ttl_days": {"type": "integer", "default": 30},
            },
            "response": {"status": "stored", "page_name": "string", "url": "string", "domain": "string", "char_count": "integer"},
        },
        {
            "method": "GET",
            "path": "/api/v1/queue/pending",
            "auth_required": True,
            "description": "Get URLs that need scraping by external clients (failed on server)",
            "query_params": {
                "tier": {"type": "string", "default": "desktop", "options": ["desktop", "extension"]},
                "limit": {"type": "integer", "default": 10, "max": 50},
                "domain": {"type": "string", "required": False},
            },
        },
        {
            "method": "POST",
            "path": "/api/v1/queue/claim",
            "auth_required": True,
            "description": "Claim queue items for processing. Prevents other clients from picking them up. Claims expire after 10 minutes.",
            "request_body": {
                "item_ids": {"type": "array[string]", "required": True},
                "client_id": {"type": "string", "required": True},
                "client_type": {"type": "string", "default": "desktop"},
            },
        },
        {
            "method": "POST",
            "path": "/api/v1/queue/submit",
            "auth_required": True,
            "description": "Submit scraped content for a claimed queue item. Stores content and marks item as completed.",
            "request_body": {
                "queue_item_id": {"type": "string", "required": True},
                "url": {"type": "string", "required": True},
                "content": {"type": "object", "required": True},
                "content_type": {"type": "string", "default": "html"},
                "char_count": {"type": "integer", "required": False},
            },
        },
        {
            "method": "POST",
            "path": "/api/v1/queue/fail",
            "auth_required": True,
            "description": "Report that scraping also failed on the client. Optionally promote to extension tier.",
            "request_body": {
                "queue_item_id": {"type": "string", "required": True},
                "error": {"type": "string", "required": True},
                "promote_to_extension": {"type": "boolean", "default": False},
            },
        },
        {
            "method": "GET",
            "path": "/api/v1/queue/stats",
            "auth_required": True,
            "description": "Queue statistics — counts by status and tier",
        },
    ],
    "database_access": "All external clients MUST use these API endpoints. The PostgreSQL database has no public port. Never connect directly.",
    "retry_pipeline": {
        "description": "Failed scrapes are automatically queued for retry by external clients with residential IPs",
        "flow": [
            "1. Server scrapes URL → fails (Cloudflare, blocked, etc.)",
            "2. Failure logged + auto-queued in scrape_retry_queue (tier=desktop)",
            "3. matrx-local polls GET /queue/pending, claims items, scrapes locally",
            "4. On success: POST /queue/submit saves content to database",
            "5. On failure: POST /queue/fail optionally promotes to extension tier",
            "6. Chrome extension handles remaining failures as last resort",
        ],
        "retryable_failure_reasons": ["cloudflare_block", "blocked", "bad_status", "request_error", "proxy_error"],
        "non_retryable": ["parse_error", "non_html_content", "low_text_content"],
    },
    "content_save_guide": {
        "description": "How to save scraped content from an external client",
        "steps": [
            "1. Scrape the URL locally (Playwright, httpx, etc.)",
            "2. Parse the content into a dict with keys: text_data, ai_research_content, overview, links, hashes",
            "3. POST /api/v1/content/save with the url, content dict, content_type, and char_count",
            "4. Server stores it in scrape_parsed_page — same table as server-side scrapes",
        ],
        "example_request": {
            "url": "https://example.com/page",
            "content": {
                "text_data": "Full extracted text...",
                "ai_research_content": "Cleaned text for AI consumption...",
                "overview": {"title": "Page Title", "description": "..."},
                "links": {"internal": [], "external": []},
            },
            "content_type": "html",
            "char_count": 5432,
        },
    },
}


@router.get("/docs/api")
async def api_documentation() -> JSONResponse:
    return JSONResponse(content=API_DOCS)
