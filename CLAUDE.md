# CLAUDE.md -- Matrx Local Project Instructions

> Project-specific instructions for AI assistants working on this codebase.
> This supplements the global `/Users/armanisadeghi/Code/CLAUDE.md`.

---

## Project Overview

Matrx Local is a **Tauri v2 desktop app** (Rust shell + React UI) with a **Python/FastAPI backend engine** that runs as a sidecar. It exposes 79 tools (filesystem, shell, scraping, documents, etc.) via REST and WebSocket for the AI Matrx cloud platform.

**This is NOT a Next.js project.** The global CLAUDE.md's Next.js/Vercel rules do not apply here. This project uses:
- **Desktop:** Tauri v2 (Rust) + React 19 + TypeScript 5.7 + Vite 6
- **Styling:** Tailwind CSS 3.4 + shadcn/ui (Radix UI) -- `darkMode: "class"` strategy
- **Backend:** Python 3.13+ / FastAPI / Uvicorn
- **Auth:** Supabase Auth (OAuth + email) -- Supabase also acts as OAuth Server for shipping
- **DB:** PostgreSQL via Supabase (optional, graceful degradation to in-memory)
- **Scraping:** Integrated scraper-service (git subtree, read-only in matrx_local; editable at source repo)
- **Package Managers:** pnpm (desktop), uv (Python)

---

## Key Architecture Rules

1. **scraper-service/ is read-only in this repo** -- It's a git subtree from the `aidream` repo. Never edit files there directly. Use `./scripts/update-scraper.sh` to pull updates. The source repo is at `/Users/armanisadeghi/Code/aidream-current/scraper-service` and CAN be edited directly.
2. **Module isolation** -- The scraper's `app/` is aliased as `scraper_app/` via `sys.modules` in `app/services/scraper/engine.py`. Do not create naming conflicts.
3. **Graceful degradation** -- The engine works without PostgreSQL (memory cache) or Brave API (search disabled). Never make these hard dependencies. Playwright, psutil, and zeroconf are core dependencies and always available.
4. **Port 22140** -- Default engine port. Auto-scans 22140-22159. Discovery file at `~/.matrx/local.json`.

---

## Task Tracking

**Two tracking files:**

1. **`AGENT_TASKS.md`** (project root) -- All bugs, issues, and improvement ideas. Update immediately when:
   - A new bug or issue is discovered
   - An existing task is resolved (check it off)
   - Investigation reveals new details about an existing task

2. **`.arman/ARMAN_TASKS.md`** -- Tasks for Arman to complete manually (Supabase config, env setup, deployments, etc.). Keep entries **simple and concise**: just a checkbox and brief direct instructions. No verbose explanations.

Never let a discovered issue go untracked. If we're in the middle of something else, add it to the right file and continue.

---

## Current State (as of 2026-03-02)

### What Works
- Python FastAPI engine with 79 tools (REST + WebSocket)
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
- **Button handlers wired** -- Open Logs/Data via `POST /system/open-folder` endpoint, Restart via sidecar
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
- **5 new document tools** -- ListDocuments, ReadDocument, WriteDocument, SearchDocuments, ListDocumentFolders (79 total)
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
- **Migration script** -- `migrations/002_app_instances_settings.sql` run in Supabase ✓ (per ARMAN_TASKS)
- **Integration guides** -- `docs/proxy-integration-guide.md` + `docs/proxy-testing-guide.md`

### Voice Transcription (Latest)
- **whisper-cpp-plus** -- Local Whisper transcription via whisper.cpp Rust bindings (v0.1.4)
- **Hardware detection** -- Auto-detects RAM, CPU threads, CUDA GPUs, Apple Silicon/Metal
- **Adaptive model selection** -- Recommends tiny/base/small model based on system capabilities
- **Model download** -- On-demand GGML model download from HuggingFace with progress events
- **One-click setup** -- Hardware detect + model download + init in a single button click
- **Live transcription** -- Real-time microphone capture (cpal) → Whisper inference → UI segments
- **Voice page** -- New `/voice` tab with Setup, Transcribe, Models, and Audio Devices sub-tabs
- **12 Tauri commands** -- detect_hardware, download_whisper_model, download_vad_model, init_transcription, check_model_exists, get_active_model, list_downloaded_models, delete_model, start_transcription, stop_transcription, list_audio_input_devices, get_voice_setup_status
- **Persistent config** -- Selected model saved to `transcription.json` in app data dir
- **Future** -- Custom wake words for triggering AI agents automatically

### Local LLM Inference (Latest)
- **llama-server sidecar** -- Local text model inference via llama.cpp's official server binary
- **Rust LLM module** -- `src-tauri/src/llm/` with config, model_selector, server, commands
- **10 Tauri commands** -- start_llm_server, stop_llm_server, get_llm_server_status, check_llm_server_health, check_llm_model_exists, download_llm_model, list_llm_models, delete_llm_model, detect_llm_hardware, get_llm_setup_status
- **Model catalog** -- 5 models: Qwen3-4B, Phi-4-mini, Qwen3-8B (default), Qwen2.5-14B, Mistral-Small-3.1-24B
- **Hardware-adaptive** -- Auto-selects model tier based on RAM/GPU/Apple Silicon, auto-configures GPU layer offload
- **OpenAI-compatible API** -- `/v1/chat/completions` with tool calling (`--jinja`), streaming, structured output
- **TypeScript API client** -- `lib/llm/api.ts` with chatCompletion, streamCompletion, callWithTools, structuredOutput
- **Admin page** -- `/local-models` with 5 tabs: Overview (quick setup), Models (download/load/delete), Server (status/health), Hardware (detection), Test (inference playground)
- **Process lifecycle** -- Auto-kills on app quit, orphan detection via port scanning, health checks

