# Installation & Data Safety Guide

How AI Matrx installs, updates, and stores user data on each platform.

---

## Installation Per Platform

### macOS

**Initial install:** Download the `.dmg` file for your architecture (Apple Silicon or Intel). Open the DMG, drag "AI Matrx" to the Applications folder shortcut, and eject.

**First-run Gatekeeper fix:** If macOS blocks the app ("damaged" or "unverified developer"):
```bash
xattr -cr '/Applications/AI Matrx.app'
```

**First-run Setup Wizard:** On first launch the app runs a Setup Wizard that:
1. Verifies core Python packages (playwright, psutil, zeroconf, sounddevice, numpy)
2. Downloads Chromium for browser automation (~280 MB to `~/.matrx/playwright-browsers/`)
3. Creates user document directories (`~/Documents/Matrx/Notes/`, `Files/`, `Code/`)
4. Checks OS-level permissions (microphone, camera, accessibility, screen recording)
5. Optionally downloads Whisper transcription model (~150 MB to Tauri app data dir)

The wizard is dismissible and can be re-triggered by clearing `matrx-setup-dismissed` from localStorage.

**Upgrading:** The built-in auto-updater downloads a signed `.app.tar.gz`, verifies the Ed25519 signature, replaces the app bundle in place, and prompts for restart. No data is lost -- all user data lives outside the `.app` bundle.

**Manual reinstall:** Download the new `.dmg`, drag to Applications, click "Replace". All user data is preserved.

### Windows

