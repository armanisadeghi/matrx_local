# Arman Tasks

_Last updated: 2026-02-21_

---

## Completed

- [x] Copy `desktop/.env.example` to `desktop/.env` with Supabase publishable key
- [x] Ensure OAuth redirect URLs are in Supabase Dashboard
- [x] Ensure Google, GitHub, and Apple providers are enabled
- [x] Copy root `.env.example` to `.env` and set `API_KEY`
- [x] Create root `.env` file with API_KEY, SCRAPER_API_KEY, SCRAPER_SERVER_URL
- [x] Do NOT set `DATABASE_URL` — scraper DB is internal-only, all via REST API
- [x] Add `SUPABASE_JWKS_URL` to scraper server's Coolify env vars
- [x] Push scraper-service changes to main (JWT auth, PyJWT dependency)
- [x] Register matrx_local as OAuth application in Supabase (Client ID: `af37ec97-3e0c-423c-a205-3d6c5adc5645`)
- [x] Install optional Python deps: `uv sync --extra monitoring --extra discovery --extra audio --extra transcription --extra browser`
- [x] Install Playwright Chromium: `uv run playwright install chromium`
- [x] Scheduler persistence implemented — tasks saved to `~/.matrx/scheduled_tasks.json`, restored on startup
- [x] WiFi tool rewritten for macOS 13+ (system_profiler JSON fallback)
- [x] AppleScript permission errors now show actionable fix instructions
- [x] Merge `expand-desktop-tools` → `main` (73 tools live on main)

---

## Active — Do These Now

### 1. GitHub Actions secrets (required for signed releases)

Go to: https://github.com/armanisadeghi/matrx-local/settings/secrets/actions

- [x] Set `TAURI_SIGNING_PRIVATE_KEY` → paste contents of `~/.tauri/matrx-local.key`
- [x] Set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` → value: `matrx-signing-2026`

### 2. Test the new Tools page (73 tools, was 23)

Open the desktop app, go to the Tools page, and try each category:

- [ ] **SystemResources** — should show real CPU/RAM/disk breakdown
- [ ] **BatteryStatus** — Mac Mini has no battery; should return a friendly message
- [ ] **DiskUsage** — should show disk usage for `/`
- [ ] **TopProcesses** — should list top CPU/memory processes
- [ ] **ListProcesses** — try with `{"sort_by": "cpu", "limit": 20}`
- [ ] **LaunchApp** — try `{"application": "Safari"}`
- [ ] **ListWindows** — run with `{}`, should list open windows
- [ ] **AppleScript** — try `{"script": "tell application \"Finder\" to get name of every file of desktop"}`
- [ ] **WatchDirectory** — run with `{"path": "/tmp", "recursive": false}`, note the `watch_id` returned
- [ ] **WatchEvents** — run with the `watch_id` from above to poll for changes
- [ ] **StopWatch** — stop the watcher when done
- [ ] **ScheduleTask** — try `{"name": "test", "tool_name": "SystemResources", "tool_input": {}, "interval_seconds": 30}`
- [ ] **ListScheduled** — should show the task you just created
- [ ] **CancelScheduled** — cancel the task by ID
- [ ] **HeartbeatStatus** — run with `{}`, shows background task health
- [ ] **NetworkInfo** — should show local network interfaces
- [ ] **NetworkScan** — try `{"subnet": "192.168.1.0/24"}` (may be slow)
- [ ] **PortScan** — try `{"host": "127.0.0.1", "ports": "common"}`
- [ ] **TypeText** — ⚠️ needs Accessibility permission in System Settings → Privacy & Security
- [ ] **Hotkey** — ⚠️ same Accessibility permission needed
- [ ] **MouseClick** — ⚠️ same Accessibility permission needed
- [ ] **GetInstalledApps** — run with `{}`, lists all apps in /Applications
- [ ] **WifiNetworks** — lists nearby WiFi networks
- [ ] **BluetoothDevices** — lists paired Bluetooth devices
- [ ] **ImageOCR** — try with a screenshot file: `{"file_path": "/path/to/screenshot.png"}`
- [ ] **PdfExtract** — try with any PDF

### 3. Tools that need extra setup first

- [x] **Audio tools** (RecordAudio, PlayAudio, TranscribeAudio) — ✅ installed
- [x] **Browser Automation tools** (BrowserNavigate, BrowserClick, etc.) — ✅ playwright + Chromium installed

### 4. Permissions to grant on macOS (System Settings → Privacy & Security)

- [ ] **Accessibility** — needed for TypeText, Hotkey, MouseClick, MouseMove, FocusWindow, MoveWindow
- [ ] **Screen Recording** — needed for Screenshot tool working inside sandboxed Tauri app
- [ ] **Microphone** — needed for RecordAudio, TranscribeAudio

---

## Documents & Notes Sync Setup

### 5. Run documents migration in Supabase SQL Editor

- [x] Open Supabase Dashboard → SQL Editor
- [x] Paste and run `migrations/001_documents_schema.sql`
- [x] Verify tables created: `note_folders`, `note_shares`, `note_devices`, `note_directory_mappings`, `note_sync_log`
- [x] Verify columns added to `notes`: `folder_id`, `file_path`, `content_hash`, `sync_version`, `last_device_id`

### 6. Enable Supabase Realtime on document tables

- [x] In Supabase SQL Editor, run:
  ```sql
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notes;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.note_folders;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.note_shares;
  ```

### 7. Add Supabase env vars to root .env

- [x] Add `SUPABASE_URL=https://txzxabzwovsujtloxrus.supabase.co` to root `.env`
- [x] Add `SUPABASE_PUBLISHABLE_KEY=<same value as VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY>` to root `.env`

---

## Local Proxy & Cloud Settings Setup

### 8. Run app instances migration in Supabase SQL Editor

- [x] Open Supabase Dashboard → SQL Editor
- [x] Paste and run `migrations/002_app_instances_settings.sql`
- [x] Verify tables created: `app_instances`, `app_settings`, `app_sync_status`
- [x] Verify RLS policies applied on all three tables

---

## Known Gaps (future work — not urgent)

- [ ] No first-run setup wizard for new users
- [ ] Local scrape results don't sync to cloud
- [ ] No rate limiting on the remote scraper server per user
- [ ] Wake-on-LAN support
- [ ] Smart device control (HomeKit, Google Home, Alexa APIs)
- [x] Device registration with cloud backend — implemented via document sync + app instance registration
- [ ] Reverse tunnel for cloud→local proxy routing

---

## Notes

- **Auth:** Scraper server supports dual auth — API key (existing) AND Supabase JWT (new). Both work.
- **OAuth app:** Client ID `af37ec97-3e0c-423c-a205-3d6c5adc5645`, type `public`
- **Shipping:** desktop users auth via Supabase OAuth → get JWT → JWT works directly on scraper server. No embedded API keys in binary.
- **Tool count:** 73 tools on `main` (was 23 before desktop-tools expansion)
- **Chat UI:** Merged 2026-02-21 — collapsible sidebar, conversation history, tool call rendering
