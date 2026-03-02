# Matrx Local -- Task Tracker

> Living document. Every discovered bug, missing feature, or architectural issue gets logged here immediately.
> Check items off as they're resolved. Expand with details as investigation progresses.

---

## 🔴 NEW — Testing Findings (2026-02-21)

> Full QA pass by Arman. Every item below is an open bug or missing feature.

---

### Dashboard

- [ ] **User profile shows "Not Found"** — Profile data is not loading on the dashboard card.
- [ ] **Browser Engine shows "standby"** — Engine status indicator stuck on standby; should reflect actual running state.

---

### Documents

- [ ] **New Folder doesn't work** — Button has no effect; folder is not created locally or in cloud.
- [ ] **New Note doesn't work** — Button has no effect; note is not created.
- [ ] **Sync bar claims "Connected" but does nothing** — 0 files, last sync shows "never". The sync bar is cosmetically connected but has no real backend sync happening.

---

### Scraping

- [ ] **No persistence — scrapes not saved anywhere** — Local scrapes must be saved BOTH to the local SQLite/DB AND to Supabase cloud. Neither is happening.
- [ ] **UX: URL list should be flat, not batched with tabs** — Currently shows strange batch/tab combo. Replace with: flat list of all scraped URLs on the left (regardless of which batch they came from), clicking a URL shows its content on the right. No tab navigation required.
- [ ] **Content panel does not scroll** — The container holding scraped content must have its own independent scroll; long content is clipped.
- [ ] **Auto-prefix URLs with https://** — If a user types `yahoo.com`, automatically prepend `https://` before scraping. Do not reject bare domains.

---

### Tools Page

- [ ] **Tools UI is not user-friendly** — Current UI is developer-only (raw JSON input, etc.). GPT has submitted PR #1 with a redesigned categorized UI. **Pull and review PR #1 (`codex/create-user-friendly-ui-for-tools-tab`).**
- [ ] **Monitoring tools need iOS-style UI** — Tools for system monitoring, battery, disk, etc. should use a beautiful, consumer-facing card/widget UI, not raw tool forms.
- [ ] **Browser control tool: no order/structure + no visible session** — The browser control UI has no clear flow. It should also ideally show a live visual (screenshot) of the current browser state and confirm whether a session is being persisted.
- [ ] **Large text output areas don't scroll** — PDF Extract and other tools that display large text blocks are not scrollable. All output text areas must scroll independently.
- [ ] **Scheduler is fake / no persistence** — ScheduleTask UI accepts input but does NOT persist to DB or local storage. Needs real persistence (DB + local file fallback).
- [ ] **Tool results not shown for action tools** — Tools like "Read Clipboard", "Get Screen State", etc. must display the result in the UI so the user can confirm the tool captured what they expected.
- [ ] **Web search tool: argument errors** — Web search calls fail due to incorrect argument mapping. Fix the argument schema passed to the tool.
- [ ] **Record Audio: broken, gives errors** — Should be a fully functional audio recorder with start/stop/playback. Currently throws errors.
- [ ] **Transcribe Audio: needs live transcription mode** — Two modes needed: (1) from file upload, (2) live microphone with periodic file saves to prevent data loss.
- [ ] **Notify tool: does nothing** — The Notify tool has no visible effect. Should trigger a native OS notification.
- [ ] **Installed Apps: needs persistent list with refresh** — `GetInstalledApps` works but should save the result and display as a persistent sorted list with an explicit "Refresh" button (no auto-refresh on every open).
- [ ] **Path-required tools (ImageOCR, etc.) need a file picker** — Tools that require a file path (ImageOCR, PdfExtract, ArchiveCreate, etc.) must use a native OS file-picker / directory-tree UI, not a raw text input.

---

### Ports

- [x] **"Grace Kill" text is invisible in dark mode** — Fixed 2026-03-02: replaced `bg-white/*` and `bg-black/*` tokens with semantic `bg-muted`/`border-border` throughout Ports.tsx.

---

### Settings — General

