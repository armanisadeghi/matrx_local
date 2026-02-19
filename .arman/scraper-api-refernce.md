# Scraper Service — API & Database Reference

> For all teams building clients that interact with the scraper. Last updated 2026-02-19.

---

## Quick Start

**Base URL (production):** `https://scraper.app.matrxserver.com`
**Base URL (dev):** `https://dev.scraper.app.matrxserver.com`
**Interactive docs (Swagger):** `https://scraper.app.matrxserver.com/docs`
**OpenAPI spec:** `https://scraper.app.matrxserver.com/openapi.json`

### Authentication

All requests require an API key in the `X-API-Key` header:

```
X-API-Key: 8538df5cb079441dd8e745e74cf7869d748f6f09cafbced8114fb4ed352ba1a1
```

---

## How to Access the Database

**You do NOT connect to PostgreSQL directly.** The database is internal-only with no public port. All data access goes through the scraper API's REST endpoints.

This applies to:
- **matrx-local** (desktop companion)
- **Chrome plugin**
- **matrx-ship** (admin UI)
- Any other client

### To store scraped content:

```
POST /api/v1/scrape
Content-Type: application/json
X-API-Key: <key>

{
  "urls": ["https://example.com", "https://other-site.com"],
  "options": {}
}
```

The scraper fetches the URLs, parses the content, stores it in the database, and returns the parsed result — all in one call.

### To search and scrape:

```
POST /api/v1/search-and-scrape
Content-Type: application/json
X-API-Key: <key>

{
  "keywords": ["AI framework comparison 2026"],
  "total_results_per_keyword": 5,
  "options": {}
}
```

Searches via Brave, then scrapes the top results.

### To search only (no scraping):

```
POST /api/v1/search
Content-Type: application/json
X-API-Key: <key>

{
  "keywords": ["machine learning papers"],
  "count": 10
}
```

### To run deep research:

```
POST /api/v1/research
Content-Type: application/json
X-API-Key: <key>

{
  "query": "Compare React Native vs Flutter in 2026",
  "effort": "thorough"
}
```

### Streaming variants

Both `/api/v1/scrape/stream` and `/api/v1/search-and-scrape/stream` accept the same request bodies but return Server-Sent Events for real-time progress.

---

## All API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/health` | Health check — returns `{"status":"ok","db":"connected"}` |
| `GET` | `/api/v1/config/domains` | List all configured domains and their settings |
| `POST` | `/api/v1/config/domains` | Create or update domain-specific scrape config |
| `POST` | `/api/v1/scrape` | Scrape one or more URLs → stores and returns parsed content |
| `POST` | `/api/v1/scrape/stream` | Same as scrape, streaming response (SSE) |
| `POST` | `/api/v1/search` | Search via Brave API → returns search results |
| `POST` | `/api/v1/search-and-scrape` | Search + scrape top results → stores and returns content |
| `POST` | `/api/v1/search-and-scrape/stream` | Same as search-and-scrape, streaming (SSE) |
| `POST` | `/api/v1/research` | Full research pipeline — search, scrape, synthesize |

---

## Request/Response Schemas

### ScrapeRequest

```json
{
  "urls": ["https://example.com"],       // required — array of URLs
  "options": {                            // optional
    // FetchOptions — see OpenAPI spec for full details
  }
}
```

### SearchRequest

```json
{
  "keywords": ["search terms"],           // required — array of keyword strings
  "country": "US",                        // optional — country code
  "count": 10,                            // optional — results per keyword
  "offset": 0,                            // optional — pagination offset
  "freshness": null,                      // optional — recency filter
  "safe_search": "moderate"               // optional — "off" | "moderate" | "strict"
}
```

### SearchAndScrapeRequest

```json
{
  "keywords": ["search terms"],           // required
  "country": "US",                        // optional
  "total_results_per_keyword": 5,         // optional — how many results to scrape per keyword
  "options": {}                           // optional — FetchOptions
}
```

### ResearchRequest

```json
{
  "query": "Your research question",     // required
  "country": "US",                        // optional
  "effort": "thorough",                   // optional — "quick" | "thorough"
  "freshness": null,                      // optional
  "safe_search": "moderate"               // optional
}
```

### DomainConfigCreateRequest

```json
{
  "url": "https://example.com",           // required — domain URL
  "common_name": "Example",              // optional
  "scrape_allowed": true,                // optional — default true
  "enabled": true,                        // optional — default true
  "proxy_type": "datacenter"             // optional — "datacenter" | "residential" | etc.
}
```

---

## Database Schema

> You don't need to write SQL — the API handles everything. This is for understanding the data model.

### Entity Relationship

```
scrape_domain (1) ──── (1) scrape_domain_settings
       │
       └──── (many) scrape_path_pattern (1) ──── (many) scrape_path_override

scrape_base_config        (standalone — global parsing rules)
scrape_parsed_page        (standalone — the actual scraped content)
scrape_failure_log        (standalone — error tracking)
```

### Tables

