# Arman Tasks — Matrx Local

_Last updated: 2026-03-02_

> Items that require Arman's manual action or decision. reference [HOWTO.md](HOWTO.md) for procedures.

---

## 🔴 ACTIVE — Priority Actions

### 1. Shipping & Certificates
- [ ] **Enroll in Apple Developer** — Enable notarization. [HOWTO.md → Apple Setup](HOWTO.md#apple-developer-setup)
- [ ] **Windows EV Cert** — Complete verification when token arrives. [HOWTO.md → Windows Signing](HOWTO.md#windows-code-signing)

### 2. Local LLM (llama-server)
- [ ] **Download llama-server binaries** — Go to `https://github.com/ggml-org/llama.cpp/releases/latest`, download the correct binary for each platform, rename and place in `desktop/src-tauri/binaries/`:
  - macOS ARM: `llama-server-aarch64-apple-darwin`
  - macOS Intel: `llama-server-x86_64-apple-darwin`
  - Windows: `llama-server-x86_64-pc-windows-msvc.exe`
  - Linux: `llama-server-x86_64-unknown-linux-gnu`
- [ ] **Test quick setup flow** — Open the app, go to Local Models tab, click Quick Setup, verify model downloads and server starts.
- [ ] **Mirror GGUF models to CDN** — Upload model files to `assets.aimatrx.com/llm-models/` for production use.
- [ ] **Mirror llama-server binaries to CDN** — Upload to `assets.aimatrx.com/llama-server/` for auto-download.

### 3. Manual Verification (Hardware)
- [ ] **macOS / Windows / Linux** — Download releases, install, and confirm launch. [HOWTO.md → Releasing](HOWTO.md#releasing)
- [ ] **Permissions** — Grant OS permissions (Screen, Mic, etc.). [HOWTO.md → macOS Permissions](HOWTO.md#macos-permissions)
- [ ] **UI Toggles** — Test Launch on Startup, Minimize to Tray, and Headless Scraping in Settings.

### 3. Remote Access / Tunnel
- [ ] **Run cloudflared download script** — Before next release build, run `./scripts/download-cloudflared.sh --current` to place the cloudflared binary in `desktop/src-tauri/sidecar/` for your platform. CI should run `./scripts/download-cloudflared.sh` (all platforms) before `tauri build`.
- [ ] **Remove personal named tunnel** (optional) — Delete the `matrx-local` tunnel from [Cloudflare dashboard](https://one.dash.cloudflare.com/). Uninstall the system service: `sudo launchctl unload /Library/LaunchDaemons/com.cloudflare.cloudflared.plist && sudo rm /Library/LaunchDaemons/com.cloudflare.cloudflared.plist`.

### 4. CI Secrets
- [X] **Add `AIDREAM_SERVER_URL_LIVE` to GitHub Actions secrets** — Go to repo Settings → Secrets → Actions and add `AIDREAM_SERVER_URL_LIVE=https://server.app.matrxserver.com`. This value is baked into the sidecar binary by `scripts/write_bundled_config.py` during the CI build so the engine can connect to the AIDream API at runtime.

### 5. Supabase & Cloud Config
- [X] **Add "close this tab" page on aimatrx.com** — After OAuth approval, the system browser lands on a blank/confusing page showing the `aimatrx://` URL. Add a page at `aimatrx.com/oauth/success` (or similar) that shows "You're signed in! You can close this tab." Then update the Supabase OAuth consent flow to redirect the browser there after firing the deep link. This is purely a UX improvement — the app itself works correctly without it.
- [X] **Add `aimatrx://auth/callback` to OAuth client redirect URIs** — In Supabase Dashboard → Authentication → OAuth Apps → client `af37ec97-3e0c-423c-a205-3d6c5adc5645`, add `aimatrx://auth/callback` as a redirect URI. This is the production deep-link URI used by the Tauri app on macOS, Linux, and Windows. The `aimatrx` scheme is already registered in `tauri.conf.json`. Keep the existing URIs (`http://localhost:1420/auth/callback`, `http://localhost:22140/auth/callback`, `tauri://localhost/auth/callback`).
- [x] **Run migration 005** — `migrations/005_hardware_identity.sql` adds `hardware_uuid`, `serial_number`, `board_id` columns to `app_instances`. Applied via MCP 2026-03-11.
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