- [ ] **Verify "Launch on Startup" actually works** — The toggle sets the OS entry, but has it been confirmed to actually relaunch on login? Needs an end-to-end test.
- [ ] **Verify "Minimize to Tray" actually works** — The Rust command is wired, but needs confirmation the window actually goes to tray and can be reopened.
- [ ] **"Engine" concept needs clarity + reliability** — Settings shows "Engine Port", "Reconnect", "Restart" buttons. Does restarting the engine actually restart the Python sidecar reliably for end users? Needs confirmation + error handling if it fails.

---

### Settings — Proxy

- [ ] **"Test Connection" is fake / misleading** — The button currently returns a local success response. A real test must: (1) call our main Python server at `MAIN_SERVER` (env var, do NOT hardcode), (2) have the server send a SEPARATE, independent request back to this client, (3) only mark as "Connected" after that callback is confirmed. Add `MAIN_SERVER=https://server.appp.matrxserver.com` as a new env variable (never hardcoded).

---

### Settings — Scraping

- [ ] **Verify headless mode actually does something** — The toggle must be confirmed to switch Playwright to `headless=True/False` at runtime.
- [ ] **Add forbidden URL list** — A UI-managed list of URLs that are forbidden from being scraped, even if requested. List must sync to Supabase (per user).

---

### Settings — Cloud Account

- [ ] **Cloud sync broken: 404 on `app_settings` table** — Error: `404 Not Found` for `/rest/v1/app_settings?user_id=...&instance_id=...`. The `app_settings` table (from migration 002) may not exist in production Supabase. Run/verify migration.
  ```
  Sync error: Client error '404 Not Found' for url
  'https://txzxabzwovsujtloxrus.supabase.co/rest/v1/app_settings?user_id=eq.4cf62e4e-...&instance_id=eq.inst_571f36f61346a092f97c6cc31a3ca265&select=*'
  ```
- [x] **User avatar not shown** — Fixed 2026-03-02: expanded Tauri CSP `img-src` to include `lh3.google.com`, `avatars.githubusercontent.com`, and `gravatar.com` for Google/GitHub OAuth avatars.

---

### Settings — About

- [x] **"Open Logs Folder" button doesn't work** — Fixed 2026-03-02: now calls `POST /system/open-folder` with absolute config paths instead of relative OpenPath tool.
- [x] **"Open Data Folder" button doesn't work** — Fixed 2026-03-02: same fix as above.

---

### Global / UI

- [x] **Dark mode color contrast issues (Ports.tsx)** — Fixed 2026-03-02: `bg-white/*`, `bg-black/*`, `border-white/*` replaced with semantic tokens.
- [ ] **Dark mode contrast: audit remaining pages** — Other pages may still have hardcoded light/dark-only colors. Full audit needed.

---

### Missing Features — System Info

- [ ] **No system info UI for end users** — CPU, RAM, disk, battery, etc. are buried in raw JSON tool outputs. Normal users will never find this. Build a proper System Info section (could be a dashboard widget or dedicated page) that shows at minimum: CPU usage, memory usage, disk usage, battery status, and uptime — in a readable, visual format.

---

## Pending / Open

- [ ] **Rate limiting** — No per-user rate limiting on scraper server yet.
- [ ] **Prose markdown styling** — Add `@tailwindcss/typography` for better `.prose` rendering in Documents page (currently basic).
- [ ] **First-run setup wizard**
- [ ] **Job queue for cloud-assigned scrape jobs**
- [ ] **No Alembic migration runner** (only matters if `DATABASE_URL` is set locally)
- [x] **GitHub Actions workflow** — Fixed 2026-03-02: CI builds all 4 platforms, auto-publishes releases (no longer draft), Apple notarization env vars wired. v1.0.0 CI run in progress.
- [ ] **Wake-on-LAN support**
- [ ] **Smart device control protocols** (HomeKit, Google Home, Alexa APIs)
- [ ] **Reverse tunnel** for cloud→local proxy routing

---

## Critical / Blocking ✅

