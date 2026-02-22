# Arman Tasks

_Last updated: 2026-02-21_

---

## 🔴 Active — Do These Now

> All findings from the 2026-02-21 QA pass are logged in detail in `TASKS.md` under "NEW — Testing Findings". Pull the GPT PR first, then work through the list below.

### Pull & Review GPT PR

- [ ] **Pull PR #1** (`codex/create-user-friendly-ui-for-tools-tab`) — Redesigned Tools page UI

### macOS Permissions (System Settings → Privacy & Security)

- [ ] **Accessibility** — for TypeText, Hotkey, MouseClick, MouseMove, FocusWindow, MoveWindow
- [ ] **Screen Recording** — for Screenshot tool in sandboxed Tauri app
- [ ] **Microphone** — for RecordAudio, TranscribeAudio

### Bugs to Fix (from QA — full details in TASKS.md)

- [ ] Dashboard: User profile "Not Found" + Engine shows "standby"
- [ ] Documents: New Folder / New Note broken; sync bar is cosmetic
- [ ] Scraping: No persistence (must save to local DB + Supabase); UX overhaul (flat URL list, scrollable content, auto-https prefix)
- [ ] Tools: Scheduler is fake; audio recorder broken; notify does nothing; web search args wrong; output areas don't scroll; no file picker for path inputs; Installed Apps needs persistent list
- [ ] Ports: "Grace Kill" dark red on black — fix contrast
- [ ] Settings → General: Confirm launch-on-startup + minimize-to-tray actually work end-to-end
- [ ] Settings → Proxy: "Test Connection" is fake — needs real server roundtrip callback; add `MAIN_SERVER` env var
- [ ] Settings → Scraping: Verify headless mode works; add forbidden URL list (synced to Supabase)
- [ ] Settings → Cloud Account: 404 on `app_settings` — verify migration 002 is applied; fix missing user avatar
- [ ] Settings → About: "Open Logs Folder" + "Open Data Folder" buttons broken
- [ ] Global: Dark mode color contrast audit across all components
- [ ] Missing feature: System Info UI (CPU, RAM, disk, battery) for normal users

---

## Known Gaps (future work — not urgent)

- [ ] No first-run setup wizard for new users
- [ ] No rate limiting on the remote scraper server per user
- [ ] Wake-on-LAN support
- [ ] Smart device control (HomeKit, Google Home, Alexa APIs)
- [ ] Reverse tunnel for cloud→local proxy routing
- [ ] Prose markdown styling (`@tailwindcss/typography`) in Documents page
- [ ] GitHub Actions signed release build workflow
- [ ] Job queue for cloud-assigned scrape jobs

---

## Notes

- **Auth:** Scraper server supports dual auth — API key AND Supabase JWT. Both work.
- **OAuth app:** Client ID `af37ec97-3e0c-423c-a205-3d6c5adc5645`, type `public`
- **Shipping:** Users auth via Supabase OAuth → JWT works directly on scraper server. No embedded API keys in binary.
- **Tool count:** 73 tools on `main`
- **Chat UI:** Merged 2026-02-21 — collapsible sidebar, conversation history, tool call rendering
- **GPT PR #1:** `codex/create-user-friendly-ui-for-tools-tab` — Tools page redesign, created ~45 min before QA notes

---

## ✅ Completed

- [x] Full QA pass completed 2026-02-21 — all findings documented in `TASKS.md`
- [x] Copy `desktop/.env.example` → `desktop/.env` with Supabase publishable key
- [x] OAuth redirect URLs in Supabase Dashboard; Google, GitHub, Apple providers enabled
- [x] Root `.env` created with `API_KEY`, `SCRAPER_API_KEY`, `SCRAPER_SERVER_URL`
- [x] `SUPABASE_JWKS_URL` set in Coolify; scraper-service JWT auth pushed to main
- [x] OAuth app registered (Client ID: `af37ec97-3e0c-423c-a205-3d6c5adc5645`)
- [x] `uv sync --extra all` run; Playwright Chromium installed
- [x] Scheduler persistence, WiFi tool macOS 13+ rewrite, AppleScript permission messages
- [x] Merged `expand-desktop-tools` → `main` (73 tools)
- [x] GitHub Actions secrets set (`TAURI_SIGNING_PRIVATE_KEY` + password)
- [x] `migrations/001_documents_schema.sql` run in Supabase ✓
- [x] `migrations/002_app_instances_settings.sql` run in Supabase ✓
- [x] Supabase Realtime enabled on `notes`, `note_folders`, `note_shares`
- [x] `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` added to root `.env`
- [x] Device registration with cloud backend — implemented via app instance registration
- [x] Smoke-tested individual tool categories (SystemResources, TopProcesses, ListProcesses, GetInstalledApps, PortScan, NetworkInfo, etc.) — full findings logged in TASKS.md
