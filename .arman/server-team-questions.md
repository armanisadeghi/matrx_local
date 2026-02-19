# Scraper Server — Integration Status

> From: matrx-local desktop app team
> Date: 2026-02-19 (updated)

We have direct repo access to `scraper-service` and have implemented JWT auth. This doc tracks what was resolved and what's still open.

---

## RESOLVED — JWT Auth Added

We added Supabase JWT validation as an alternative to API key directly in the scraper server:

- **`app/api/auth.py`** -- Now accepts both API key (`Bearer <API_KEY>`) and Supabase JWT (`Bearer <supabase_jwt>`). The API key check is the fast path; JWT validation runs only if the token doesn't match the API key.
- **`app/config.py`** -- Added `SUPABASE_JWKS_URL` setting (optional, empty by default).
- **`pyproject.toml`** -- Added `PyJWT[crypto]>=2.10.0` dependency for ES256 key validation.
- **JWKS endpoint:** `https://txzxabzwovsujtloxrus.supabase.co/auth/v1/.well-known/jwks.json`
- **Signing key:** ECC P-256 (ES256), Key ID `8a68756f-4254-41d7-9871-a7615685e38a`

**Coolify action needed:** Add `SUPABASE_JWKS_URL=https://txzxabzwovsujtloxrus.supabase.co/auth/v1/.well-known/jwks.json` to production env vars after pushing to main.

---

## RESOLVED — Auth Header Format

The scraper server uses `Authorization: Bearer <token>` (HTTPBearer scheme), NOT `X-API-Key`. The matrx_local remote client has been fixed to use the correct header format.

---

## RESOLVED — Database Access

The scraper server's PostgreSQL is internal-only (Docker network). No direct DB access needed from the desktop app. All data goes through the REST API.

---

## RESOLVED — Endpoint Mapping

| Desktop Route | Scraper Server Route | Auth |
|--------------|---------------------|------|
| `GET /remote-scraper/status` | `GET /api/v1/health` | None (health is public) |
| `POST /remote-scraper/scrape` | `POST /api/v1/scrape` | Bearer token |
| `POST /remote-scraper/search` | `POST /api/v1/search` | Bearer token |
| `POST /remote-scraper/search-and-scrape` | `POST /api/v1/search-and-scrape` | Bearer token |
| `POST /remote-scraper/research` | `POST /api/v1/research` | Bearer token |

---

## Still Open

### 1. Rate Limiting / User Quotas

When this ships to thousands of users authenticating via JWT:
- Should we implement rate limiting per user (based on JWT `sub` claim)?
- Should we add client-side throttling in the desktop app?
- What are the server's current capacity limits?

### 2. SSE Event Format

Need to document the exact event types and payload shapes from the SSE streaming endpoints for the desktop UI. Can be investigated from `app/api/routes/scrape.py` and `search.py` directly.

### 3. Response Schema Documentation

Need to document response shapes. Can be investigated from `app/models/responses.py` directly.

### 4. Local vs Remote Cache Syncing (Future)

Should desktop-scraped pages be pushed to the server cache? This would let users with residential IPs contribute to the shared cache.

---

*Most of the original 7 questions are resolved now that we have repo access and implemented JWT auth directly.*
