# Arman Tasks

_Last updated: 2026-03-02_

---

## 🔴 Active — Do These Now (in order)

---

### 1. Re-trigger CI Build After Agent Fixes

Agent fixed both root causes (pyaudio build failure + Windows venv path). Now commit + push + re-tag:

- [ ] **Commit & push** — `git add -A && git commit -m "fix: CI failures (pyaudio + Windows venv path)" && git push`
- [ ] **Delete old tag & re-tag** — `git tag -d v1.0.1 2>/dev/null; git push origin :refs/tags/v1.0.1 2>/dev/null; git tag v1.0.1 && git push origin v1.0.1` (or use `v1.0.2` if you prefer)
- [ ] **Monitor GitHub Actions** — https://github.com/armanisadeghi/matrx-local/actions
- [ ] **Confirm release** — https://github.com/armanisadeghi/matrx-local/releases (`.dmg`, `.msi`, `.deb`, `.AppImage`, `latest.json`)

---

### 2. Code Signing Certificates (before shipping to public)

These require purchases and external accounts — only you can do this.

- [ ] **Apple Developer account** ($99/yr) — https://developer.apple.com — needed to notarize macOS DMG so Gatekeeper doesn't block it. After enrolling:
  - Get your `APPLE_ID` (your Apple ID email)
  - Create an App-Specific Password at https://appleid.apple.com → "App-Specific Passwords" — this is `APPLE_PASSWORD`
  - Find your `APPLE_TEAM_ID` in Xcode → Settings → Accounts → your team (10-character code)
  - Add all three to GitHub Actions secrets: Settings → Secrets → Actions → New repository secret

  - **CURRENT STATUS**: NONE

- [ ] **Windows EV code signing cert** (optional for first release, ~$200–500/yr) — DigiCert or Sectigo. Without it, SmartScreen shows "Windows protected your PC" warning. Users can click "More info → Run anyway" but it's scary. Skip for beta; add before public launch.
  - **CURRENT STATUS**: Cert purchased, but shippig takes a few days.

---

### 3. Manual Verification (only you can test these on your hardware)

#### macOS
- [ ] **Test DMG install** — Download `.dmg` from the GitHub Release, open it, drag to Applications, launch. Confirm Gatekeeper reaction (expected: warning without notarization). Confirm app opens and connects to engine.
  - **CURRENT STATUS**: NONE
- [ ] **Launch on Startup** — In Settings → General, toggle on "Launch on Startup". Quit the app. Log out and back in. Confirm AI Matrx launches automatically.
  - **CURRENT STATUS**: NONE
- [ ] **Minimize to Tray** — In Settings → General, toggle on "Minimize to Tray". Click the window close button (red X). Confirm app goes to menu bar (not quits). Click tray icon to reopen.
  - **CURRENT STATUS**: NONE
- [ ] **macOS Permissions** — First time a tool requiring them runs, macOS will prompt. Or grant manually in System Settings → Privacy & Security:
  - Accessibility → AI Matrx (for TypeText, MouseClick, Hotkey, FocusWindow)
  - Screen Recording → AI Matrx (for Screenshot tool)
  - Microphone → AI Matrx (for RecordAudio, TranscribeAudio)
- [ ] **User avatar** — Sign in with Google or GitHub. Go to Settings → Cloud & Account. Confirm your profile photo appears.
- [ ] **Headless mode** — In Settings → Scraping, toggle headless off. Run a scrape. Confirm a real Chromium window opens.

  - **CURRENT STATUS**: NONE


#### Windows
- [ ] **Test MSI install** — Download `.msi` from GitHub Release, install it. Confirm SmartScreen reaction. Confirm app launches.
  - **CURRENT STATUS**: NONE
- [ ] **Launch on Startup** — Same test as macOS above.
  - **CURRENT STATUS**: NONE

#### Linux
- [ ] **Test .deb or .AppImage** — Download from GitHub Release, install/run. Confirm launch.
  - **CURRENT STATUS**: NONE

---

### 4. Cloud Sync Verification

- [ ] **app_settings table** — In Supabase SQL Editor at https://app.supabase.com, run: `SELECT * FROM app_settings LIMIT 1;`. If error "table does not exist": migration 002 didn't run correctly. Re-run `migrations/002_app_instances_settings.sql`.
  - **CURRENT STATUS**: NONE
- [ ] **Confirm Proxy "Test Connection" server URL** — What is the correct URL for our main server that would receive the proxy roundtrip test? (e.g. `https://server.app.matrxserver.com`). Tell the agent so it can implement the real test.
  - **CURRENT STATUS**: NONE

---

### 5. Testing Flow (how to test locally without a full build)

**Quick test (daily development) — no build needed:**
```bash
# Terminal 1 — Python engine
uv run python run.py

# Terminal 2 — React web UI only (fast, no Tauri)
cd desktop && pnpm dev
# → Opens http://localhost:1420 in browser
```
This tests: engine API, all tools, all UI pages, auth, scraping.
**Does NOT test:** Tauri-specific features (tray, autostart, sidecar lifecycle, system dialogs, OS file pickers).

