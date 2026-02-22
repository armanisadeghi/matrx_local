# Remote Scraper Server — Admin Questions

> For: Admin of `scraper.app.matrxserver.com`
> From: Matrx Local desktop team
> Updated: 2026-02-21

---

## Context

The Matrx Local desktop app connects to `https://scraper.app.matrxserver.com` using `SCRAPER_API_KEY`. The local Python engine acts as a **proxy** — the desktop frontend never calls the remote server directly.

The local engine has two scraping modes:

- **Local** — Playwright + httpx on the user's machine
- **Remote** — Delegates to `scraper.app.matrxserver.com`

---

## Questions We Need Answered

### 1. API Documentation

- Is there an OpenAPI/Swagger doc at `/docs` or `/redoc`?
- What's the base path — `/api/v1/...`, root, etc?
- Full list of available endpoints?

### 2. Authentication

- How should the API key be sent? (`Authorization: Bearer <key>`, `X-API-Key` header, query param?)
- Is the key per-user, per-organization, or global?
- Key rotation policy?

### 3. Data Persistence

- What gets stored server-side?
  - Scraped HTML/content?
  - Parsed/extracted data?
  - Scrape job history?
- What database does it use? (its own PostgreSQL, Supabase, etc.)
- Data retention policy? (how long is scraped content kept?)

### 4. Available Functionality

- Can the desktop app submit scrape jobs?
- Can it retrieve scrape results by job ID?
- Is there a webhook or SSE stream for real-time job status?
- Batch scraping support? (submit N URLs, get results)
- Proxy rotation — is this handled server-side or does the client configure it?

### 5. CORS / Access Control

- Does the server accept requests from `http://localhost:1420` and `tauri://localhost`?
- Or is the Python engine always the intermediary (no CORS needed)?

### 6. Rate Limits

- Per-key limits on requests/day?
- Max concurrent scrapes?
- Max URLs per batch request?

### 7. Specific Integration Needs

We currently store these in the local `.env`:

```
SCRAPER_API_KEY=<redacted>
SCRAPER_SERVER_URL=https://scraper.app.matrxserver.com
```

**What we need to know to build the integration:**

- Exact request/response format for submitting a scrape job
- How to check scrape status
- How to retrieve results
- Error codes and their meanings
- Whether the server supports the same output modes as local (`rich`, `research`)

---

## What We've Already Built (Local Side)

The local Python engine at `app/api/scraper_routes.py` already has:

- Multi-strategy fetching (HTTP → curl-cffi → Playwright fallback)
- Cloudflare/bot detection + automatic retry
- Content extraction for HTML, PDF, images (OCR)
- In-memory caching
- Domain-specific parsing rules
- Proxy rotation support (datacenter + residential)

We want to understand how the remote server complements or replaces these features so we can route requests appropriately.

---
---

# Server Admin Responses

> From: Server admin (Coolify/matrxserver.com)
> Date: 2026-02-22

Great work on the remote client and routes — your code in `remote_client.py` and `remote_scraper_routes.py` is already correct and working. Here are the answers to everything.

---

## 1. API Documentation

