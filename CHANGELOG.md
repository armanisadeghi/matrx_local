# Changelog

---

## v0.3.0 — Scraper Engine Integration

### Scraper Engine (from scraper-service)

Integrated the full `scraper-service` from the `ai-dream` monorepo as a git subtree. This brings production-grade web scraping into Matrx Local without modifying the upstream code.

**New tools:**
- **`Scrape`** — Full scraper engine: multi-strategy fetching (httpx → curl-cffi → Playwright), Cloudflare detection, proxy rotation, content extraction (HTML, PDF, images with OCR), domain-specific parsing rules, two-tier caching
- **`Search`** — Brave Search API integration with structured results
- **`Research`** — Deep research workflow: search + scrape all results + compile findings. Configurable effort levels (low/medium/high/extreme)

**Architecture:**
- `scraper-service/` directory added via `git subtree` — updates pulled from ai-dream with `./scripts/update-scraper.sh`
- `ScraperEngine` in `app/services/scraper/engine.py` manages lifecycle and `sys.modules` isolation (both repos have `app/` packages)
- Graceful degradation: works without database (memory-only cache), without Playwright (curl-cffi fallback), without Brave API key (search disabled, scraping works)

**Dependencies added:**
- `curl-cffi`, `beautifulsoup4`, `lxml`, `selectolax`, `cachetools`, `tldextract`, `matrx-utils`, `markdownify`, `tabulate`, `PyMuPDF`, `pytesseract`, `pydantic-settings`

**Files:**
- `app/services/scraper/engine.py` — ScraperEngine bridge
- `app/tools/tools/network.py` — new Scrape/Search/Research tool handlers
- `app/tools/dispatcher.py` — 3 new tools registered (23 total)
- `app/main.py` — lifespan added for scraper engine startup/shutdown
- `scripts/update-scraper.sh` — one-command scraper-service update from ai-dream

---

## v0.2.0 — Tool System, Packaging, Auto-Update

### Tool System Rewrite

Replaced the legacy route-based API with a unified tool dispatcher. All capabilities are now tools with a consistent interface, available over both WebSocket and REST.

### Windows Support (execution.py rewrite)
- Shell detection: PowerShell on Windows, zsh/bash on macOS/Linux
- Command wrapping uses PowerShell syntax (`Set-Location`, `$LASTEXITCODE`, `Write-Output`) on Windows and bash syntax on Unix
- Quoting uses PowerShell-safe single-quote escaping on Windows, `shlex.quote` on Unix
- CWD sentinel + tracking works with `(Get-Location).Path` on Windows, `pwd` on Unix

### New Tools (7 added, 20 total)
- **`ClipboardRead`** / **`ClipboardWrite`** — Cross-platform clipboard via pyperclip
- **`Notify`** — Native OS notifications (macOS Notification Center, Windows Toast, Linux libnotify) via plyer
- **`FetchUrl`** — HTTP requests from the user's residential IP via httpx. Full request/response passthrough with realistic browser User-Agent.
- **`FetchWithBrowser`** — Playwright headless Chromium for JS-rendered pages. Supports `wait_for` selectors and text extraction mode. Optional dependency (`uv sync --extra browser`).
- **`DownloadFile`** — Streaming chunked download from any URL to local filesystem
- **`UploadFile`** — Upload local files to any endpoint via multipart form

### Dependency Cleanup
- `pyaudio`, `sounddevice`, `numpy` moved to `[project.optional-dependencies] audio` — no longer blocks installation
- `playwright` is in optional `browser` extra — only installed when needed
- Added `httpx`, `pyperclip`, `plyer`, `pydantic` to core dependencies

### PyInstaller Spec (`matrx_local.spec`)
- Builds a `MatrxLocal` executable for all platforms
- macOS: generates a `.app` bundle with `LSUIElement: True` (menu bar app, no Dock icon)
- Windows: `console=False` so no terminal window pops up
- Includes all hidden imports PyInstaller misses (FastAPI, uvicorn, pydantic, etc.)
- Bundles the `static/` directory for the tray icon

### Auto-Update System (`app/updater.py`)
- On startup, checks `MATRX_UPDATE_URL` for new versions via tufup (The Update Framework)
- If an update is found: downloads, applies, then `os.execv()` to restart in-place
- Silently skips if no update server is configured or unreachable

### What's Needed to Ship Binaries
1. **Build the binary** — Run `pyinstaller matrx_local.spec` on each target platform
2. **Set up the update server** — S3 bucket or GitHub Releases with TUF repo structure, set `MATRX_UPDATE_URL`
3. **Code signing** — Apple Developer cert for macOS, Authenticode cert for Windows
4. **CI/CD** — GitHub Actions to automate building on macOS/Windows/Linux runners on every release tag
5. **Download page** — Platform-detecting page on aimatrx.com with download buttons
