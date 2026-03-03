# Matrx Local -- Task Tracker

_Last updated: 2026-03-03_

> Living document. Every discovered bug, missing feature, or architectural issue gets logged here immediately.
> Check items off as they're resolved. Move completed items to the History section at the bottom.

---

## 🔴 AGENT PRIORITY QUEUE

> Pick tasks from top to bottom. Each is self-contained.

### P0 — Fix broken core features (ship blockers)
- [ ] **App icon is default purple box** — Replace placeholder icons in `desktop/src-tauri/icons/` with the AI Matrx logo.
- [ ] **Windows MSI installer looks outdated** — Investigate switching from WiX (.msi) to NSIS (.exe) for a modern installer experience.
- [ ] **Proxy `POST /system/open-folder` 500 Error** — Investigation needed into why this endpoint fails with 500 Internal Server Error when clicking "Open Logs/Data Folder".

### P1 — UX & Settings (needed before public beta)
- [ ] **Tools UI is not user-friendly** — PR #1 (`codex/create-user-friendly-ui-for-tools-tab`) exists. Pull and review.
- [ ] **Verify "Launch on Startup" & "Minimize to Tray"** — Confirm OS-level behavior actually matches the toggles in Settings.
- [ ] **Proxy Test Connection** — Waiting on Arman to confirm `MAIN_SERVER` URL for real round-trip test.
- [ ] **Cloud sync broken: 404 on `app_settings`** — Likely Supabase RLS or missing table. Arman to verify.

### P2 — Features & Polish
- [ ] **First-run setup wizard** — Sign in → Engine health → optional capabilities install → done.
- [ ] **Rate limiting** — Implement per-user rate limiting on the remote scraper server.
- [ ] **Job queue** — For cloud-assigned scrape jobs.
- [ ] **Wake-on-LAN & Smart device control protocols**.

---

## 🟡 OPEN ISSUES & BUGS (Organized by Feature)

### Dashboard
- [ ] Status indicators can sometimes lag behind actual engine state.

### Notes / Documents
- [ ] **Notes page:** UI still calls `/documents/*` — may need to be updated to `/notes/*` if React code is not using the `engine.docRequest` helper in `api.ts`.
- [ ] Conflict resolution UI needs testing with real simultaneous edits after local-first rewrite.
- [ ] Run `migrations/001_documents_schema.sql` on Supabase if cloud sync is desired (not required for local-first operation).

### Tools Page
- [ ] PR #1 for user-friendly UI needs review.
- [ ] Some tools lack descriptive error messages for missing dependencies.

### Settings
- [ ] **General:** "Engine Port" reconnect/restart reliability needs testing.
- [ ] **Proxy:** Test button is currently a placeholder for a real round-trip test.

### CI/CD & Shipping
- [ ] v1.0.0 fix verification (Windows venv path detection, extra all packages).

---

## ✅ HISTORY OF COMPLETED TASKS

### Local-First Architecture Implementation (2026-03-03)
- [x] **config.py:** Added `MATRX_USER_DIR`, `MATRX_NOTES_DIR`, `MATRX_FILES_DIR`, `MATRX_CODE_DIR`, `MATRX_WORKSPACES_DIR`, `MATRX_DATA_DIR`. All user-visible content now lives under `~/Documents/Matrx/` (OS-native Documents folder). Engine internals stay in `~/.matrx/`.
- [x] **file_manager.py:** Updated to use `MATRX_NOTES_DIR`. Startup now creates all required directories (Notes, Files, Code, workspaces, data) in one pass.
- [x] **document_routes.py:** Fully rewritten. Every CRUD operation reads/writes local filesystem first. Supabase is only touched in background fire-and-forget tasks — a failed network never blocks or errors a request. Folder tree is now built from local filesystem scan (no Supabase needed).
- [x] **sync_engine.py:** Architecture already correct (local write before Supabase). Updated docstring to clarify local-first contract.
- [x] **session.py / `_build_alias_map()`:** Added `@notes`, `@files`, `@code`, `@workspaces`, `@agentdata`, `@user` aliases. Old `@docs` kept as deprecated alias.
- [x] **main.py:** Router registered under `/notes` (canonical) and `/documents` (backward-compat alias, hidden from schema).
- [x] **api.ts:** `docRequest` updated to call `/notes`. `EnginePaths` interface updated with all new path fields.
- [x] **routes.py / GET /system/paths:** Returns all new paths so React can discover them.
- [x] **docs/local-storage-architecture.md:** Authored, documenting the golden rules and directory structure.
- [x] **docs/path-resolution-guide.md:** Authored, explaining aliases for the React team.

### Recently Fixed (2026-03-02)
- [x] Fixed 401 Unauthorized on web→local API calls.
- [x] Replaced raw pip commands with "Fix It" messages and capability IDs.
- [x] Fixed blank screen in production builds (HashRouter + CI env vars).
- [x] Dashboard: Added user profile card with avatar and sign-out.
- [x] Dashboard: Fixed Browser Engine status label and installation button.
- [x] Dashboard: Added live CPU/RAM/Disk/Battery resource gauges.
- [x] Documents: Wired sync bar to real trigger; verified backend/frontend logic.
- [x] Scraping: Overhauled UX with flat list, history tab, and auto-prefixing.
- [x] Scraping: Implemented persistence (localStorage) and forbidden URL list.
- [x] Activity: Implemented real-time HTTP and system log streaming.
- [x] Tools: Added monitoring sparklines, improved browser control, and notify fallbacks.
- [x] CI/CD: Wired GitHub Actions for 4-platform builds and releases.
- [x] Verification: Confirmed File picker, Installed Apps persistence, and Scheduler persistence.

### Core Infrastructure & Infrastructure (2026-02)
- [x] Architecture: Unified database strategy using `DATABASE_URL`.
- [x] Auth: Implemented JWT auth on scraper server (dual-auth with API keys).
- [x] Auth: Forwarded JWT from engine to scraper server via bearer token.
- [x] Engine: Fixed lifespan hang when `DATABASE_URL` leaks from shell.
- [x] Desktop: Created `supabase.ts` and `.env` for production builds.
- [x] Settings: Implemented theme switching and native settings persistence.
- [x] Settings: Added "Launch on Startup" and "Minimize to Tray" (Rust side).
- [x] Remote: Created `remote_client.py` and `/remote-scraper/*` proxy routes.
- [x] SSE: Implemented real-time log and scrape result streaming.

### Module Specifics
- [x] **Tools:** Registered 79 tools across 10 categories (Media, Network, Browser, etc.).
- [x] **Documents:** Full sync engine with conflict detection and file watcher.
- [x] **Chat:** Implemented collapsible sidebar and streaming tool-call UI.
- [x] **Proxy:** Developed async HTTP proxy server with CONNECT tunneling.
- [x] **Activity:** Created two-tab real-time viewer for HTTP and System logs.
