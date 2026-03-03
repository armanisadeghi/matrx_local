# How-To Guide

_Last updated: 2026-03-02_

---

## Releasing

v1.0.1 is already pushed and CI is running. For future releases:

```bash
git add . && git commit -m "your changes"
./scripts/release.sh              # auto-bumps patch (1.0.1 → 1.0.2)
./scripts/release.sh minor        # bump minor      (1.0.1 → 1.1.0)
./scripts/release.sh major        # bump major      (1.0.1 → 2.0.0)
./scripts/release.sh 2.3.4        # set exact version
```

The script auto-bumps the version, syncs it across `pyproject.toml`, `tauri.conf.json`, `package.json`, and `run.py`, commits, tags, and pushes — triggering GitHub Actions CI.

---

## Apple Developer Setup

Required for notarizing macOS DMG so Gatekeeper doesn't block it.

1. Enroll at https://developer.apple.com ($99/yr)
2. Get your `APPLE_ID` (your Apple ID email)
3. Create an App-Specific Password at https://appleid.apple.com → "App-Specific Passwords" — this becomes `APPLE_PASSWORD`
4. Find your `APPLE_TEAM_ID` in Xcode → Settings → Accounts → your team (10-character code)
5. Add all three to GitHub Actions secrets: Settings → Secrets → Actions → New repository secret

---

## Windows Code Signing

Purchase an EV code-signing cert ($200–500/yr) from DigiCert or Sectigo. Without it, SmartScreen shows "Windows protected your PC" warning. Users _can_ click "More info → Run anyway" but it's not ideal. Skip for beta; add before public launch.

---

## Testing Locally

### Quick test (daily development — no build needed)

```bash
# Terminal 1 — Python engine
uv run python run.py

# Terminal 2 — React web UI only (fast, no Tauri)
cd desktop && pnpm dev
# → Opens http://localhost:1420 in browser
```

This tests: engine API, all tools, all UI pages, auth, scraping.
**Does NOT test:** Tauri-specific features (tray, autostart, sidecar lifecycle, system dialogs, OS file pickers).

### Full desktop test (weekly / before releases)

```bash
bash scripts/launch.sh
# → Launches engine + pnpm tauri:dev
# → Opens actual native desktop window
```

This tests everything including Tauri features. First run: 60–90s Rust compile.

### After changes to the Python sidecar binary (rarely needed)

```bash
bash scripts/build-sidecar.sh  # ~5 min build
# Then pnpm tauri:dev uses the new binary
```

### Cleanup (stuck ports or multiple windows)

```bash
bash scripts/stop.sh          # graceful
bash scripts/stop.sh --force  # immediate kill
```

---

## Cloud Sync Verification

### app_settings table
In Supabase SQL Editor at https://app.supabase.com, run:
```sql
SELECT * FROM app_settings LIMIT 1;
```
If error "table does not exist": re-run `migrations/002_app_instances_settings.sql`.

### note_folders table (Documents "New Folder" broken)
Run in Supabase SQL Editor:
```sql
SELECT * FROM note_folders LIMIT 1;
```
Then check RLS:
```sql
SELECT * FROM pg_policies WHERE tablename = 'note_folders';
```
Policy must allow INSERT for `auth.uid() = user_id`. If missing, re-run `migrations/001_documents_schema.sql`.

### BRAVE_API_KEY for web search
Get a key at https://api.search.brave.com, then add to root `.env`:
```
BRAVE_API_KEY=<your-key>
```
Restart engine to enable web search in Tools page.

---

## macOS Permissions

First time a tool requiring them runs, macOS will prompt. Or grant manually in System Settings → Privacy & Security:

- **Accessibility** → AI Matrx (for TypeText, MouseClick, Hotkey, FocusWindow)
- **Screen Recording** → AI Matrx (for Screenshot tool)
- **Microphone** → AI Matrx (for RecordAudio, TranscribeAudio)


POWERSHELL KILL: Get-Process -Name python | Stop-Process -Force