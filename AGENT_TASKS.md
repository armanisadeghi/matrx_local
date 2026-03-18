# Matrx Local -- Task Tracker

> Living document. Every discovered bug, missing feature, or architectural issue gets logged here immediately.
> Check items off as they're resolved. Expand with details as investigation progresses.

---

## 🔴 AGENT PRIORITY QUEUE (updated 2026-03-02)

> Pick tasks from top to bottom. Each is self-contained. Do not start a task that depends on an unresolved one above it.

### P0 — Fix broken core features (ship blockers)

1. [x] **Dashboard: User profile "Not Found"** — Fixed 2026-03-02: Added user profile card to Dashboard.tsx with avatar, name, email, provider. `auth.user` and `auth.signOut` now passed from App.tsx.
2. [x] **Dashboard: Browser Engine "standby"** — Fixed 2026-03-02: Label now shows "Not Installed" (not "Not Found") and install instruction `uv sync --extra browser`. Status uses `playwright_available` from SystemInfo tool.
3. **Documents: New Folder / New Note do nothing** — Code trace complete: handlers are correctly wired. Silence suggests Supabase `note_folders` table RLS issue or table missing. Arman must verify in Supabase dashboard (see ARMAN_TASKS). SyncStatusBar now shows even when status is null.
4. [x] **Documents: Sync bar is cosmetic** — Fixed 2026-03-02: `SyncStatusBar` now always renders (shows "Not configured" placeholder instead of null). Sync button triggers real `triggerSync()` call.
5. [x] **Web search tool: argument errors** — Investigated 2026-03-02: argument mapping is correct (`keywords: list[str]` → `tags` field type). Root cause is `BRAVE_API_KEY` not configured. Add `BRAVE_API_KEY=<key>` to `.env` to enable. Not a code bug.
6. [x] **Notify tool: does nothing** — Fixed 2026-03-02: `notify.py` now has platform-specific fallbacks: macOS (osascript), Windows (PowerShell toast), Linux (notify-send), last resort (log). No longer requires `plyer`.
7. [x] **Record Audio: broken** — Improved 2026-03-02: Better error messages for device-not-found errors (PortAudio errors), including troubleshooting steps for macOS/WSL. Core issue is WSL has no audio device by default.

### P1 — UX improvements (needed before public beta)

8. [x] **Scraping UX overhaul** — Fixed 2026-03-02: Complete rewrite of `Scraping.tsx`. Now: flat URL list on left, independent scrollable content panel on right, `normalizeUrl()` auto-prefixes bare domains with `https://`.
9. [x] **Tool output areas scroll** — Verified 2026-03-02: `ToolOutput.tsx` uses `ScrollArea` with `max-h-[400px]`. `OutputCard.tsx` uses `overflow-auto` with configurable `maxHeight`. Already working.
10. [x] **Tool results shown for action tools** — Fixed 2026-03-02: `ClipboardPanel.tsx` now shows error results (red border + message) in addition to success content.
11. [x] **File picker for path-required tools** — Already implemented: `FilePathField.tsx` uses `@tauri-apps/plugin-dialog` with graceful browser fallback.
12. [x] **Installed Apps: persistent list** — Already implemented: `InstalledAppsPanel.tsx` uses `CACHE_KEY = "matrx:installed-apps"`, loads from localStorage on mount, shows "Showing cached results. Click Refresh to reload." banner, and has an explicit "Refresh" button.

### P2 — Features (important, not blocking)

13. [x] **Dark mode contrast audit** — Verified 2026-03-02: pages/ have no hardcoded `bg-white`/`bg-black`. Dialog overlays in `bg-black/50` are intentional semi-transparent overlays. Clean.
14. [x] **System Info UI** — Fixed 2026-03-02: Added `ResourceGauge` widget cards to Dashboard showing live CPU%, RAM used/total, Disk used/total, Battery% (with 10s auto-refresh). Uses `SystemResources` tool.
15. **Scraping persistence** — Still needed. Save completed scrapes to Supabase `scrapes` table.
16. [x] **Scheduler real persistence** — Already implemented: `scheduler.py` persists to `~/.matrx/scheduled_tasks.json` and restores on startup via `restore_scheduled_tasks()` in `main.py`.
17. **Proxy Test Connection** — Waiting on Arman to confirm `MAIN_SERVER` URL.
18. **Forbidden URL list** — Still needed. UI + Supabase `forbidden_urls` table.
19. [x] **Transcribe Audio: live mode** — Fixed 2026-03-02: `AudioMediaPanel.tsx` now has two sub-tabs: "Live Mic" (record → auto-transcribe, or record-only + manual transcribe) and "From File" (path input + transcribe). Duration selector (15s/30s/1m/2m), Whisper model selector (tiny/base/small), error display. Result routing via `lastToolRef` prevents cross-tool contamination.
20. [x] **Browser control UI** — Fixed 2026-03-02: Complete rewrite of `BrowserPanel.tsx`. Now has: (1) Automation tab with ordered step builder (navigate/click/type/extract/screenshot/eval) with add/remove/reorder, run-all with per-step status icons (pending/running/done/error), and inline output; (2) Auto-screenshot toggle captures page after each step; (3) Session indicator (green dot when active, tab count); (4) Live Page View shows latest screenshot with manual refresh; (5) Quick Nav and Console tabs preserved.

