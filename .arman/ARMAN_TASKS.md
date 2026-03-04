# Arman Tasks — Matrx Local

_Last updated: 2026-03-02_

> Items that require Arman's manual action or decision. reference [HOWTO.md](HOWTO.md) for procedures.

---

## 🔴 ACTIVE — Priority Actions

### 1. Shipping & Certificates
- [ ] **Enroll in Apple Developer** — Enable notarization. [HOWTO.md → Apple Setup](HOWTO.md#apple-developer-setup)
- [ ] **Windows EV Cert** — Complete verification when token arrives. [HOWTO.md → Windows Signing](HOWTO.md#windows-code-signing)

### 2. Manual Verification (Hardware)
- [ ] **macOS / Windows / Linux** — Download releases, install, and confirm launch. [HOWTO.md → Releasing](HOWTO.md#releasing)
- [ ] **Permissions** — Grant OS permissions (Screen, Mic, etc.). [HOWTO.md → macOS Permissions](HOWTO.md#macos-permissions)
- [ ] **UI Toggles** — Test Launch on Startup, Minimize to Tray, and Headless Scraping in Settings.

### 3. Remote Access / Tunnel
- [ ] **Run cloudflared download script** — Before next release build, run `./scripts/download-cloudflared.sh --current` to place the cloudflared binary in `desktop/src-tauri/sidecar/` for your platform. CI should run `./scripts/download-cloudflared.sh` (all platforms) before `tauri build`.
- [ ] **Remove personal named tunnel** (optional) — Delete the `matrx-local` tunnel from [Cloudflare dashboard](https://one.dash.cloudflare.com/). Uninstall the system service: `sudo launchctl unload /Library/LaunchDaemons/com.cloudflare.cloudflared.plist && sudo rm /Library/LaunchDaemons/com.cloudflare.cloudflared.plist`.

### 4. Supabase & Cloud Config
- [ ] **Verify `app_settings` Table** — Check RLS and existence. [HOWTO.md → Cloud Sync](HOWTO.md#app_settings-table)
- [ ] **Verify `note_folders` Table** — "New Folder" failing suggests RLS/Table issue. [HOWTO.md → Cloud Sync](HOWTO.md#note_folders-table)
- [ ] **Add `BRAVE_API_KEY` to `.env`** — Required for web search. [HOWTO.md → Cloud Sync](HOWTO.md#brave_api_key-for-web-search)
- [ ] **Confirm `MAIN_SERVER` URL** — Needed for real Proxy "Test Connection" implementation.

---

## 🟡 FUTURE — Gaps (Not Urgent)
- [ ] **First-run wizard** for new users.
- [ ] **Rate limiting** on remote scraper server per user.
- [ ] **Wake-on-LAN support** for remote wake.
- [ ] **Smart device protocols** (HomeKit, Google Home, Alexa).
- [ ] **Reverse tunnel** for cloud→local proxy routing.

---

## ✅ COMPLETED (Recently)
- [x] Run migration 003 (`forbidden_urls`) to enable cloud sync for URL filtering.
- [x] Fixed 401 Unauthorized on web→local API calls.
- [x] Dashboard: Added user profile card and live resource gauges.
- [x] Scraping: Overhauled UX with flat list, history tab, and auto-prefixing.
- [x] Activity Log: Implemented real-time HTTP and system log streaming.
- [x] CI/CD: Wired GitHub Actions for 4-platform builds and releases.
- [x] Documents: Wired sync bar to real trigger; verified backend/frontend logic.
- [x] Settings: Implemented forbidden URL list, launch on startup, and tray minimize.
- [x] Auto-updater: Wired `tauri-plugin-updater` and generated signing key.