- [x] **Engine lifespan hangs when shell DATABASE_URL leaks in** — Fixed in `engine.py` (lines 191-192): sets `DATABASE_URL=""` via `os.environ.setdefault` if not in project env, preventing shell leakage from blocking scraper startup.
- [x] **Missing `supabase.ts`** -- Created with publishable key pattern (default export).
- [x] **No `.env` file for desktop** -- Created and populated with Supabase URL + publishable key.
- [x] **Hardcoded DB credentials** -- `app/database.py` now uses `DATABASE_URL` from `config.py`.
- [x] **Root `.env` created** -- Contains `API_KEY`, `SCRAPER_API_KEY`, `SCRAPER_SERVER_URL`. Fixed leading whitespace.
- [x] **Supabase client updated** -- Uses publishable key (not deprecated anon key). Default export pattern.
- [x] **Auth header mismatch fixed** -- `remote_client.py` was sending `X-API-Key` but scraper server expects `Authorization: Bearer <token>`.

---

## Auth & Shipping Strategy ✅

- [x] **JWT auth added to scraper server** -- Accepts both API key and Supabase JWT via JWKS (ES256).
- [x] **Shipping strategy decided** -- Supabase OAuth, JWT auth on scraper server, no embedded API keys.
- [x] **Deployed to production** -- Scraper-service pushed to main, `SUPABASE_JWKS_URL` set in Coolify.
- [x] **OAuth app registered** -- Client ID `af37ec97-3e0c-423c-a205-3d6c5adc5645`, type `public`.
- [x] **JWT forwarding** -- Proxy routes forward user's JWT from incoming request to scraper server.
- [x] **Auth middleware on Python engine** -- Bearer token required on protected routes. Token stored on `request.state` for forwarding.

---

## Settings Page ✅

- [x] **Theme switching** -- `use-theme.ts` hook manages `.dark` class, persists to localStorage, default dark.
- [x] **Settings persisted** -- `lib/settings.ts` with localStorage backend + native/engine sync.
- [x] **Folder buttons wired** -- Open Logs/Data via engine `OpenPath` tool.
- [x] **Restart Engine** -- Proper sidecar stop/start in Tauri mode.
- [x] **Version dynamic** -- App version from `package.json` via Vite define. Engine version from `/` endpoint.
- [x] **Launch on Startup** -- `tauri-plugin-autostart` added. Toggle in Settings syncs to OS via `enable()`/`disable()`.
- [x] **Minimize to Tray** -- Configurable via `set_close_to_tray` Tauri command. Toggle in Settings controls Rust-side behavior.
- [x] **Headless mode / Request delay** -- Engine settings API (`PUT /settings`). Settings synced on change and on startup.

---

## Remote Scraper Integration ✅

- [x] **`remote_client.py` created** -- HTTP client with `Authorization: Bearer` auth + JWT forwarding.
- [x] **`remote_scraper_routes.py` created** -- Proxy routes at `/remote-scraper/*` with auth forwarding.
- [x] **Config updated** -- `SCRAPER_API_KEY` and `SCRAPER_SERVER_URL` in `app/config.py`.
- [x] **JWT auth on server** -- Scraper server validates Supabase JWTs via JWKS.
- [x] **Frontend integration** -- Scraping page has Engine/Browser/Remote toggle. Remote calls `/remote-scraper/scrape`.
- [x] **`api.ts` methods** -- Added `scrapeRemotely()`, `remoteScraperStatus()`, `RemoteScrapeResponse` type.
- [x] **SSE streaming** -- Proxy routes + `stream_sse()` on engine, `streamSSE()` in frontend API, real-time results in Scraping page.

---

## API / Backend Connections ✅

- [x] **Database connection unified** -- Uses `DATABASE_URL` from config.
- [x] **Health endpoint mismatch** -- `sidecar.ts` now uses `/tools/list`.
- [x] **Remote scraper integration** -- Full proxy + JWT forwarding.
- [x] **Dead `/local-scrape/*` code cleaned up** -- Removed `scrapeLocally()`. `getBrowserStatus()` now uses `SystemInfo` tool fallback.
- [x] **`.gitignore` fixed** -- `desktop/src/lib/` was incorrectly ignored by Python `lib/` pattern. Added negation.
- [x] **Engine settings API** -- `PUT /settings` endpoint for headless mode and scrape delay.

