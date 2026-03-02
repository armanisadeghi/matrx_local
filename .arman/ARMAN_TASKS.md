# Arman Tasks

_Last updated: 2026-03-02_

---

## 🔴 Active — Do These Now (in order)

---

### 1. Release v1.0.1
- [x] v1.0.1 CI triggered — https://github.com/armanisadeghi/matrx-local/actions
- For future releases, see [HOWTO.md → Releasing](HOWTO.md#releasing)

---

### 2. Code Signing Certificates (before shipping to public)
- [ ] **Apple Developer account** — enroll + add secrets to GitHub Actions. **STATUS**: NONE
  - See [HOWTO.md → Apple Developer Setup](HOWTO.md#apple-developer-setup)
- [ ] **Windows EV code signing cert** — **STATUS**: Cert purchased, shipping takes a few days
  - See [HOWTO.md → Windows Code Signing](HOWTO.md#windows-code-signing)

---

### 3. Manual Verification (only you can test on your hardware)

#### macOS
- [ ] Test DMG install — download from GitHub Release, drag to Apps, launch, check Gatekeeper. **STATUS**: NONE
- [ ] Launch on Startup — toggle in Settings → General, log out/in, confirm auto-launch. **STATUS**: NONE
- [ ] Minimize to Tray — toggle in Settings → General, close window, confirm tray icon. **STATUS**: NONE
- [ ] macOS Permissions — grant Accessibility, Screen Recording, Microphone
  - See [HOWTO.md → macOS Permissions](HOWTO.md#macos-permissions). **STATUS**: NONE
- [ ] User avatar — sign in with Google/GitHub, check Settings → Cloud & Account
- [ ] Headless mode — toggle off in Settings → Scraping, run a scrape, confirm Chromium window opens

#### Windows
- [ ] Test MSI install — download from GitHub Release, install, check SmartScreen. **STATUS**: NONE
- [ ] Launch on Startup — same as macOS test. **STATUS**: NONE

#### Linux
- [ ] Test .deb or .AppImage — download from GitHub Release, install/run. **STATUS**: NONE

---

### 4. Cloud Sync Verification
- [ ] Verify `app_settings` table exists in Supabase
  - See [HOWTO.md → Cloud Sync Verification](HOWTO.md#app_settings-table)
- [ ] Verify `note_folders` table + RLS (Documents "New Folder" broken)
  - See [HOWTO.md → Cloud Sync Verification](HOWTO.md#note_folders-table-documents-new-folder-broken)
- [ ] Add `BRAVE_API_KEY` to `.env` for web search
  - See [HOWTO.md → Cloud Sync Verification](HOWTO.md#brave_api_key-for-web-search)
- [ ] Confirm Proxy "Test Connection" server URL — tell the agent the correct URL
- [x] Run migration 003 — Done by agent via MCP 2026-03-02

---

### 5. Testing Flow
- See [HOWTO.md → Testing Locally](HOWTO.md#testing-locally) for all commands

---

### 6. Agent Fix Verification (confirm fixes worked)
- [x] Dashboard: User profile card added
- [x] Dashboard: Browser Engine label fixed
- [ ] Documents: New Folder / New Note — need Supabase table verification (see section 4)
- [x] Documents: Sync bar shows + sync button works
- [x] Scraping: UX overhauled — flat URL list, scroll, auto-prefix
- [x] Scraping: localStorage history (100 entries) with History tab
- [x] Notify tool: dispatches via osascript/PowerShell/notify-send
- [x] Record Audio: better device-not-found errors
- [x] Web search: argument mapping correct — needs BRAVE_API_KEY (see section 4)
- [x] System Info UI: live CPU/RAM/Disk/Battery gauges
- [x] Dark mode contrast: clean
- [ ] Settings → Proxy: "Test Connection" still fake (need server URL)
- [x] Settings → Scraping: Forbidden URL list implemented
- [x] Migration 003: `forbidden_urls` table created with RLS
- [x] Installed Apps: persistent list with refresh

---

## Known Gaps (future work — not urgent)

- [ ] First-run setup wizard for new users
- [ ] Rate limiting on remote scraper server per user
- [ ] Wake-on-LAN support
- [ ] Smart device control (HomeKit, Google Home, Alexa APIs)
- [ ] Reverse tunnel for cloud→local proxy routing
- [ ] Job queue for cloud-assigned scrape jobs
- [ ] Windows EV code signing cert (for SmartScreen — when going public)

---

## Notes

- **Auth:** Scraper server supports dual auth — API key AND Supabase JWT
- **OAuth app:** Client ID `af37ec97-3e0c-423c-a205-3d6c5adc5645`, type `public`
- **Shipping:** Users auth via Supabase OAuth → JWT works on scraper server. No embedded API keys
- **Tool count:** 79 tools on `main` (62 in LOCAL_TOOL_MANIFEST for cloud sync)
- **Chat UI:** Merged 2026-02-21 — collapsible sidebar, conversation history, tool call rendering
- **GPT PR #1:** `codex/create-user-friendly-ui-for-tools-tab` — Tools page redesign

---

## ✅ Completed

### Recently (2026-03-02)

- [x] Ports Grace Kill contrast — semantic tokens in Ports.tsx
- [x] Open Logs / Open Data Folder — uses `POST /system/open-folder`
- [x] User avatar CSP — `img-src` expanded for Google/GitHub/Gravatar
- [x] Prose markdown — `@tailwindcss/typography` installed, NoteEditor uses prose classes
- [x] GitHub Actions — `release.yml` builds 4 platforms with notarization wired
- [x] v1.0.0 tag pushed — CI build triggered, version synced everywhere
- [x] Capabilities tab — Settings → Capabilities shows status + Install buttons
- [x] stop.sh created — kills all Matrx processes and frees ports

### Earlier

- [x] Full QA pass completed 2026-02-21
- [x] Copy `desktop/.env.example` → `desktop/.env` with Supabase key
- [x] OAuth redirect URLs + providers enabled in Supabase
- [x] Root `.env` created with API keys
- [x] `SUPABASE_JWKS_URL` set in Coolify; JWT auth pushed to main
- [x] OAuth app registered
- [x] `uv sync --extra all` run; Playwright Chromium installed
- [x] Scheduler persistence, WiFi tool rewrite, AppleScript permission messages
- [x] Merged `expand-desktop-tools` → `main` (79 tools)
- [x] GitHub Actions secrets set
- [x] Migrations 001 & 002 run in Supabase
- [x] Supabase Realtime enabled on notes tables
- [x] Supabase env vars added to root `.env`
- [x] Device registration implemented
- [x] Smoke-tested individual tool categories