**Initial install:** Download and run `Windows-Setup.exe` (NSIS) or `Windows.msi` (WiX). Follow the wizard. Installs to `C:\Program Files\AI Matrx\`.

**First-run:** Same Setup Wizard as macOS runs automatically.

**Upgrading:** Auto-updater handles this. For manual upgrades, run the new installer -- it overwrites the previous installation. User data in `%APPDATA%\MatrxLocal\` is not touched.

**Uninstall:** Use "Add or Remove Programs". Removes the application but preserves user data directories.

### Linux

**Initial install:**
```bash
sudo dpkg -i AI-Matrx_*_Linux.deb
```

**First-run:** Same Setup Wizard.

**Upgrading:** Auto-updater handles this. For manual upgrades, install the new `.deb` -- `dpkg` replaces the old version. User data in `~/.local/share/matrx-local/` and `~/.matrx/` is preserved.

---

## Where User Data Is Stored

**No user data is stored inside the application bundle.** All data lives in OS-standard directories that survive updates, reinstalls, and uninstalls.

### Cross-Platform (`~/.matrx/`)

Always in the user's home directory regardless of OS:

| Path | Purpose |
|------|---------|
| `~/.matrx/local.json` | Engine discovery (port, tunnel URL) -- regenerated on startup |
| `~/.matrx/settings.json` | App settings (proxy, scraping config, etc.) |
| `~/.matrx/instance.json` | Stable machine instance ID |
| `~/.matrx/matrx.db` | Local SQLite database (data sync, scrape cache) |
| `~/.matrx/scheduled_tasks.json` | Background scheduled tasks |
| `~/.matrx/documents/` | User markdown notes with sync metadata |
| `~/.matrx/documents/.sync/` | Sync state, conflict files, directory mappings |
| `~/.matrx/workspaces/` | Workspace definitions |
| `~/.matrx/bin/cloudflared` | Cloudflare tunnel binary (downloaded on first use) |
| `~/.matrx/playwright-browsers/` | Browser binaries for automation (~280 MB, auto-installed by Setup Wizard) |

### User Documents (`~/Documents/Matrx/`)

Visible, user-accessible files created by Setup Wizard:

| Path | Purpose |
|------|---------|
| `~/Documents/Matrx/Notes/` | Local markdown notes (source of truth for sync) |
| `~/Documents/Matrx/Files/` | Binary files (PDF, images, audio, etc.) |
| `~/Documents/Matrx/Code/` | Git repositories visible to agents |

### OS-Native App Data (Tauri-Managed)

Tauri stores webview state and Rust-side data in the OS-native app data directory. This includes Whisper transcription models and transcription configuration.

#### macOS
| Path | Purpose |
|------|---------|
| `~/Library/Application Support/MatrxLocal/` | Engine persistent data |
| `~/Library/Caches/MatrxLocal/` | Cache, temp files, screenshots, audio |
| `~/Library/Logs/MatrxLocal/` | Rotating log files |
| `~/Library/Application Support/AI Matrx/` | Tauri app data (localStorage, Whisper models, transcription config) |

#### Windows
| Path | Purpose |
|------|---------|
| `%APPDATA%\MatrxLocal\` | Engine persistent data |
| `%LOCALAPPDATA%\MatrxLocal\` | Cache, temp files, logs |
| `%LOCALAPPDATA%\AI Matrx\` | Tauri app data (localStorage, Whisper models, transcription config) |

#### Linux
| Path | Purpose |
|------|---------|
| `~/.local/share/matrx-local/` | Engine persistent data |
| `~/.cache/matrx-local/` | Cache, temp files |
| `~/.local/state/matrx-local/logs/` | Rotating log files |
| `~/.config/AI Matrx/` | Tauri app data (localStorage, Whisper models, transcription config) |

### Tauri App Data Contents

Stored inside the OS-native Tauri app data directory listed above:

| Path (relative) | Purpose |
|------------------|---------|
| `models/` | Downloaded Whisper GGML model files (~150 MB+ each) |
| `transcription.json` | Transcription configuration (selected model, setup state) |
| (webview data) | localStorage, cookies, webview cache |

### Browser localStorage

Stored in the Tauri webview data directory:

| Key | Purpose |
|-----|---------|
| `matrx-settings` | UI settings (theme, proxy toggle, auto-update prefs) |
| `matrx-setup-dismissed` | Whether Setup Wizard has been dismissed |
| `sidebar-collapsed` | Sidebar UI state |
| `matrx-update-dismissed-version` | Last dismissed update version |

### Cloud (Supabase)

Synced remotely for multi-device access:

| Table | Purpose |
|-------|---------|
| `app_settings` | Per-instance settings |
| `app_instances` | Device registration |
| `notes` / `note_folders` | Document sync |

---

## Environment Variable Overrides

Power users can override any data directory:

| Variable | Default |
|----------|---------|
| `MATRX_HOME_DIR` | `~/.matrx` |
| `MATRX_DATA_DIR` | OS app data dir |
| `MATRX_TEMP_DIR` | OS cache dir |
| `MATRX_LOG_DIR` | OS log dir |
| `MATRX_USER_DIR` | `~/Documents/Matrx` |
| `MATRX_NOTES_DIR` | `~/Documents/Matrx/Notes` |
| `MATRX_FILES_DIR` | `~/Documents/Matrx/Files` |
| `MATRX_CODE_DIR` | `~/Documents/Matrx/Code` |
| `MATRX_WORKSPACES_DIR` | `~/.matrx/workspaces` |
| `MATRX_LOCAL_DB` | `~/.matrx/matrx.db` |
| `PLAYWRIGHT_BROWSERS_PATH` | `~/.matrx/playwright-browsers` |

---

## Auto-Update System

The app uses Tauri's built-in updater with Ed25519 signature verification:

1. Checks `latest.json` from GitHub Releases on startup (15s delay) and periodically (configurable, default 4h)
2. If a new version is available, shows a dialog with version comparison and release notes
3. User clicks "Install Update" -- downloads the platform-specific signed artifact
4. Progress bar shows real-time download progress
5. After install, user clicks "Restart Now" to relaunch with the new version

The auto-updater uses `.app.tar.gz` on macOS (not the DMG). The DMG is only for initial installation.

Settings > About provides manual check, auto-update toggle, and interval configuration.

---

## Complete Uninstall (Remove All Data)

To fully remove AI Matrx including all user data:

### macOS
```bash
rm -rf '/Applications/AI Matrx.app'
rm -rf ~/.matrx
rm -rf ~/Documents/Matrx
rm -rf ~/Library/Application\ Support/MatrxLocal
rm -rf ~/Library/Application\ Support/AI\ Matrx
rm -rf ~/Library/Caches/MatrxLocal
rm -rf ~/Library/Logs/MatrxLocal
```

### Windows (PowerShell)
```powershell
# Uninstall via Add/Remove Programs first, then:
Remove-Item -Recurse "$HOME\.matrx"
Remove-Item -Recurse "$HOME\Documents\Matrx"
Remove-Item -Recurse "$env:APPDATA\MatrxLocal"
Remove-Item -Recurse "$env:LOCALAPPDATA\MatrxLocal"
Remove-Item -Recurse "$env:LOCALAPPDATA\AI Matrx"
```

### Linux
```bash
sudo dpkg -r ai-matrx  # or the package name
rm -rf ~/.matrx
rm -rf ~/Documents/Matrx
rm -rf ~/.local/share/matrx-local
rm -rf ~/.cache/matrx-local
rm -rf ~/.local/state/matrx-local
rm -rf ~/.config/AI\ Matrx
```