### P3 — Polish (nice to have)

21. **First-run wizard** — On first launch (no settings file), show a wizard: Sign in → Engine health → optional capabilities install → done.
23. [x] **Noisy Ctrl-C shutdown** — Fixed 2026-03-18: `ScraperEngine.stop()` now suppresses the `scraper_app.core.fetcher.browser_pool` logger during teardown (level→CRITICAL) and wraps the call in `asyncio.wait_for(timeout=5.0)`. The "Connection closed while reading from the driver" tracebacks were expected — Playwright's driver subprocess is killed by SIGINT before `browser.close()` is called. Also fixed a typo in `local_tool_bridge.py` where `self._on_conversation_end` (private, doesn't exist) was registered instead of `self.on_conversation_end`.
22. [x] **Monitoring tools iOS-style UI** — Fully done: `MonitoringPanel.tsx` has `GaugeRing` + `Sparkline` components with 3s auto-refresh, CPU/Memory/Disk/Battery gauges, sparkline history, stats row, and a full process table with kill buttons. Dashboard also has live gauges (10s refresh).

---

## 🔴 NEW — Testing Findings (2026-02-21)

> Full QA pass by Arman. Every item below is an open bug or missing feature.

---

### Dashboard

- [x] **User profile shows "Not Found"** — Fixed 2026-03-02: Added profile card with avatar, name, email, provider, sign-out button.
- [x] **Browser Engine shows "standby"** — Fixed 2026-03-02: Now shows "Not Installed" + `uv sync --extra browser` hint when Playwright unavailable.

---

### Documents

- [ ] **New Folder doesn't work** — Code is correctly wired. Likely Supabase RLS issue on `note_folders` table. Arman: verify table exists and RLS allows inserts.
- [ ] **New Note doesn't work** — Same as above.
- [x] **Sync bar claims "Connected" but does nothing** — Fixed 2026-03-02: `SyncStatusBar` always renders now (with "Not configured" placeholder). Sync button triggers real sync.

---

### Scraping

- [ ] **No persistence — scrapes not saved anywhere** — Still open. Add Supabase `scrapes` table + migration.
- [x] **UX: URL list should be flat, not batched with tabs** — Fixed 2026-03-02: Complete rewrite. Flat URL list left, content panel right, no tabs.
- [x] **Content panel does not scroll** — Fixed 2026-03-02: Content panel now has `overflow-auto` with independent scroll.
- [x] **Auto-prefix URLs with https://** — Fixed 2026-03-02: `normalizeUrl()` in Scraping.tsx auto-prefixes bare domains.

---

### Tools Page

- [ ] **Tools UI is not user-friendly** — PR #1 (`codex/create-user-friendly-ui-for-tools-tab`) exists. Pull and review.
- [x] **Monitoring tools need iOS-style UI** — `MonitoringPanel.tsx` has `GaugeRing` + `Sparkline` components, 3s live refresh, process table with kill buttons. Fully done.
- [x] **Browser control tool: no order/structure + no visible session** — Done: step builder with status icons, session indicator, auto-screenshot, live page view.
- [x] **Large text output areas don't scroll** — Verified: `ToolOutput` uses `ScrollArea(max-h-400)`, `OutputCard` uses `overflow-auto`. Already working.
- [x] **Scheduler is fake / no persistence** — Already implemented: persists to `~/.matrx/scheduled_tasks.json`.
- [x] **Tool results not shown for action tools** — Fixed 2026-03-02: ClipboardPanel shows error results. Other panels already showed results.
- [x] **Web search tool: argument errors** — Investigated: argument mapping correct. Root cause: `BRAVE_API_KEY` not set in `.env`. Add it to enable.
- [x] **Record Audio: broken, gives errors** — Improved 2026-03-02: Better error messages. Core issue: no audio device in WSL/headless. Works on macOS/Windows with sounddevice installed.
- [x] **Transcribe Audio: needs live transcription mode** — Done: two tabs (Live Mic + From File), auto-transcribe on stop, model selector, duration selector.
- [x] **Notify tool: does nothing** — Fixed 2026-03-02: platform-specific fallbacks (osascript/PowerShell/notify-send/log).
- [ ] **Installed Apps: needs persistent list with refresh** — Still open.
- [x] **Path-required tools (ImageOCR, etc.) need a file picker** — Already implemented: `FilePathField.tsx` uses Tauri dialog with browser fallback.

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