---

## Database & Sync ✅

- [x] **DB strategy clarified** -- Scraper DB is internal-only. All data via REST API with Bearer auth.
- [x] **No Alembic migration runner** -- Only matters if `DATABASE_URL` is set locally.

---

## Supabase Integration ✅

- [x] **Client file** -- `desktop/src/lib/supabase.ts` with publishable key.
- [x] **Env vars** -- `desktop/.env` populated.
- [x] **Auth hooks** -- `use-auth.ts` and `use-engine.ts` updated to use default import.
- [x] **JWKS info captured** -- Key ID `8a68756f`, ES256, JWKS endpoint documented.
- [x] **OAuth app registered** -- Client ID `af37ec97-3e0c-423c-a205-3d6c5adc5645`.

---

## Code Quality ✅

- [x] **Stale closure fixed** in `use-engine.ts` health check.
- [x] **Error boundary added** -- `ErrorBoundary.tsx` wraps entire app in `App.tsx`.
- [x] **Version dynamic** -- App version from package.json, engine version from API.
- [x] **Dead code cleaned** -- Removed `scrapeLocally()`, cleaned unused imports in Scraping.tsx.

---

## Desktop Tool Expansion ✅ (2026-02-20)

- [x] **Process Management tools** -- ListProcesses, LaunchApp, KillProcess, FocusApp (psutil + fallback)
- [x] **Window Management tools** -- ListWindows, FocusWindow, MoveWindow, MinimizeWindow (AppleScript/PowerShell/wmctrl)
- [x] **Input Automation tools** -- TypeText, Hotkey, MouseClick, MouseMove (AppleScript/PowerShell/xdotool)
- [x] **Audio tools** -- ListAudioDevices, RecordAudio, PlayAudio, TranscribeAudio (sounddevice + Whisper)
- [x] **Browser Automation tools** -- BrowserNavigate, BrowserClick, BrowserType, BrowserExtract, BrowserScreenshot, BrowserEval, BrowserTabs (Playwright)
- [x] **Network Discovery tools** -- NetworkInfo, NetworkScan, PortScan, MDNSDiscover (socket + zeroconf)
- [x] **System Monitoring tools** -- SystemResources, BatteryStatus, DiskUsage, TopProcesses (psutil)
- [x] **File Watch tools** -- WatchDirectory, WatchEvents, StopWatch (watchfiles)
- [x] **OS App Integration tools** -- AppleScript, PowerShellScript, GetInstalledApps
- [x] **Scheduler/Heartbeat tools** -- ScheduleTask, ListScheduled, CancelScheduled, HeartbeatStatus, PreventSleep
- [x] **Media Processing tools** -- ImageOCR, ImageResize, PdfExtract, ArchiveCreate, ArchiveExtract
- [x] **WiFi & Bluetooth tools** -- WifiNetworks, BluetoothDevices, ConnectedDevices
- [x] **Dispatcher updated** -- All 68 tools registered (was 23)
- [x] **Frontend updated** -- Tools page has categories + input templates for all new tools
- [x] **pyproject.toml updated** -- New optional dependency groups: monitoring, discovery, transcription, all
- [x] **Architecture docs updated** -- ARCHITECTURE.md reflects 68 tools

---

## Documents & Notes Sync ✅ (2026-02-20)

