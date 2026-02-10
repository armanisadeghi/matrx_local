## What was done

### 1. Full Windows Support (execution.py rewrite)
- Shell detection: PowerShell on Windows, zsh/bash on macOS/Linux
- Command wrapping uses PowerShell syntax (`Set-Location`, `$LASTEXITCODE`, `Write-Output`) on Windows and bash syntax on Unix
- Quoting uses PowerShell-safe single-quote escaping on Windows, `shlex.quote` on Unix
- CWD sentinel + tracking works with `(Get-Location).Path` on Windows, `pwd` on Unix

### 2. New Tools (7 added, now 20 total)
- **`ClipboardRead`** / **`ClipboardWrite`** — Cross-platform clipboard via pyperclip
- **`Notify`** — Native OS notifications (macOS Notification Center, Windows Toast, Linux libnotify) via plyer
- **`FetchUrl`** — HTTP requests from the user's residential IP via httpx. Full request/response passthrough with realistic browser User-Agent. This is the scraping proxy.
- **`FetchWithBrowser`** — Playwright headless Chromium for JS-rendered pages. Supports `wait_for` selectors and text extraction mode. Optional dependency (`uv sync --extra browser`).
- **`DownloadFile`** — Streaming chunked download from any URL to local filesystem
- **`UploadFile`** — Upload local files to any endpoint via multipart form

### 3. Dependency Cleanup
- `pyaudio`, `sounddevice`, `numpy` moved to `[project.optional-dependencies] audio` — no longer blocks installation
- `playwright` is in optional `browser` extra — only installed when needed
- Added `httpx`, `pyperclip`, `plyer`, `pydantic` to core dependencies
- Version bumped to 0.2.0

### 4. PyInstaller Spec (`matrx_local.spec`)
- Builds a `MatrxLocal` executable for all platforms
- macOS: generates a `.app` bundle with `LSUIElement: True` (menu bar app, no Dock icon)
- Windows: `console=False` so no terminal window pops up
- Includes all hidden imports PyInstaller misses (FastAPI, uvicorn, pydantic, etc.)
- Bundles the `static/` directory for the tray icon

### 5. Auto-Update System (`app/updater.py`)
- On startup, checks `MATRX_UPDATE_URL` for new versions via tufup (The Update Framework)
- If an update is found: downloads, applies, then `os.execv()` to restart in-place
- Silently skips if no update server is configured (default state) or unreachable
- When you're ready to ship updates, just set up an S3 bucket or GitHub Releases with the TUF metadata structure

### 6. Run.py Overhaul
- Resolves paths correctly for both dev (`python run.py`) and frozen PyInstaller builds
- Calls `check_for_updates()` before starting the server
- Configurable port via `MATRX_PORT` env var
- Tray menu shows the active port
- Proper exit handling with `os._exit(0)` to kill all threads

### What's needed next to ship
1. **Build the binary** — Run `pyinstaller matrx_local.spec` on each target platform
2. **Set up the update server** — S3 bucket or GitHub Releases with TUF repo structure, set `MATRX_UPDATE_URL`
3. **Code signing** — Apple Developer cert for macOS, Authenticode cert for Windows (soft blocks without these — users get warnings but can still run)
4. **CI/CD** — GitHub Actions to automate building on macOS/Windows/Linux runners on every release tag
5. **Download page** — Platform-detecting page on aimatrx.com with download buttons