# Scraper Server Integration — Status

> Updated: 2026-02-21 by matrx-local (Python engine)
> Server: `scraper.app.matrxserver.com`

---

## ✅ All Questions Answered — Integration Complete

All original questions have been answered by the server admin. Summary of confirmed facts:

| Topic            | Answer                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------- |
| API docs         | Swagger at `/docs`, OpenAPI at `/openapi.json`, machine-readable at `/api/v1/docs/api` |
| Base path        | `/api/v1/`                                                                             |
| Auth             | `Authorization: Bearer <token>` (API key or Supabase JWT)                              |
| Key scope        | Global org key; per-user via JWT                                                       |
| Data persistence | Dedicated Postgres 17 on Coolify (not Supabase)                                        |
| Stored data      | Parsed content in `scrape_parsed_page` (JSONB), 30-day TTL                             |
| CORS             | N/A — Python engine is always the proxy                                                |
| Rate limits      | No hard limits; practical: 20 concurrent scrapes, 50 URLs/batch max recommended        |
| Proxy rotation   | Server-side; clients just send URLs                                                    |

---

## ✅ What We've Implemented (Python Engine)

### Core methods (`remote_client.py`) — all confirmed working:

| Method                 | Server Endpoint                  | Status     |
| ---------------------- | -------------------------------- | ---------- |
| `health()`             | `GET /api/v1/health`             | ✅ Working |
| `scrape()`             | `POST /api/v1/scrape`            | ✅ Working |
| `search()`             | `POST /api/v1/search`            | ✅ Working |
| `search_and_scrape()`  | `POST /api/v1/search-and-scrape` | ✅ Working |
| `research()`           | `POST /api/v1/research`          | ✅ Working |
| `stream_sse()`         | `POST /api/v1/*/stream`          | ✅ Working |
| `get_domain_configs()` | `GET /api/v1/config/domains`     | ✅ Working |
| `save_content()`       | `POST /api/v1/content/save`      | ✅ Added   |
| `get_pending()`        | `GET /api/v1/queue/pending`      | ✅ Added   |
| `claim_items()`        | `POST /api/v1/queue/claim`       | ✅ Added   |
| `submit_result()`      | `POST /api/v1/queue/submit`      | ✅ Added   |
| `report_failure()`     | `POST /api/v1/queue/fail`        | ✅ Added   |
| `queue_stats()`        | `GET /api/v1/queue/stats`        | ✅ Added   |

---

## 🔲 Remaining Work (Our Side)

### 1. Retry Queue Background Polling (Python Engine)

Need to build the background task that runs every ~30s:

1. `get_pending(tier="desktop")` → get failed URLs
2. `claim_items(ids)` → claim with 10-min TTL
3. Scrape locally using residential IP
4. On success: `submit_result()` → content stored on server
5. On failure: `report_failure(promote_to_extension=True)`

**Retryable failures** (auto-queued by server): `cloudflare_block`, `blocked`, `bad_status`, `request_error`, `proxy_error`

### 2. Auto Save-Back After Local Scrapes

When the local engine scrapes a page successfully (especially as fallback after remote failure), auto-call `save_content()` to push the result to the server's central DB so all clients benefit.

### 3. Expose Queue Endpoints via Routes

Add FastAPI routes in `remote_scraper_routes.py` to expose queue status/stats to the frontend.

---

## No Outstanding Questions for Server Admin

All integration details are resolved. The admin tools (Directus CMS at `directus.app.matrxserver.com`, NocoDB at `nocodb.app.matrxserver.com`) are available for data browsing but not used by the desktop app.

Routing logic confirmed:

1. Try remote first (faster, proxy pool, persistent cache)
2. If `CLOUDFLARE_BLOCK` or `BLOCKED` → retry locally (residential IP)
3. If both fail → queue for Chrome extension (future)