- [x] **Database schema** -- SQL migration for `note_folders`, `note_shares`, `note_devices`, `note_directory_mappings`, `note_sync_log` tables + extensions to `notes`
- [x] **Supabase PostgREST client** -- `app/services/documents/supabase_client.py` with full CRUD
- [x] **Local file manager** -- `app/services/documents/file_manager.py`
- [x] **Sync engine** -- `app/services/documents/sync_engine.py` with push/pull, conflict detection, file watcher
- [x] **Document API routes** -- `app/api/document_routes.py` with 25+ endpoints
- [x] **Document tools** -- ListDocuments, ReadDocument, WriteDocument, SearchDocuments, ListDocumentFolders (5 new tools, 73 total)
- [x] **Documents page** -- Full UI with folder tree, note list, markdown editor (split/edit/preview), toolbar, search
- [x] **Realtime sync** -- `use-realtime-sync.ts` subscribes to Supabase Realtime on notes/folders tables
- [x] **Version history** -- Right panel with version list and one-click revert
- [x] **Sharing** -- Share dialog with per-user permissions + public link support
- [x] **Sync status bar** -- Shows connection state, conflict count, watcher status, file count, last sync time
- [x] **Run SQL migration** -- `migrations/001_documents_schema.sql` run in Supabase ✓
- [x] **Enable Supabase Realtime** -- `notes`, `note_folders`, `note_shares` added to publication ✓

---

## Chat UI with Sidebar ✅ (2026-02-21)

- [x] **Chat page** -- `desktop/src/pages/Chat.tsx` with full chat layout
- [x] **Chat components** -- `ChatInput`, `ChatMessages`, `ChatSidebar`, `ChatToolCall`, `ChatWelcome`
- [x] **Chat hook** -- `use-chat.ts` with message state, streaming, conversation management
- [x] **Tool schema system** -- `app/tools/tool_schemas.py` — structured tool definitions for AI
- [x] **Chat API routes** -- `app/api/chat_routes.py` for backend chat endpoints
- [x] **Collapsible sidebar** -- Conversation history sidebar with collapse/expand

---

## Local Proxy & Cloud Settings Sync ✅ (2026-02-21)

- [x] **HTTP proxy server** -- `app/services/proxy/server.py` — async forward proxy with CONNECT tunneling
- [x] **Proxy API routes** -- `app/api/proxy_routes.py` — start/stop/status/test endpoints
- [x] **Proxy auto-start** -- Proxy starts on engine startup if `proxy_enabled` is true
- [x] **Proxy settings toggle** -- Settings page has enable/disable toggle, status, stats, test button
- [x] **Cloud sync engine** -- `app/services/cloud_sync/settings_sync.py` — bidirectional sync with Supabase
- [x] **Instance manager** -- `app/services/cloud_sync/instance_manager.py` — stable machine ID, system info collection
- [x] **Cloud sync API routes** -- `app/api/cloud_sync_routes.py` — configure, settings CRUD, sync push/pull, heartbeat
- [x] **Supabase migration** -- `migrations/002_app_instances_settings.sql` with RLS policies
- [x] **Cloud sync on startup** -- `use-engine.ts` configures cloud sync when authenticated
- [x] **Heartbeat** -- 5-minute interval updates `last_seen` in cloud
- [x] **Run SQL migration** -- `migrations/002_app_instances_settings.sql` run in Supabase ✓

---

## Activity Log & Real-Time Monitoring ✅ (2026-02-22)

- [x] **Structured access logger** — `app/common/access_log.py` — JSON-line file (`system/logs/access.log`), 500-entry in-memory ring buffer, SSE subscriber queues
- [x] **Fixed `GET /logs` path bug** — was `"logs/system.log"` (always 404), now uses `Path(LOG_DIR)/"system.log"` from config
- [x] **`GET /logs/access`** — last-N structured access entries as JSON (`?n=100`, max 500)
- [x] **`GET /logs/stream`** — SSE that tails `system.log` in real time
- [x] **`GET /logs/access/stream`** — SSE live-push of structured access entries; keepalive every 15 s
- [x] **Auth `?token=` fallback** — `AuthMiddleware` now accepts token via query param for SSE (`EventSource` cannot set headers)
- [x] **`Activity.tsx` replaced** — two-tab real-time viewer: "HTTP Requests" (structured, filterable, stats bar) + "System Log" (color-coded raw tail)
- [x] **Sidebar** — "Activity" nav item added (`Radio` icon, between Tools and Ports)
- [x] **Integration doc** — `docs/activity-log.md` — full API reference + ready-made React hook for aimatrx.com

> **For aimatrx.com team:** see `docs/activity-log.md` for the SSE stream endpoint, React hook, and cURL examples.

---

_Last updated: 2026-02-22_