- [ ] **"Test Connection" is fake / misleading** — The button currently returns a local success response. A real test must: (1) call our main Python server at `MAIN_SERVER` (env var, do NOT hardcode), (2) have the server send a SEPARATE, independent request back to this client, (3) only mark as "Connected" after that callback is confirmed. Add `MAIN_SERVER` env var (e.g. `https://server.app.matrxserver.com` — Arman to confirm correct URL).

---

### Settings — Scraping

- [ ] **Verify headless mode actually does something** — The toggle must be confirmed to switch Playwright to `headless=True/False` at runtime.
- [ ] **Add forbidden URL list** — A UI-managed list of URLs that are forbidden from being scraped, even if requested. List must sync to Supabase (per user).

---

### Settings — Cloud Account

- [ ] **Cloud sync broken: 404 on `app_settings` table** — Error: `404 Not Found` for `/rest/v1/app_settings`. Migration 002 is marked run in ARMAN_TASKS. If 404 persists: **Arman task** — verify in Supabase SQL Editor that `app_settings` exists and RLS allows `auth.uid() = user_id`. Possible causes: migration run on different project, RLS blocking, wrong URL.
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
- [x] **Prose markdown styling** — `@tailwindcss/typography` installed; NoteEditor uses `prose prose-sm dark:prose-invert` (verified 2026-03-02).
- [ ] **First-run setup wizard**
- [ ] **Job queue for cloud-assigned scrape jobs**
- [ ] **No Alembic migration runner** (only matters if `DATABASE_URL` is set locally)
- [x] **GitHub Actions workflow** — Fixed 2026-03-02: CI builds all 4 platforms, auto-publishes releases (no longer draft), Apple notarization env vars wired. v1.0.0 CI run failed; v1.0.1 fix: changed `--all-extras` → `--extra all` (avoids pyaudio/portaudio.h), added Windows venv path detection in `build-sidecar.sh`.
- [ ] **Wake-on-LAN support**
- [ ] **Smart device control protocols** (HomeKit, Google Home, Alexa APIs)
- [ ] **Reverse tunnel** for cloud→local proxy routing

---

## Investigation / Verification (unconfirmed from code review)

> Tasks for Arman or a specialized agent when code review cannot confirm status.

- [ ] **Cloud sync 404** — ARMAN: In Supabase SQL Editor, run `SELECT * FROM app_settings LIMIT 1`. If table missing, run migration 002. If table exists, check RLS allows `auth.uid() = user_id`.
- [ ] **Launch on Startup** — ARMAN: Toggle on, quit app, log in to OS again. Confirm app auto-starts.
- [ ] **Minimize to Tray** — ARMAN: Toggle on, click window close. Confirm window minimizes to tray (not quits). Reopen from tray.
- [ ] **Proxy Test Connection** — ARMAN: Confirm correct `MAIN_SERVER` URL before implementing real roundtrip test.
- [ ] **Dashboard "User profile Not Found"** — AGENT: Trace where profile data is fetched; identify why it returns Not Found.
- [ ] **Documents New Folder / New Note** — AGENT: Trace button handlers; identify why they have no effect.

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
- [x] **Dispatcher updated** -- 79 tools registered (dispatcher); LOCAL_TOOL_MANIFEST has 62 for cloud sync
- [x] **Frontend updated** -- Tools page has categories + input templates for all new tools
- [x] **pyproject.toml updated** -- New optional dependency groups: monitoring, discovery, transcription, all
- [x] **Architecture docs updated** -- ARCHITECTURE.md reflects tool count

---

## Documents & Notes Sync ✅ (2026-02-20)

- [x] **Database schema** -- SQL migration for `note_folders`, `note_shares`, `note_devices`, `note_directory_mappings`, `note_sync_log` tables + extensions to `notes`
- [x] **Supabase PostgREST client** -- `app/services/documents/supabase_client.py` with full CRUD
- [x] **Local file manager** -- `app/services/documents/file_manager.py`
- [x] **Sync engine** -- `app/services/documents/sync_engine.py` with push/pull, conflict detection, file watcher
- [x] **Document API routes** -- `app/api/document_routes.py` with 25+ endpoints
- [x] **Document tools** -- ListDocuments, ReadDocument, WriteDocument, SearchDocuments, ListDocumentFolders (5 new tools, 79 total in dispatcher)
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

_Last updated: 2026-03-02 (priority queue added)_
