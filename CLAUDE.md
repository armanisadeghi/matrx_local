# CLAUDE.md -- Matrx Local Project Instructions

> Project-specific instructions for AI assistants working on this codebase.
> This supplements the global `/Users/armanisadeghi/Code/CLAUDE.md`.

---

## Project Overview

Matrx Local is a **Tauri v2 desktop app** (Rust shell + React UI) with a **Python/FastAPI backend engine** that runs as a sidecar. It exposes 23 tools (filesystem, shell, scraping, etc.) via REST and WebSocket for the AI Matrx cloud platform.

**This is NOT a Next.js project.** The global CLAUDE.md's Next.js/Vercel rules do not apply here. This project uses:
- **Desktop:** Tauri v2 (Rust) + React 19 + TypeScript 5.7 + Vite 6
- **Styling:** Tailwind CSS 3.4 + shadcn/ui (Radix UI) -- `darkMode: "class"` strategy
- **Backend:** Python 3.13+ / FastAPI / Uvicorn
- **Auth:** Supabase Auth (OAuth + email) -- Supabase also acts as OAuth Server for shipping
- **DB:** PostgreSQL via Supabase (optional, graceful degradation to in-memory)
- **Scraping:** Integrated scraper-service (git subtree, read-only in matrx_local; editable at source repo)
- **Package Managers:** npm (desktop), uv (Python)

---

## Key Architecture Rules

1. **scraper-service/ is read-only in this repo** -- It's a git subtree from the `ai-dream` repo. Never edit files there directly. Use `./scripts/update-scraper.sh` to pull updates. The source repo is at `/Users/armanisadeghi/Code/aidream-current/scraper-service` and CAN be edited directly.
2. **Module isolation** -- The scraper's `app/` is aliased as `scraper_app/` via `sys.modules` in `app/services/scraper/engine.py`. Do not create naming conflicts.
3. **Graceful degradation** -- The engine works without PostgreSQL (memory cache), Playwright (curl-cffi fallback), or Brave API (search disabled). Never make these hard dependencies.
4. **Port 22140** -- Default engine port. Auto-scans 22140-22159. Discovery file at `~/.matrx/local.json`.

---

## Task Tracking

**Two tracking files:**

1. **`TASKS.md`** (project root) -- All bugs, issues, and improvement ideas. Update immediately when:
   - A new bug or issue is discovered
   - An existing task is resolved (check it off)
   - Investigation reveals new details about an existing task

2. **`.arman/ARMAN_TASKS.md`** -- Tasks for Arman to complete manually (Supabase config, env setup, deployments, etc.). Keep entries **simple and concise**: just a checkbox and brief direct instructions. No verbose explanations.

Never let a discovered issue go untracked. If we're in the middle of something else, add it to the right file and continue.

---

## Current State (as of 2026-02-20)

### What Works
- Python FastAPI engine with 73 tools (REST + WebSocket)
- Engine auto-discovery from React UI
- Tool browser and invocation (Tools page)
- Scraping interface (Scraping page)
- Activity log with real-time WebSocket events
- Dashboard with live system info and browser detection
- Tauri sidecar lifecycle (spawn/kill)
- CORS configuration
- Remote scraper proxy routes (`/remote-scraper/*`)
- Root `.env` and `desktop/.env` both configured

### Recently Fixed
- **`supabase.ts` created** -- Auth client singleton with publishable key
- **Theme switching** -- `use-theme.ts` hook, `.dark` class, localStorage, system detection
- **Settings persisted** -- `lib/settings.ts` with localStorage backend
- **Button handlers wired** -- Open Logs/Data via `OpenPath` tool, Restart via sidecar
- **`database.py` fixed** -- Uses `DATABASE_URL` from config, no hardcoded credentials
- **Health endpoint mismatch** -- `sidecar.ts` uses `/tools/list` consistently
- **Stale closure** -- `use-engine.ts` health check uses ref pattern
- **Auth header mismatch** -- `remote_client.py` fixed from `X-API-Key` to `Authorization: Bearer`
- **JWT auth on scraper server** -- Deployed to production, `SUPABASE_JWKS_URL` set in Coolify
- **OAuth app registered** -- Client ID `af37ec97-3e0c-423c-a205-3d6c5adc5645`, type `public`
- **JWT forwarding** -- Proxy routes forward user's JWT from incoming request to scraper server
- **Remote scraping in UI** -- Scraping page has Engine/Browser/Remote toggle
- **Error boundary** -- `ErrorBoundary.tsx` wraps entire app in `App.tsx`

