# Matrx Local -- Task Tracker

> Living document. Every discovered bug, missing feature, or architectural issue gets logged here immediately.
> Check items off as they're resolved. Expand with details as investigation progresses.

---

## Critical / Blocking

- [ ] **Engine lifespan hangs when shell DATABASE_URL leaks in** -- `scraper-service/app/config.py` reads `DATABASE_URL` from environment variables, which takes precedence over the project `.env`. If the user's shell has a `DATABASE_URL` set (e.g. from `~/.env.global`), the scraper engine tries to connect to that remote DB and hangs indefinitely in the lifespan startup. Workaround in `launch.sh`: `unset DATABASE_URL` before starting. Real fix: `app/services/scraper/engine.py` should pass `DATABASE_URL` explicitly from the project config rather than letting pydantic-settings read it from the ambient environment.

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
- [x] **Auth middleware on Python engine** -- Bearer token required on protected routes. Token stored on `request.state` for forwarding.

---

## Settings Page

- [x] **Theme switching** -- `use-theme.ts` hook manages `.dark` class, persists to localStorage, default dark.
- [x] **Settings persisted** -- `lib/settings.ts` with localStorage backend + native/engine sync.
- [x] **Folder buttons wired** -- Open Logs/Data via engine `OpenPath` tool.
- [x] **Restart Engine** -- Proper sidecar stop/start in Tauri mode.
- [x] **Version dynamic** -- App version from `package.json` via Vite define. Engine version from `/` endpoint.
- [x] **Launch on Startup** -- `tauri-plugin-autostart` added. Toggle in Settings syncs to OS via `enable()`/`disable()`.
- [x] **Minimize to Tray** -- Configurable via `set_close_to_tray` Tauri command. Toggle in Settings controls Rust-side behavior.
- [x] **Headless mode / Request delay** -- Engine settings API (`PUT /settings`). Settings synced on change and on startup.

---

## Remote Scraper Integration

- [x] **`remote_client.py` created** -- HTTP client with `Authorization: Bearer` auth + JWT forwarding.
- [x] **`remote_scraper_routes.py` created** -- Proxy routes at `/remote-scraper/*` with auth forwarding.
- [x] **Config updated** -- `SCRAPER_API_KEY` and `SCRAPER_SERVER_URL` in `app/config.py`.
- [x] **JWT auth on server** -- Scraper server validates Supabase JWTs via JWKS.
- [x] **Frontend integration** -- Scraping page has Engine/Browser/Remote toggle. Remote calls `/remote-scraper/scrape`.
- [x] **`api.ts` methods** -- Added `scrapeRemotely()`, `remoteScraperStatus()`, `RemoteScrapeResponse` type.
- [x] **SSE streaming** -- Proxy routes + `stream_sse()` on engine, `streamSSE()` in frontend API, real-time results in Scraping page.
- [ ] **Rate limiting** -- No per-user rate limiting on scraper server yet.

---

## API / Backend Connections

- [x] **Database connection unified** -- Uses `DATABASE_URL` from config.
- [x] **Health endpoint mismatch** -- `sidecar.ts` now uses `/tools/list`.
- [x] **Remote scraper integration** -- Full proxy + JWT forwarding.
- [x] **Dead `/local-scrape/*` code cleaned up** -- Removed `scrapeLocally()`. `getBrowserStatus()` now uses `SystemInfo` tool fallback.
- [x] **`.gitignore` fixed** -- `desktop/src/lib/` was incorrectly ignored by Python `lib/` pattern. Added negation.
- [x] **Engine settings API** -- `PUT /settings` endpoint for headless mode and scrape delay.

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
- [x] **Version dynamic** -- App version from package.json, engine version from API.
- [x] **Dead code cleaned** -- Removed `scrapeLocally()`, cleaned unused imports in Scraping.tsx.

---

## Desktop Tool Expansion (2026-02-20)

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

## Documents & Notes Sync (2026-02-20)

