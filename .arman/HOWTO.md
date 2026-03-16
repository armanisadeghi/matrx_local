# How-To Guide

_Last updated: 2026-03-15_

---

## Releasing

```bash
git add . && git commit -m "your changes"
./scripts/release.sh              # auto-bumps patch (1.0.1 → 1.0.2)
./scripts/release.sh minor        # bump minor      (1.0.1 → 1.1.0)
./scripts/release.sh major        # bump major      (1.0.1 → 2.0.0)
./scripts/release.sh 2.3.4        # set exact version
```

The script bumps the version in `pyproject.toml`, `tauri.conf.json`, `package.json`, and `run.py`, commits, tags, and pushes — triggering GitHub Actions CI for all 4 platforms.

---

## Testing Locally

### Daily development (fast, no build)

```bash
# Terminal 1 — Python engine
uv run python run.py

# Terminal 2 — React UI
cd desktop && pnpm dev
# → http://localhost:1420
```

Tests: engine API, all tools, all UI pages, auth, scraping.
Does **not** test: tray icon, autostart, sidecar lifecycle, OS file pickers, Tauri dialogs.

### Full desktop test (before releases)

```bash
bash scripts/launch.sh
# → Launches engine + tauri:dev, opens native window
# First run: 60–90s Rust compile
```

### Rebuild the Python sidecar binary

```bash
bash scripts/build-sidecar.sh   # ~5 min
```

### Stop stuck processes

```bash
bash scripts/stop.sh            # graceful
bash scripts/stop.sh --force    # immediate kill
# Windows PowerShell: Get-Process -Name python | Stop-Process -Force
```

---

## Apple Developer Setup (for notarization)

1. Enroll at https://developer.apple.com ($99/yr)
2. `APPLE_ID` = your Apple ID email
3. `APPLE_PASSWORD` = App-Specific Password from https://appleid.apple.com → App-Specific Passwords
4. `APPLE_TEAM_ID` = 10-character code from Xcode → Settings → Accounts
5. Add all three to GitHub Actions secrets

---

## macOS Permissions

Grant manually in **System Settings → Privacy & Security**:

| Permission | Tools that need it |
|---|---|
| Accessibility | TypeText, MouseClick, Hotkey, FocusWindow |
| Screen Recording | Screenshot |
| Microphone | RecordAudio, TranscribeAudio |
| Full Disk Access | iMessage read, TCC.db access |