- **Swagger UI:** `https://scraper.app.matrxserver.com/docs` — live, interactive
- **OpenAPI JSON:** `https://scraper.app.matrxserver.com/openapi.json`
- **Base path:** `/api/v1/`
- **Full endpoint list:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/health` | Health check (no auth required) |
| `GET` | `/api/v1/config/domains` | List domain scrape configs |
| `POST` | `/api/v1/config/domains` | Create/update domain config |
| `POST` | `/api/v1/scrape` | Scrape URLs (batch) |
| `POST` | `/api/v1/scrape/stream` | Scrape URLs (SSE stream) |
| `POST` | `/api/v1/search` | Brave web search |
| `POST` | `/api/v1/search-and-scrape` | Search + scrape results |
| `POST` | `/api/v1/search-and-scrape/stream` | Search + scrape (SSE stream) |
| `POST` | `/api/v1/research` | Deep research pipeline |

Your `remote_client.py` already covers all of these correctly.

---

## 2. Authentication

- **Method:** `Authorization: Bearer <token>` — **your code is correct**
- **Accepts two token types:**
  1. **API key** (static string) — for server-to-server / desktop app use
  2. **Supabase JWT** — for user-scoped requests. If you pass a valid Supabase JWT, the server decodes it and attaches `request.state.user` with the JWT payload. This means user-level tracking is possible in the future.
- **Your `_get_user_token` pattern is exactly right:** forward the user's Supabase JWT when available, fall back to the API key.
- **Key scope:** The API key is currently **global** (one key for the whole org). Per-user scoping would come via Supabase JWTs.
- **Key rotation:** Manual for now. No auto-rotation.
- **Production API key:** (set via your `SCRAPER_API_KEY` env var)

**Important: `X-API-Key` header does NOT work.** Only `Authorization: Bearer`. Your code is already using the correct method.

---

## 3. Data Persistence

- **Database:** Dedicated PostgreSQL 17 instance on the Coolify server (internal only, no public port). This is NOT Supabase — it's a standalone Postgres.
- **What's stored:**
  - `scrape_parsed_page` — Parsed/extracted content (JSONB), page metadata, char count, content type, validity status, TTL-based expiry
  - `scrape_domain` / `scrape_domain_settings` — Per-domain scrape configs
  - `scrape_path_pattern` / `scrape_path_override` — URL path-specific rules
  - `scrape_base_config` — Global parsing rules
  - `scrape_failure_log` — All failed scrape attempts with reasons, status codes, proxy info
- **NOT stored:** Raw HTML. Only parsed/extracted content in JSONB.
- **Data retention:**
  - In-memory cache: 30 min TTL (`PAGE_CACHE_TTL_SECONDS=1800`)
  - Database cache: 30 day TTL (`DEFAULT_SCRAPE_TTL_DAYS=30`)
  - Pages have `validity` field: `active` (current), `stale`, `invalid`
  - Only one `active` row per `page_name` at a time

**Key architecture point:** Scrape results are stored in this server-side PostgreSQL. The local desktop app's `DATABASE_URL` (if set) points to a LOCAL Postgres instance for local caching only. These are two separate databases — they don't sync. The remote server is the source of truth for scrape data. Supabase handles everything else (user accounts, settings, documents, etc.).

---

## 4. Available Functionality

- **Submit scrape jobs?** Yes — `POST /api/v1/scrape` accepts a list of URLs. Already implemented in your `remote_client.py`.
- **Retrieve results by job ID?** No. Scrapes are synchronous — you submit URLs, the server scrapes them, and returns results in the same response. For streaming, use the `/stream` variants which send SSE events as each URL completes.
- **SSE streams?** Yes — `/scrape/stream`, `/search-and-scrape/stream`, and `/research/stream` all return `text/event-stream`. Your `stream_sse()` method handles this correctly.
- **Batch support?** Yes — `urls` is an array. Server scrapes up to `MAX_SCRAPE_CONCURRENCY=20` URLs in parallel.
- **Proxy rotation?** Handled server-side. The server has datacenter and residential proxy pools configured. The `UnifiedFetcher` automatically rotates proxies and retries on failure. Clients don't configure proxies — just send URLs.
- **Output modes:** The server supports `rich` content extraction (HTML parsing, PDF via PyMuPDF, image OCR via Tesseract). The `research` endpoint does search → scrape → compile. Same capabilities as local.

---

## 5. CORS / Access Control

- **CORS is irrelevant for your setup.** The Python engine is always the intermediary. The React frontend talks to `localhost:22140`, and the Python engine calls the remote server. Server-to-server HTTP requests don't have CORS restrictions.
- If you ever needed direct browser-to-server access, CORS would need to be configured on the scraper server, but that's not the architecture.

---

## 6. Rate Limits

- **No hard per-key rate limits currently.** The practical limits are:
  - `MAX_SCRAPE_CONCURRENCY=20` — max concurrent scrapes per request
  - `MAX_RESEARCH_CONCURRENCY=30` — max concurrent research threads
  - `PLAYWRIGHT_POOL_SIZE=3` — browser instances for JS-heavy pages
  - Brave Search API has its own rate limits (depends on API plan)
- **No per-day quotas.** This may change as usage grows, but for now, the desktop app can call the server as much as needed.
- **Max URLs per batch:** No hard limit in the API, but keep batches under ~50 URLs for reasonable response times. Use the `/stream` variant for large batches.

---

## 7. Integration Details

### Request/Response Formats

**Scrape:**
```
POST /api/v1/scrape
Authorization: Bearer <api_key_or_jwt>
Content-Type: application/json

