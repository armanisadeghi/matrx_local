# Arman Tasks
*Last updated: 2026-02-19*

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

---

## Active — Do These Now

### 1. GitHub Actions secrets (required for signed releases)
Go to: https://github.com/armanisadeghi/matrx-local/settings/secrets/actions

- [ ] Set `TAURI_SIGNING_PRIVATE_KEY` → paste contents of `~/.tauri/matrx-local.key`
- [ ] Set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` → value: `matrx-signing-2026`

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
- [ ] **Audio tools** (RecordAudio, PlayAudio, TranscribeAudio) — run: `uv sync --extra audio` in `/Users/armanisadeghi/Code/matrx-local`
- [ ] **Browser Automation tools** (BrowserNavigate, BrowserClick, etc.) — run: `uv run playwright install chromium`

### 4. Permissions to grant on macOS (System Settings → Privacy & Security)
- [ ] **Accessibility** — needed for TypeText, Hotkey, MouseClick, MouseMove, FocusWindow, MoveWindow
- [ ] **Screen Recording** — needed for Screenshot tool working inside sandboxed Tauri app
- [ ] **Microphone** — needed for RecordAudio, TranscribeAudio

---

## Known Gaps (future work — not urgent)

- [ ] Scheduled tasks don't survive restart (no disk persistence yet)
- [ ] No first-run setup wizard for new users
- [ ] Local scrape results don't sync to cloud
- [ ] No rate limiting on the remote scraper server per user
- [ ] Wake-on-LAN support
- [ ] Smart device control (HomeKit, Google Home, Alexa APIs)
- [ ] Device registration with cloud backend

---

## Notes

- **Auth:** Scraper server supports dual auth — API key (existing) AND Supabase JWT (new). Both work.
- **OAuth app:** Client ID `af37ec97-3e0c-423c-a205-3d6c5adc5645`, type `public`
- **Shipping:** desktop users auth via Supabase OAuth → get JWT → JWT works directly on scraper server. No embedded API keys in binary.
- **Current branch:** `expand-desktop-tools` — merge to `main` after testing
- **Tool count:** 73 tools registered (was 23 before this branch)