### Recently Completed
- **Massive tool expansion** -- 45 new tools added (23 → 68 total) across 12 new modules
- **Process management** -- ListProcesses, LaunchApp, KillProcess, FocusApp
- **Window management** -- ListWindows, FocusWindow, MoveWindow, MinimizeWindow
- **Input automation** -- TypeText, Hotkey, MouseClick, MouseMove
- **Audio tools** -- ListAudioDevices, RecordAudio, PlayAudio, TranscribeAudio (Whisper)
- **Browser automation** -- BrowserNavigate, Click, Type, Extract, Screenshot, Eval, Tabs (Playwright)
- **Network discovery** -- NetworkInfo, NetworkScan, PortScan, MDNSDiscover
- **System monitoring** -- SystemResources, BatteryStatus, DiskUsage, TopProcesses (psutil)
- **File watching** -- WatchDirectory, WatchEvents, StopWatch (watchfiles)
- **OS integration** -- AppleScript, PowerShellScript, GetInstalledApps
- **Scheduler/heartbeat** -- ScheduleTask, ListScheduled, CancelScheduled, HeartbeatStatus, PreventSleep
- **Media processing** -- ImageOCR, ImageResize, PdfExtract, ArchiveCreate, ArchiveExtract
- **WiFi/Bluetooth** -- WifiNetworks, BluetoothDevices, ConnectedDevices
- **Launch on Startup** -- `tauri-plugin-autostart` wired to Settings toggle
- **Minimize to Tray** -- Configurable via `set_close_to_tray` Rust command, synced from Settings
- **Engine settings API** -- `PUT /settings` endpoint, synced on change and on startup
- **SSE streaming** -- Proxy routes + `stream_sse()` on engine, `streamSSE()` in frontend API, real-time results in Scraping page with live progress bar and stop button
- **Auto-updater** -- `tauri-plugin-updater` + `tauri-plugin-process` wired in Rust. Signing keypair generated (`~/.tauri/matrx-local.key`). Settings UI has check/install/restart buttons. Config points to GitHub Releases.
- **Cargo build passes** -- All Rust code compiles clean (`cargo check` + `cargo clippy`)

### Documents & Notes Sync (Latest)
- **Document system** -- Full local .md document store at `~/.matrx/documents/` with Supabase sync
- **Folder hierarchy** -- `note_folders` table with parent_id, nested tree in UI
- **Markdown editor** -- Split/edit/preview modes with formatting toolbar, GFM rendering
- **Bidirectional sync** -- Push (local→cloud), pull (cloud→local), full reconciliation on demand
- **Realtime updates** -- Supabase Realtime subscriptions on notes/folders tables
- **File watcher** -- Detects external .md edits (e.g., VS Code) and auto-pushes to Supabase
- **Conflict detection** -- SHA-256 content hashing, conflict files saved for manual resolution
- **Version history** -- Full version tracking with one-click revert
- **Sharing** -- Per-user permissions (read/comment/edit/admin) + public link sharing
- **Directory mappings** -- Map folders to additional local paths (e.g., repo docs directories)
- **Device tracking** -- Multi-device registration, last-seen timestamps
- **5 new document tools** -- ListDocuments, ReadDocument, WriteDocument, SearchDocuments, ListDocumentFolders (73 total)
- **Migration script** -- `migrations/001_documents_schema.sql` ready to run