{"urls": ["https://example.com", "https://other.com"], "options": {}}

Response: BatchScrapeResponse with results array, each containing:
  - url, status ("success" | "error"), content (JSONB), char_count, content_type, etc.
```

**Search:**
```
POST /api/v1/search
Authorization: Bearer <api_key_or_jwt>
Content-Type: application/json

{"keywords": ["AI frameworks 2026"], "count": 10, "country": "US"}

Response: Search results from Brave API
```

**Research:**
```
POST /api/v1/research
Authorization: Bearer <api_key_or_jwt>
Content-Type: application/json

{"query": "Compare React Native vs Flutter", "effort": "thorough", "country": "US"}

Response: Compiled research from search + scrape + synthesis
```

### Error Codes

| HTTP Code | Meaning |
|-----------|---------|
| 200 | Success |
| 401 | Invalid or missing API key / JWT |
| 422 | Invalid request body (Pydantic validation) |
| 500 | Internal server error |

Individual scrape results within a batch can have `status: "error"` even when the HTTP response is 200 — check each result.

### How Your Code Maps

Your existing code is already correct. No changes needed for basic functionality:

| Your method | Server endpoint | Status |
|-------------|----------------|--------|
| `client.health()` | `GET /api/v1/health` | Working |
| `client.scrape()` | `POST /api/v1/scrape` | Working |
| `client.search()` | `POST /api/v1/search` | Working |
| `client.search_and_scrape()` | `POST /api/v1/search-and-scrape` | Working |
| `client.research()` | `POST /api/v1/research` | Working |
| `client.stream_sse()` | `POST /api/v1/*/stream` | Working |
| `client.get_domain_configs()` | `GET /api/v1/config/domains` | Working |

---

## How Remote Complements Local

The remote server and local engine are the **same codebase** (`scraper-service/` is a git subtree in matrx-local). They have identical scraping capabilities. The difference is infrastructure:

| Aspect | Local engine | Remote server |
|--------|-------------|---------------|
| IP | User's residential/ISP | Datacenter (89.116.187.5) |
| Proxy pool | User's configured proxies | Server's datacenter + residential proxies |
| Database | Local Postgres (optional, in-memory fallback) | Dedicated Postgres 17 (persistent, backed up to S3) |
| Browser pool | 1-3 Playwright instances | 3 Playwright instances |
| Best for | Cloudflare-blocked sites, residential-only access | High-volume scraping, cached lookups, search |

**Recommended routing logic:**
1. Try remote first (faster, has proxy pool, persistent cache)
2. If remote fails with `CLOUDFLARE_BLOCK` or `BLOCKED`, retry locally (residential IP)
3. If both fail, queue for Chrome extension manual capture (future feature)

---

## CRITICAL: Saving Scraped Content Back to the Server

This is the **most important integration** for matrx-local. When the desktop app scrapes a page locally (using the user's residential IP), it must save the result back to the server's database so all clients can access it.

### Direct Save (No Queue Involved)

For any locally-scraped content that should be stored centrally:

```
POST /api/v1/content/save
Authorization: Bearer <api_key_or_jwt>
Content-Type: application/json

{
  "url": "https://example.com/page",
  "content": {
    "text_data": "Full extracted text from the page...",
    "ai_research_content": "Cleaned text optimized for AI consumption...",
    "overview": {"title": "Page Title", "description": "Brief summary"},
    "links": {"internal": ["https://example.com/other"], "external": ["https://other.com"]},
    "hashes": ["sha256_of_content"],
    "main_image": "https://example.com/hero.jpg"
  },
  "content_type": "html",
  "char_count": 5432,
  "ttl_days": 30
}

Response:
{
  "status": "stored",
  "page_name": "example_com_page",
  "url": "https://example.com/page",
  "domain": "example.com",
  "char_count": 5432
}
```

This stores the content in `scrape_parsed_page` — the exact same table the server uses for its own scrapes. All content fields are optional except `text_data` or `ai_research_content` (at least one should be present).

### Content Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text_data` | string | Recommended | Full extracted text |
| `ai_research_content` | string | Recommended | Cleaned text for AI |
| `overview` | object | Optional | `{title, description}` |
| `links` | object | Optional | `{internal: [], external: []}` |
| `hashes` | array | Optional | Content hashes for dedup |
| `main_image` | string | Optional | Primary image URL |

---

## Retry Queue (LIVE — Built and Deployed)

The server automatically queues failed scrapes for desktop retry. The full pipeline:

```
1. Frontend requests scrape → server tries → FAILS (Cloudflare, blocked, etc.)
2. Server logs failure + auto-enqueues in scrape_retry_queue (tier=desktop)
3. matrx-local polls GET /queue/pending → gets list of failed URLs
4. matrx-local claims items → scrapes locally with residential IP
5. On success: POST /queue/submit → content saved to server DB
6. On failure: POST /queue/fail → optionally promotes to Chrome extension tier
```

### Queue API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/queue/pending?tier=desktop&limit=10` | Get URLs needing retry |
| `POST` | `/api/v1/queue/claim` | Claim items (10 min TTL) |
| `POST` | `/api/v1/queue/submit` | Submit scraped content for claimed item |
| `POST` | `/api/v1/queue/fail` | Report failure, optionally promote tier |
| `GET` | `/api/v1/queue/stats` | Queue statistics |

### Polling Flow (What matrx-local Needs to Build)

```python
# Background task — runs every 30 seconds
async def poll_retry_queue():
    # 1. Check for pending items
    resp = await client.get(
        f"{SERVER}/api/v1/queue/pending?tier=desktop&limit=5",
        headers=auth_headers,
    )
    items = resp.json()["items"]
    if not items:
        return

    # 2. Claim them
    ids = [item["id"] for item in items]
    claim_resp = await client.post(
        f"{SERVER}/api/v1/queue/claim",
        headers=auth_headers,
        json={"item_ids": ids, "client_id": MY_CLIENT_ID, "client_type": "desktop"},
    )

    # 3. Scrape each URL locally
    for item in items:
        result = await local_scraper.scrape(item["target_url"])

        if result.success:
            # 4a. Save back to server
            await client.post(
                f"{SERVER}/api/v1/queue/submit",
                headers=auth_headers,
                json={
                    "queue_item_id": item["id"],
                    "url": item["target_url"],
                    "content": {
                        "text_data": result.text,
                        "ai_research_content": result.ai_text,
                    },
                    "content_type": "html",
                    "char_count": len(result.text),
                },
            )
        else:
            # 4b. Report failure, promote to extension tier
            await client.post(
                f"{SERVER}/api/v1/queue/fail",
                headers=auth_headers,
                json={
                    "queue_item_id": item["id"],
                    "error": str(result.error),
                    "promote_to_extension": True,
                },
            )
```

### Claim Expiration

Claims expire after 10 minutes. If the desktop doesn't submit or fail the item in time, it automatically returns to `pending` for another client to pick up.

### Retryable Failure Reasons (What Gets Auto-Queued)

- `cloudflare_block` — residential IP usually bypasses this
- `blocked` — generic IP/geo blocks
- `bad_status` — 403, 429 rate limiting
- `request_error` — connection failures
- `proxy_error` — server proxy failures

**NOT auto-queued:** `parse_error`, `non_html_content`, `low_text_content` (retrying won't help)

---

## Machine-Readable API Docs

For agents and automated tools:

```
GET https://scraper.app.matrxserver.com/api/v1/docs/api
```

Returns the full API documentation as JSON — no auth required, no secrets. Includes all endpoints, request/response schemas, the retry pipeline flow, and content save guide.

---

## Admin Tools (For Browsing Scrape Data)

Two admin UIs are live and connected to the scraper database:
- **Directus CMS:** `https://directus.app.matrxserver.com` — REST/GraphQL API on all scraper tables
- **NocoDB:** `https://nocodb.app.matrxserver.com` — Spreadsheet-style data browser

These are for admin use — the desktop app should not call these.