**Full desktop test (weekly / before releases):**
```bash
bash scripts/launch.sh
# → Launches engine + pnpm tauri:dev
# → Opens actual native desktop window
```
This tests everything including Tauri features. First run: 60–90s Rust compile.

**After changes to the Python sidecar binary** (rarely needed):
```bash
bash scripts/build-sidecar.sh  # ~5 min build
# Then pnpm tauri:dev uses the new binary
```

**Cleanup when you have stuck ports or multiple windows:**
```bash
bash scripts/stop.sh          # graceful
bash scripts/stop.sh --force  # immediate kill
```

---

### 6. Bugs (agent will fix — full details in AGENT_TASKS.md)

You only need to confirm the fix worked after each one:
- [ ] Dashboard: User profile "Not Found" + Engine shows "standby"
- [ ] Documents: New Folder / New Note broken; sync bar is cosmetic
- [ ] Scraping: No persistence; UX overhaul needed
- [ ] Tools: Multiple broken tools (audio, notify, scheduler, web search)
- [ ] Settings → Proxy: "Test Connection" is fake (confirm server URL above first)
- [ ] Settings → Scraping: Add forbidden URL list
- [ ] Dark mode contrast audit remaining pages
- [ ] System Info UI (CPU, RAM, disk, battery widgets for normal users)

---

## Known Gaps (future work — not urgent)

- [ ] No first-run setup wizard for new users
- [ ] No rate limiting on the remote scraper server per user
- [ ] Wake-on-LAN support
- [ ] Smart device control (HomeKit, Google Home, Alexa APIs)
- [ ] Reverse tunnel for cloud→local proxy routing
- [ ] Job queue for cloud-assigned scrape jobs
- [ ] Windows EV code signing cert (for SmartScreen — when going public)

---

## Notes

- **Auth:** Scraper server supports dual auth — API key AND Supabase JWT. Both work.
- **OAuth app:** Client ID `af37ec97-3e0c-423c-a205-3d6c5adc5645`, type `public`
- **Shipping:** Users auth via Supabase OAuth → JWT works directly on scraper server. No embedded API keys in binary.
- **Tool count:** 79 tools on `main` (dispatcher; LOCAL_TOOL_MANIFEST has 62 for cloud sync)
- **Chat UI:** Merged 2026-02-21 — collapsible sidebar, conversation history, tool call rendering
- **GPT PR #1:** `codex/create-user-friendly-ui-for-tools-tab` — Tools page redesign

---

## ✅ Completed

### Recently (2026-03-02)

- [x] **Ports Grace Kill contrast** — Semantic tokens in Ports.tsx; no more dark red on black.
- [x] **Open Logs / Open Data Folder** — Now use `POST /system/open-folder`; buttons work when engine connected.
- [x] **User avatar CSP** — `img-src` expanded for `lh3.google.com`, `avatars.githubusercontent.com`, `gravatar.com`.
- [x] **Prose markdown** — `@tailwindcss/typography` installed; NoteEditor uses `prose prose-sm dark:prose-invert`.
- [x] **GitHub Actions** — `release.yml` builds 4 platforms; Apple notarization env vars wired; auto-publishes releases.
- [x] **v1.0.0 tag pushed** — CI build triggered. Version synced: pyproject.toml + tauri.conf.json + engine root endpoint.
- [x] **Capabilities tab** — Settings → Capabilities shows Playwright/Whisper/sounddevice/psutil/etc. status + Install buttons.
- [x] **stop.sh created** — `bash scripts/stop.sh` kills all Matrx processes and frees ports 22140–22159 + 1420.

### Earlier

- [x] Full QA pass completed 2026-02-21 — all findings documented in `AGENT_TASKS.md`
- [x] Copy `desktop/.env.example` → `desktop/.env` with Supabase publishable key
- [x] OAuth redirect URLs in Supabase Dashboard; Google, GitHub, Apple providers enabled
- [x] Root `.env` created with `API_KEY`, `SCRAPER_API_KEY`, `SCRAPER_SERVER_URL`
- [x] `SUPABASE_JWKS_URL` set in Coolify; scraper-service JWT auth pushed to main
- [x] OAuth app registered (Client ID: `af37ec97-3e0c-423c-a205-3d6c5adc5645`)
- [x] `uv sync --extra all` run; Playwright Chromium installed
- [x] Scheduler persistence, WiFi tool macOS 13+ rewrite, AppleScript permission messages
- [x] Merged `expand-desktop-tools` → `main` (79 tools in dispatcher)
- [x] GitHub Actions secrets set (`TAURI_SIGNING_PRIVATE_KEY` + password)
- [x] `migrations/001_documents_schema.sql` run in Supabase ✓
- [x] `migrations/002_app_instances_settings.sql` run in Supabase ✓
- [x] Supabase Realtime enabled on `notes`, `note_folders`, `note_shares`
- [x] `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` added to root `.env`
- [x] Device registration with cloud backend — implemented via app instance registration
- [x] Smoke-tested individual tool categories — full findings in AGENT_TASKS.md
