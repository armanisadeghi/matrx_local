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