### Local Proxy & Cloud Settings Sync (Latest)
- **HTTP proxy server** -- Local forward proxy at `127.0.0.1:22180` for routing traffic through user's IP
- **Proxy management** -- Start/stop/test via REST API (`/proxy/*`), auto-starts on engine startup
- **Proxy UI** -- Settings page has enable toggle, status, URL, stats, test button
- **Cloud settings sync** -- All settings stored in Supabase `app_settings` table as JSON blob
- **Multi-instance support** -- `app_instances` table tracks multiple installations per user
- **System identification** -- Collects OS, CPU, RAM, hostname, generates stable instance ID
- **Bidirectional sync** -- Push local→cloud, pull cloud→local, auto-sync on startup
- **Cloud sync UI** -- Save to Cloud / Pull from Cloud buttons, registered devices list
- **Instance heartbeat** -- 5-minute interval updates `last_seen` in cloud
- **Settings persistence** -- Local JSON at `~/.matrx/settings.json` + localStorage + cloud
- **Migration script** -- `migrations/002_app_instances_settings.sql` ready to run
- **Integration guides** -- `docs/proxy-integration-guide.md` + `docs/proxy-testing-guide.md`

### Still Needs Work
- **Rate limiting** -- No per-user rate limiting on scraper server
- **GitHub Actions** -- Need CI/CD workflow for signed release builds (`tauri-action` + signing key env var)
- **Run documents migration** -- SQL migration needs to be run in Supabase SQL Editor
- **Run app instances migration** -- `migrations/002_app_instances_settings.sql` needs to be run in Supabase SQL Editor
- **Engine Supabase env vars** -- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` need to be set in root `.env`
- **Enable Realtime** -- Supabase Realtime publication needs to include notes, note_folders, note_shares tables

---

## Development Commands

```bash
# Python engine (Terminal 1)
cd /path/to/matrx_local
uv sync --extra browser
uv run python run.py

# React frontend (Terminal 2)
cd desktop
npm install
npm run dev
# Open http://localhost:1420