- [x] **Database schema** -- SQL migration for `note_folders`, `note_shares`, `note_devices`, `note_directory_mappings`, `note_sync_log` tables + extensions to `notes` (folder_id, file_path, content_hash, sync_version, last_device_id)
- [x] **Supabase PostgREST client** -- `app/services/documents/supabase_client.py` with full CRUD, versions, shares, devices, mappings, sync log
- [x] **Local file manager** -- `app/services/documents/file_manager.py` for .md file I/O, scanning, conflict storage, directory mapping sync
- [x] **Sync engine** -- `app/services/documents/sync_engine.py` with push/pull, full reconciliation, conflict detection, file watcher integration
- [x] **Document API routes** -- `app/api/document_routes.py` with 25+ endpoints (folders, notes, versions, sync, conflicts, shares, mappings)
- [x] **Document tools** -- ListDocuments, ReadDocument, WriteDocument, SearchDocuments, ListDocumentFolders (5 new tools, 73 total)
- [x] **Documents page** -- Full UI with folder tree, note list, markdown editor (split/edit/preview), toolbar, search
- [x] **Markdown support** -- `react-markdown` + `remark-gfm` for GFM rendering, toolbar with formatting buttons
- [x] **Realtime sync** -- `use-realtime-sync.ts` subscribes to Supabase Realtime on notes/folders tables
- [x] **Version history** -- Right panel with version list and one-click revert
- [x] **Sharing** -- Share dialog with per-user permissions (read/comment/edit/admin) + public link support
- [x] **Directory mappings** -- Map folders to additional local paths, auto-sync on changes
- [x] **Sync status bar** -- Shows connection state, conflict count, watcher status, file count, last sync time
- [ ] **Run SQL migration** -- Arman: run `migrations/001_documents_schema.sql` in Supabase SQL Editor
- [ ] **Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to root .env** -- Needed for engine → Supabase sync
- [ ] **Enable Supabase Realtime** -- Run `ALTER PUBLICATION supabase_realtime ADD TABLE notes, note_folders, note_shares` in Supabase
- [ ] **Prose styling for markdown preview** -- Add `@tailwindcss/typography` for better `.prose` rendering (currently basic)

---

## Local Proxy & Cloud Settings Sync (2026-02-21)

- [x] **HTTP proxy server** -- `app/services/proxy/server.py` — async forward proxy with CONNECT tunneling
- [x] **Proxy API routes** -- `app/api/proxy_routes.py` — start/stop/status/test endpoints
- [x] **Proxy auto-start** -- Proxy starts on engine startup if `proxy_enabled` is true (default)
- [x] **Proxy settings toggle** -- Settings page has enable/disable toggle, status, stats, test button
- [x] **Cloud sync engine** -- `app/services/cloud_sync/settings_sync.py` — bidirectional sync with Supabase
- [x] **Instance manager** -- `app/services/cloud_sync/instance_manager.py` — stable machine ID, system info collection
- [x] **Cloud sync API routes** -- `app/api/cloud_sync_routes.py` — configure, settings CRUD, sync push/pull, heartbeat
- [x] **Multi-instance support** -- `app_instances` table stores multiple installations per user
- [x] **App settings table** -- `app_settings` stores all settings as JSON blob per instance
- [x] **Sync status table** -- `app_sync_status` tracks last sync time, direction, result
- [x] **Supabase migration** -- `migrations/002_app_instances_settings.sql` with RLS policies
- [x] **Frontend API client** -- Added proxy + cloud sync methods to `api.ts`
- [x] **Settings expanded** -- `settings.ts` now includes proxy, theme, and instance name
- [x] **Settings dashboard** -- Enhanced Settings.tsx with Proxy, Cloud Sync, System Info cards
- [x] **Cloud sync on startup** -- `use-engine.ts` configures cloud sync when authenticated
- [x] **Heartbeat** -- 5-minute interval updates `last_seen` in cloud
- [x] **Integration guides** -- `docs/proxy-integration-guide.md` + `docs/proxy-testing-guide.md`
- [ ] **Run SQL migration** -- Arman: run `migrations/002_app_instances_settings.sql` in Supabase SQL Editor

---

## Future Work

- [x] Auto-updater -- `tauri-plugin-updater` + `tauri-plugin-process` wired. Signing keypair generated. Settings UI shows check/install/restart buttons.
- [ ] First-run setup wizard
- [ ] Job queue for cloud-assigned scrape jobs
- [x] Device registration with cloud -- Implemented via document sync + app instance registration
- [ ] Result sync to cloud storage
- [x] SSE streaming support in desktop UI for scrape progress
- [ ] Rate limiting on scraper server
- [ ] No Alembic migration runner (only matters with local DATABASE_URL)
- [ ] GitHub Actions workflow for signed release builds (uses `tauri-action` + signing key)
- [ ] Wake-on-LAN support for remote wake of desktop from mobile
- [ ] Smart device control protocols (HomeKit, Google Home, Alexa APIs)
- [ ] Persistent scheduled tasks across app restarts (serialize to disk)
- [ ] Reverse tunnel for cloud→local proxy routing (allow cloud services to use user's proxy remotely)

---

*Last updated: 2026-02-21*
