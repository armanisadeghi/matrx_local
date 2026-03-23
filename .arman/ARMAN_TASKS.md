# Arman Tasks — Matrx Local

_Last updated: 2026-03-18_

> Manual actions only — things only you can do (secrets, accounts, hardware, OS-level steps).
> Code changes go in AGENT_TASKS.md instead.

---

## 🔴 ACTIVE — Do These Now

### Certificates & Signing
- [ ] **Windows EV Cert** — Purchase from DigiCert or Sectigo ($200–500/yr). Without it, SmartScreen shows a warning. Skip for beta; required before public launch.

### GitHub Actions Secrets
All three are needed for CI builds to produce working binaries. Go to repo **Settings → Secrets and variables → Actions → New repository secret**.

- [x] `AIDREAM_SERVER_URL_LIVE` — `https://server.app.matrxserver.com`
- [x] `VITE_SUPABASE_URL` — `https://txzxabzwovsujtloxrus.supabase.co`
- [x] `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` — your Supabase publishable key

### Local LLM Binaries (needed before Local Models tab works)
- [x] **Download llama-server binaries** — All four platforms downloaded (b8377) via `./scripts/download-llama-server.sh all`.
- [ ] **Mirror GGUF models to CDN** — Upload to `assets.aimatrx.com/llm-models/`. Default: `Qwen3-8B-Instruct-Q4_K_M.gguf` (~5.2GB). Also Qwen3-4B, Phi-4-mini.
- [ ] **Mirror llama-server binaries to CDN** — Upload to `assets.aimatrx.com/llama-server/`.

### Whisper Model CDN Mirror
- [ ] **Mirror whisper models to CDN** — `assets.aimatrx.com/whisper-models/`: `ggml-tiny.en.bin` (75MB), `ggml-base.en.bin` (142MB), `ggml-small.en.bin` (466MB), `ggml-silero-v6.2.0.bin` (0.8MB).

### Supabase
- [ ] **Confirm `MAIN_SERVER` URL** — Needed for Proxy "Test Connection" implementation. What should this URL be?

---

## 🟡 FUTURE — Not Urgent

### Cloud AI Relay (needed before public launch)
- [ ] **Build AIDream server relay endpoint** — Add a POST `/ai/relay` endpoint on `server.app.matrxserver.com` that accepts a Supabase JWT + AI request payload, validates the JWT, and forwards the request to the appropriate AI provider using platform-owned API keys. This removes the need for users to supply their own keys. Coordinate with agent to wire `matrx_ai` to call the relay instead of providers directly when no user key is stored.

- [x] **Windows MSI → NSIS** — Done. Installer switched to NSIS with custom `installer-hooks.nsh` (2026-03-16).
- [x] **First-run wizard** — Done. Setup wizard with auto-install implemented (2026-03-11).
- [ ] **Rate limiting** on remote scraper server per user.
- [ ] **Wake-on-LAN / smart device protocols** — HomeKit, Google Home, Alexa.
- [ ] **Reverse tunnel** — cloud→local proxy routing.
- [ ] **Remove personal Cloudflare named tunnel** (optional) — `sudo launchctl unload /Library/LaunchDaemons/com.cloudflare.cloudflared.plist && sudo rm /Library/LaunchDaemons/com.cloudflare.cloudflared.plist`, then delete `matrx-local` tunnel from Cloudflare dashboard.

---

## ✅ COMPLETED

- [x] Enrolled in Apple Developer — notarization enabled.
- [x] Added `AIDREAM_SERVER_URL_LIVE` GitHub Actions secret.
- [x] Added `aimatrx://auth/callback` to Supabase OAuth client redirect URIs.
- [x] Added "close this tab" page on aimatrx.com after OAuth.
- [x] Verified `app_settings` and `note_folders` tables + RLS in Supabase.
- [x] Applied migration 005 (`hardware_uuid`, `serial_number`, `board_id` on `app_instances`).
- [x] Applied migration 003 (`forbidden_urls`).
- [x] llama-server ARM Mac binary downloaded and placed.