# Tauri desktop (requires Rust)
cd desktop
npm run tauri:dev
```

---

## File Locations

| What | Where |
|------|-------|
| Python entry point | `run.py` |
| FastAPI app | `app/main.py` |
| Tool implementations | `app/tools/tools/*.py` |
| Remote scraper client | `app/services/scraper/remote_client.py` |
| Remote scraper routes | `app/api/remote_scraper_routes.py` |
| Engine settings API | `app/api/settings_routes.py` |
| Proxy routes | `app/api/proxy_routes.py` |
| Cloud sync routes | `app/api/cloud_sync_routes.py` |
| Proxy server | `app/services/proxy/server.py` |
| Instance manager | `app/services/cloud_sync/instance_manager.py` |
| Settings sync engine | `app/services/cloud_sync/settings_sync.py` |
| Engine auth middleware | `app/api/auth.py` |
| Error boundary | `desktop/src/components/ErrorBoundary.tsx` |
| React entry | `desktop/src/App.tsx` |
| Scraping page | `desktop/src/pages/Scraping.tsx` |
| Settings page | `desktop/src/pages/Settings.tsx` |
| Engine API client | `desktop/src/lib/api.ts` |
| Auth hook | `desktop/src/hooks/use-auth.ts` |
| Engine hook | `desktop/src/hooks/use-engine.ts` |
| Theme hook | `desktop/src/hooks/use-theme.ts` |
| Settings persistence | `desktop/src/lib/settings.ts` |
| Sidecar / update utils | `desktop/src/lib/sidecar.ts` |
| CSS theme vars | `desktop/src/index.css` |
| Tailwind config | `desktop/tailwind.config.ts` |
| Tauri config | `desktop/src-tauri/tauri.conf.json` |
| Rust core | `desktop/src-tauri/src/lib.rs` |
| Scraper bridge | `app/services/scraper/engine.py` |
| Document manager | `app/services/documents/file_manager.py` |
| Document Supabase client | `app/services/documents/supabase_client.py` |
| Document sync engine | `app/services/documents/sync_engine.py` |
| Document API routes | `app/api/document_routes.py` |
| Document tools | `app/tools/tools/documents.py` |
| Documents page | `desktop/src/pages/Documents.tsx` |
| Document components | `desktop/src/components/documents/*.tsx` |
| Documents hook | `desktop/src/hooks/use-documents.ts` |
| Realtime sync hook | `desktop/src/hooks/use-realtime-sync.ts` |
| DB migration (docs) | `migrations/001_documents_schema.sql` |
| DB migration (instances) | `migrations/002_app_instances_settings.sql` |
| Proxy integration guide | `docs/proxy-integration-guide.md` |
| Proxy testing guide | `docs/proxy-testing-guide.md` |
| Local settings file | `~/.matrx/settings.json` |
| Instance ID file | `~/.matrx/instance.json` |
| Architecture docs | `ARCHITECTURE.md` |
| Task tracker | `TASKS.md` |
| Backlog | `BACKLOG.md` |
| Scraper service (source) | `/Users/armanisadeghi/Code/aidream-current/scraper-service` |

---

## Database & Remote Services

### Three external connections:

1. **Supabase Auth** -- The AI Matrx Supabase instance (`txzxabzwovsujtloxrus`). Desktop app uses **publishable key** (not deprecated anon key). All operations use user's JWT. Never use service role key.
2. **Remote Scraper Server** -- `scraper.app.matrxserver.com`. Accessed via REST API with `Authorization: Bearer <token>`. Now supports both API key and Supabase JWT auth. The scraper's PostgreSQL is **internal-only** -- no direct DB access.
3. **Local Scraper Engine** -- The in-process scraper (scraper-service subtree). Can optionally connect to a PostgreSQL for local cache via `DATABASE_URL`, but defaults to in-memory TTLCache.

### Env var mapping:
| Var | File | Purpose |
|-----|------|---------|
| `VITE_SUPABASE_URL` | `desktop/.env` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | `desktop/.env` | Supabase publishable key (safe to embed) |
| `API_KEY` | root `.env` | Local engine's own auth key |
| `SCRAPER_API_KEY` | root `.env` | Remote scraper server API key (Bearer token) |
| `SCRAPER_SERVER_URL` | root `.env` | Remote scraper server base URL |
| `DATABASE_URL` | root `.env` | Optional local PostgreSQL for scraper cache |

### Shipping / Production Auth Strategy:

**Decided:** Use Supabase as OAuth Server (https://supabase.com/docs/guides/auth/oauth-server).

- **Supabase publishable key** -- Safe to embed in binary (RLS enforced, client-side by design).
- **Scraper server auth** -- JWT validation added via JWKS endpoint. Users authenticate with Supabase, get a JWT, and that JWT works directly with the scraper server. No embedded API keys needed.
- **JWKS endpoint:** `https://txzxabzwovsujtloxrus.supabase.co/auth/v1/.well-known/jwks.json`
- **Signing key:** ECC P-256 (ES256), Key ID `8a68756f-4254-41d7-9871-a7615685e38a`
- **Env var on scraper server:** `SUPABASE_JWKS_URL` (set in Coolify, deployed)

### Scraper Server Source:

The scraper-service source repo is at `/Users/armanisadeghi/Code/aidream-current/scraper-service`. Changes pushed to main deploy automatically via Coolify. Key files:
- Auth: `app/api/auth.py` (supports API key + JWT)
- Config: `app/config.py` (Pydantic Settings)
- Tests: `tests/integration/test_api_endpoints.py`

---

## Env Files

**Root `.env`** -- Python engine config (API_KEY, SCRAPER_API_KEY, etc.). Not committed.

**`desktop/.env`** -- Supabase client config (VITE_* vars only). Not committed.

When editing `.env` files: comment out values instead of deleting them, with a note for Arman to clean up.

---

## Arman's Preferences

- Prefers working through issues systematically, one at a time
- Wants all discovered issues tracked immediately in TASKS.md, even mid-conversation
- Values architecture docs staying accurate -- update docs when code changes
- Production-grade only -- no stubs, no TODOs, no placeholder logic
- Keep solutions simple; avoid over-engineering
- Tasks for Arman go in `.arman/ARMAN_TASKS.md` -- keep them simple checkbox items with direct instructions
- Prefers I keep going without stopping until done or stuck
- OK with me creating/editing .env files directly -- just comment out instead of deleting values