**`scrape_parsed_page`** — Main output table. Every successful scrape creates a row here.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Auto-generated |
| page_name | text | Identifier for the page |
| url | text | Full URL that was scraped |
| domain | text | Domain extracted from URL |
| scraped_at | timestamptz | When the scrape happened |
| expires_at | timestamptz | Cache expiry |
| validity | text | `active` or `expired` |
| content | JSONB | The parsed content (links, text, etc.) |
| char_count | integer | Character count of extracted content |
| content_type | text | `html`, `pdf`, etc. |
| created_at | timestamptz | Row creation time |

Unique constraint: only one `active` row per `page_name`.

**`scrape_domain`** — Registered domains with scrape policies.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Auto-generated |
| url | text | Domain URL (unique) |
| common_name | text | Human-friendly name |
| scrape_allowed | boolean | Whether scraping is permitted |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**`scrape_domain_settings`** — Per-domain scrape configuration (1:1 with domain).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Auto-generated |
| domain_id | UUID | FK → scrape_domain (unique) |
| enabled | boolean | |
| proxy_type | text | `datacenter`, `residential`, etc. |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**`scrape_path_pattern`** — URL path patterns per domain (e.g., `/blog/*`).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Auto-generated |
| domain_id | UUID | FK → scrape_domain |
| pattern | text | Path pattern |
| created_at | timestamptz | |

Unique constraint: (domain_id, pattern).

**`scrape_path_override`** — Override rules for specific path patterns.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Auto-generated |
| path_pattern_id | UUID | FK → scrape_path_pattern |
| is_active | boolean | |
| config_type | text | |
| selector_type | text | |
| match_type | text | |
| action | text | |
| values | JSONB | Array of values |
| created_at | timestamptz | |

**`scrape_base_config`** — Global parsing/filtering rules.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Auto-generated |
| selector_type | text | |
| exact | JSONB | Exact match patterns |
| partial | JSONB | Partial match patterns |
| regex | JSONB | Regex patterns |
| created_at | timestamptz | |

**`scrape_failure_log`** — Failed scrape attempts for debugging.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Auto-generated |
| target_url | text | URL that failed |
| domain_name | text | Domain |
| failure_reason | text | Human-readable reason |
| failure_category | text | Category (timeout, blocked, etc.) |
| status_code | integer | HTTP status code if available |
| error_log | text | Full error details |
| proxy_used | boolean | Whether a proxy was used |
| proxy_type | text | Which proxy type |
| attempt_count | integer | Number of retry attempts |
| created_at | timestamptz | Indexed DESC for recent-first queries |

---

## Service Architecture

```
Client (matrx-local / Chrome plugin / matrx-ship / etc.)
  │
  ├── HTTPS + X-API-Key header
  │
  ▼
scraper.app.matrxserver.com (Caddy reverse proxy)
  │
  ▼
scraper-service container (FastAPI, port 8001)
  ├── Multi-strategy fetching: httpx → curl-cffi → Playwright
  ├── Content extraction: HTML, PDF (PyMuPDF), images (Tesseract OCR)
  ├── Brave Search integration
  │
  ▼
scraper-postgres (PostgreSQL 17, internal network only)
```

### Scraping Pipeline

1. **URL received** → check domain config and cache
2. **Fetch** → tries httpx first, falls back to curl-cffi with browser impersonation, then Playwright
3. **Cloudflare detection** → automatic retry with proxy rotation if blocked
4. **Parse** → HTML parsing, PDF text extraction, or OCR depending on content type
5. **Store** → parsed content saved to `scrape_parsed_page` with TTL
6. **Return** → JSON response with parsed content

### Caching

- Scraped pages have a `validity` field and `expires_at` timestamp
- Only one `active` row per `page_name` (older scrapes become `expired`)
- In-memory TTL cache in the service + PostgreSQL persistence

---

## Environment & Deployment

| Environment | URL | Branch | Notes |
|-------------|-----|--------|-------|
| Production | scraper.app.matrxserver.com | main | Stable releases |
| Development | dev.scraper.app.matrxserver.com | dev | Latest dev code |

Both environments share the same PostgreSQL database. Dev writes to the same tables as prod.

---

## Integration Examples

### Python (httpx)

```python
import httpx

API_URL = "https://scraper.app.matrxserver.com/api/v1"
API_KEY = "8538df5cb079441dd8e745e74cf7869d748f6f09cafbced8114fb4ed352ba1a1"

headers = {"X-API-Key": API_KEY}

# Scrape URLs
response = httpx.post(
    f"{API_URL}/scrape",
    json={"urls": ["https://example.com"]},
    headers=headers,
    timeout=60.0,
)
data = response.json()
```

### TypeScript (fetch)

```typescript
const API_URL = "https://scraper.app.matrxserver.com/api/v1";
const API_KEY = "8538df5cb079441dd8e745e74cf7869d748f6f09cafbced8114fb4ed352ba1a1";

const response = await fetch(`${API_URL}/scrape`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY,
  },
  body: JSON.stringify({ urls: ["https://example.com"] }),
});
const data = await response.json();
```

### cURL

```bash
curl -X POST https://scraper.app.matrxserver.com/api/v1/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 8538df5cb079441dd8e745e74cf7869d748f6f09cafbced8114fb4ed352ba1a1" \
  -d '{"urls": ["https://example.com"]}'
```
