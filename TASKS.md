# Matrx Local -- Task Tracker

> Living document. Every discovered bug, missing feature, or architectural issue gets logged here immediately.
> Check items off as they're resolved. Expand with details as investigation progresses.

---

## Critical / Blocking

- [x] **Missing `supabase.ts`** -- Created with publishable key pattern (default export).
- [x] **No `.env` file for desktop** -- Created and populated with Supabase URL + publishable key.
- [x] **Hardcoded DB credentials** -- `app/database.py` now uses `DATABASE_URL` from `config.py`.
- [x] **Root `.env` created** -- Contains `API_KEY`, `SCRAPER_API_KEY`, `SCRAPER_SERVER_URL`. Fixed leading whitespace.
- [x] **Supabase client updated** -- Uses publishable key (not deprecated anon key). Default export pattern.
- [x] **Auth header mismatch fixed** -- `remote_client.py` was sending `X-API-Key` but scraper server expects `Authorization: Bearer <token>`.

---

## Auth & Shipping Strategy

- [x] **JWT auth added to scraper server** -- Accepts both API key and Supabase JWT via JWKS (ES256).
- [x] **Shipping strategy decided** -- Supabase OAuth, JWT auth on scraper server, no embedded API keys.
- [x] **Deployed to production** -- Scraper-service pushed to main, `SUPABASE_JWKS_URL` set in Coolify.
- [x] **OAuth app registered** -- Client ID `af37ec97-3e0c-423c-a205-3d6c5adc5645`, type `public`.
- [x] **JWT forwarding** -- Proxy routes forward user's JWT from incoming request to scraper server.
- [ ] **Auth middleware on Python engine** -- Local engine endpoints still have no JWT validation.

---

## Settings Page

- [x] **Theme switching** -- `use-theme.ts` hook manages `.dark` class, persists to localStorage, default dark.
- [x] **Settings persisted** -- `lib/settings.ts` with localStorage backend.
- [x] **Folder buttons wired** -- Open Logs/Data via engine `OpenPath` tool.
- [x] **Restart Engine** -- Proper sidecar stop/start in Tauri mode.
- [ ] **Launch on Startup** -- Persisted locally but not wired to OS. Needs Tauri autostart plugin.
- [ ] **Minimize to Tray** -- Persisted but doesn't control Rust-side behavior.
- [ ] **Headless mode / Request delay** -- Persisted locally but never sent to engine. Need engine settings API.

---

## Remote Scraper Integration

- [x] **`remote_client.py` created** -- HTTP client with `Authorization: Bearer` auth + JWT forwarding.
- [x] **`remote_scraper_routes.py` created** -- Proxy routes at `/remote-scraper/*` with auth forwarding.
- [x] **Config updated** -- `SCRAPER_API_KEY` and `SCRAPER_SERVER_URL` in `app/config.py`.
- [x] **JWT auth on server** -- Scraper server validates Supabase JWTs via JWKS.
- [x] **Frontend integration** -- Scraping page has Engine/Browser/Remote toggle. Remote calls `/remote-scraper/scrape`.
- [x] **`api.ts` methods** -- Added `scrapeRemotely()`, `remoteScraperStatus()`, `RemoteScrapeResponse` type.
- [ ] **SSE streaming** -- Need to integrate SSE streaming endpoints in the desktop UI.
- [ ] **Rate limiting** -- No per-user rate limiting on scraper server yet.

---

## API / Backend Connections

- [x] **Database connection unified** -- Uses `DATABASE_URL` from config.
- [x] **Health endpoint mismatch** -- `sidecar.ts` now uses `/tools/list`.
- [x] **Remote scraper integration** -- Full proxy + JWT forwarding.
- [ ] **`/local-scrape/status` and `/local-scrape/scrape` endpoints** -- Referenced in `api.ts` but don't exist. `getBrowserStatus()` gracefully falls back. `scrapeLocally()` is dead code.

---

## Database & Sync

- [x] **DB strategy clarified** -- Scraper DB is internal-only. All data via REST API with Bearer auth.
- [ ] **No Alembic migration runner** -- Only matters if `DATABASE_URL` is set locally.
- [ ] **No data sync** -- Local scrape results don't push to cloud. Future feature.

---

## Supabase Integration

- [x] **Client file** -- `desktop/src/lib/supabase.ts` with publishable key.
- [x] **Env vars** -- `desktop/.env` populated.
- [x] **Auth hooks** -- `use-auth.ts` and `use-engine.ts` updated to use default import.
- [x] **JWKS info captured** -- Key ID `8a68756f`, ES256, JWKS endpoint documented.
- [x] **OAuth app registered** -- Client ID `af37ec97-3e0c-423c-a205-3d6c5adc5645`.

---

## Code Quality

- [x] **Stale closure fixed** in `use-engine.ts` health check.
- [x] **Error boundary added** -- `ErrorBoundary.tsx` wraps entire app in `App.tsx`.
- [ ] **Version hardcoded** in Settings About section. Should be dynamic.
- [ ] **Dead code in api.ts** -- `scrapeLocally()` and `getBrowserStatus()` call non-existent `/local-scrape/*` routes.

---

## Future Work

- [ ] Auto-updater endpoint configuration
- [ ] First-run setup wizard
- [ ] Job queue for cloud-assigned scrape jobs
- [ ] Device registration with cloud
- [ ] Result sync to cloud storage
- [ ] Engine settings API (headless mode, request delay)
- [ ] SSE streaming support in desktop UI for scrape progress
- [ ] Clean up dead `/local-scrape/*` code in api.ts
- [ ] Auth middleware on local Python engine endpoints

---

*Last updated: 2026-02-19*
