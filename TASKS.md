# Matrx Local -- Task Tracker

> Living document. Every discovered bug, missing feature, or architectural issue gets logged here immediately.
> Check items off as they're resolved. Expand with details as investigation progresses.

---

## Critical / Blocking

- [x] **Missing `supabase.ts`** -- Created `desktop/src/lib/supabase.ts` with `getSupabase()` singleton using `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` env vars.
- [x] **No `.env` file for desktop** -- Created `desktop/.env.example` with Supabase credentials template. Arman needs to copy to `.env` and fill in values.
- [x] **Hardcoded DB credentials** -- `app/database.py` now uses `DATABASE_URL` from `config.py` instead of hardcoded creds. Raises `RuntimeError` if `DATABASE_URL` is not set.
- [ ] **No `.env` file at project root** -- Only `.env.example` exists. Arman needs to copy to `.env` and set `API_KEY`.

---

## Settings Page

- [x] **Theme switching does nothing** -- Created `use-theme.ts` hook that applies/removes `.dark` class on `document.documentElement`, persists to localStorage, and respects `system` via `prefers-color-scheme` media query. Default is dark.
- [x] **Settings not persisted** -- Created `lib/settings.ts` with localStorage-backed persistence. Settings load on mount and save on change.
- [x] **"Open Logs Folder" button has no handler** -- Now invokes `OpenPath` tool via engine API to open `system/logs/`.
- [x] **"Open Data Folder" button has no handler** -- Now invokes `OpenPath` tool via engine API to open `system/data/`.
- [x] **"Restart Engine" is identical to "Reconnect"** -- Now properly stops and restarts the sidecar in Tauri mode. Falls back to reconnect in dev mode.
- [ ] **Launch on Startup toggle not wired to OS** -- Setting is persisted in localStorage but needs Tauri autostart plugin or OS-level registration to actually take effect.
- [ ] **Minimize to Tray toggle not wired to Rust** -- Setting is persisted but doesn't control the Rust-side tray behavior. Needs Tauri command to read this setting.
- [ ] **Headless mode toggle not sent to engine** -- Setting is persisted locally but the Python scraper's headless mode isn't configurable via API yet. Need a settings endpoint on the engine.
- [ ] **Request delay not sent to engine** -- Same as above; persisted locally but value never reaches the Python engine.

---

## Dark/Light Theme

- [x] **No theme context or provider** -- Created `use-theme.ts` hook in `desktop/src/hooks/`. Manages `.dark` class on `<html>`, persists to localStorage.
- [x] **Default should be dark** -- Default theme is now `"dark"`. Applied on first load.
- [x] **System theme detection** -- "System" option uses `window.matchMedia('(prefers-color-scheme: dark)')` and listens for live changes.

---

## API / Backend Connections

- [x] **`app/database.py` conflicts with `config.py`** -- Unified to use `DATABASE_URL` from `config.py`. No more hardcoded credentials.
- [ ] **No auth validation on Python endpoints** -- All REST and WS endpoints have no authentication middleware. JWT token is sent from frontend but never validated server-side. Security risk for production.
- [ ] **`/local-scrape/status` and `/local-scrape/scrape` endpoints** -- Referenced in `api.ts` but need to verify these routes exist in the Python backend.
- [x] **Engine health endpoint mismatch** -- `sidecar.ts` now uses `/tools/list` (consistent with `api.ts` discovery).

---

## Database & Sync

- [x] **Local vs remote DB strategy clarified** -- Three separate concerns: (1) Dedicated scrape server PostgreSQL via `DATABASE_URL`, (2) Main app Supabase for auth (client token only), (3) In-memory fallback when no DB configured.
- [ ] **No Alembic migration runner in matrx_local** -- The scraper-service has migrations, but the main `app/` doesn't run them. If `DATABASE_URL` points to a fresh DB, the schema won't exist.
- [ ] **No data sync between local cache and cloud** -- BACKLOG.md mentions "Result sync" as a future feature. Currently, scrape results stay local.

---

## Missing Supabase Integration

- [x] **Supabase client file** -- Created `desktop/src/lib/supabase.ts`.
- [x] **Supabase env vars** -- Added to `desktop/.env.example`. Arman needs to fill in actual values.

---

## Architecture Documentation Gaps

- [x] **ARCHITECTURE.md settings note** -- Updated to reflect current state (settings still ephemeral but now localStorage-backed, theme non-functional note updated).
- [ ] **Version mismatch in About section** -- `Settings.tsx` hardcodes "Version 1.0.0" and "Engine Version 0.3.0". Should read from `package.json` and engine health endpoint dynamically.
- [x] **Badge component `variant="success"`** -- Verified: custom `success` and `warning` variants are defined in `badge.tsx`. No issue.

---

## Code Quality

- [x] **`use-engine.ts` health check uses stale closure** -- Fixed using `statusRef` pattern. Health check interval now reads current status via ref instead of stale closure.
- [ ] **No error boundary** -- If the engine hook throws, the entire app crashes with no recovery UI.
- [x] **`sidecar.ts:51` hits `/health` but no such route** -- Changed to `/tools/list` (matches engine discovery).

---

## Future Work (from BACKLOG.md, not blocking)

- [x] Wire localStorage to Settings page (Tauri Store upgrade deferred)
- [ ] Auto-updater endpoint configuration
- [ ] First-run setup wizard
- [ ] Job queue for cloud-assigned scrape jobs
- [ ] Device registration with cloud
- [ ] Result sync to cloud storage
- [ ] Engine settings API (headless mode, request delay, etc.)
- [ ] Auth middleware on Python endpoints

---

*Last updated: 2026-02-19*