### Still Needs Work
- **Rate limiting** -- No per-user rate limiting on scraper server
- **Cloud sync 404** -- If `app_settings` returns 404 despite migration 002 run, verify table exists and RLS in Supabase (see AGENT_TASKS Investigation section)
- **Voice: CDN mirror** -- Models download from HuggingFace directly; S3/CloudFront mirror not yet set up
- **Voice: cmake requirement** -- whisper-cpp-plus requires cmake at build time (not at runtime)
- **LLM: binaries not bundled** -- llama-server pre-built binaries must be downloaded and placed in `src-tauri/binaries/` before the Tauri build will work
- **LLM: CDN mirror** -- GGUF models download from HuggingFace; mirror to `assets.aimatrx.com` before shipping
- **LLM: Cloud capability sync** -- Device's available local models should be synced to Supabase for web app visibility

---

## Development Commands

```bash
# Python engine (Terminal 1)
cd /path/to/matrx_local
uv sync
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
| Transcription module (Rust) | `desktop/src-tauri/src/transcription/*.rs` |
| Transcription types (TS) | `desktop/src/lib/transcription/types.ts` |
| Transcription hook | `desktop/src/hooks/use-transcription.ts` |
| Voice page | `desktop/src/pages/Voice.tsx` |
| Transcription config | `~/{app_data}/transcription.json` |
| Whisper models | `~/{app_data}/models/*.bin` |
| LLM module (Rust) | `desktop/src-tauri/src/llm/*.rs` |
| LLM types (TS) | `desktop/src/lib/llm/types.ts` |
| LLM API client (TS) | `desktop/src/lib/llm/api.ts` |
| LLM hook | `desktop/src/hooks/use-llm.ts` |
| Local Models page | `desktop/src/pages/LocalModels.tsx` |
| LLM config | `~/{app_data}/llm.json` |
| GGUF models | `~/{app_data}/models/*.gguf` |
| llama-server binaries | `desktop/src-tauri/binaries/llama-server-*` |
| Architecture docs | `ARCHITECTURE.md` |
| Task tracker | `AGENT_TASKS.md` |
| Backlog | `BACKLOG.md` |
| Scraper service (source) | `/Users/armanisadeghi/Code/aidream-current/scraper-service` |

---

## Database & Remote Services

### Three external connections:

1. **Supabase Auth** -- The AI Matrx Supabase instance (`txzxabzwovsujtloxrus`). Desktop app uses **publishable key** (not deprecated anon key). All operations use user's JWT. Never use service role key.
2. **Remote Scraper Server** -- `scraper.app.matrxserver.com`. Accessed via REST API with `Authorization: Bearer <token>`. Now supports both API key and Supabase JWT auth. The scraper's PostgreSQL is **internal-only** -- no direct DB access.
3. **Local Scraper Engine** -- The in-process scraper (scraper-service subtree). Can optionally connect to a **local** PostgreSQL (on the user's machine) for persistent scrape cache via `DATABASE_URL`, but defaults to in-memory TTLCache. This is NOT the remote server's database.

### Env var mapping:
| Var | File | Purpose |
|-----|------|---------|
| `VITE_SUPABASE_URL` | `desktop/.env` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | `desktop/.env` | Supabase publishable key (safe to embed) |
| `API_KEY` | root `.env` | Local engine's own auth key |
| `SCRAPER_API_KEY` | root `.env` | Remote scraper server API key (Bearer token) |
| `SCRAPER_SERVER_URL` | root `.env` | Remote scraper server base URL |
| `DATABASE_URL` | root `.env` | Optional **local** PostgreSQL for scraper cache (user's machine, NOT remote server) |

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

## Database Migrations

**Rule: Never create a migration file without immediately applying it.**

Migrations live in `migrations/NNN_name.sql`. The Supabase MCP (`plugin-supabase-supabase`) is available and must be used to apply every migration in the same session it is written. The target project is `txzxabzwovsujtloxrus` (automation-matrix).

Workflow for any schema change:
1. Write the migration SQL file in `migrations/`.
2. Immediately call `apply_migration` via the Supabase MCP — never leave a migration unapplied.
3. Call `execute_sql` to verify the schema change landed (e.g. check `information_schema.columns`).
4. Mark the corresponding `.arman/ARMAN_TASKS.md` item as done (if one exists).
5. Update `AGENT_TASKS.md` to record the migration was applied.

A migration file that exists on disk but has not been applied to Supabase is a broken state — it causes runtime errors (like `PGRST204 column not found`) that are hard to trace. If you find an unapplied migration in `migrations/`, apply it immediately before doing anything else.

---

## Arman's Preferences

- Prefers working through issues systematically, one at a time
- Wants all discovered issues tracked immediately in AGENT_TASKS.md, even mid-conversation
- Values architecture docs staying accurate -- update docs when code changes
- Production-grade only -- no stubs, no TODOs, no placeholder logic
- Keep solutions simple; avoid over-engineering
- Tasks for Arman go in `.arman/ARMAN_TASKS.md` -- keep them simple checkbox items with direct instructions
- Prefers I keep going without stopping until done or stuck
- OK with me creating/editing .env files directly -- just comment out instead of deleting values
