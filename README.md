# Matrx Local

**Matrx Local** is the companion desktop service for **AI Matrx**. It runs on the user's machine and exposes a secure, tool-based API that the web/mobile apps and AI agents call over WebSocket or REST. It bridges the gap between cloud-hosted AI and the user's local machine — filesystem, shell, network, hardware, and residential IP.

For the complete system documentation, see **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## Why It Exists

Cloud-hosted AI platforms hit a wall when the task requires the user's real filesystem, local network, native hardware, or residential IP. This service is the escape hatch.

**Key advantages of running locally:**
- Residential IP for scraping (anti-bot systems treat it as legitimate traffic)
- Direct filesystem access (read, write, edit, glob, grep)
- Shell execution (bash, PowerShell, background processes)
- Native OS integration (clipboard, notifications, screenshots)
- Zero proxy costs — the user's own connection is the network

---

## Current Capabilities (v0.4)

| Area | Tools | Notes |
|------|-------|-------|
| **File Operations** | `Read`, `Write`, `Edit`, `Glob`, `Grep` | Full filesystem access |
| **Shell Execution** | `Bash`, `BashOutput`, `TaskStop` | macOS/Linux bash/zsh + Windows PowerShell, foreground + background |
| **System** | `SystemInfo`, `Screenshot`, `ListDirectory`, `OpenUrl`, `OpenPath` | Cross-platform |
| **Clipboard** | `ClipboardRead`, `ClipboardWrite` | Via pyperclip |
| **Notifications** | `Notify` | Native OS notifications |
| **Network / Scraping** | `FetchUrl`, `FetchWithBrowser`, `Scrape`, `Search`, `Research` | Direct httpx / Playwright / full scraper engine |
| **File Transfer** | `DownloadFile`, `UploadFile` | Chunked streaming |
| **Process Management** | `ListProcesses`, `LaunchApp`, `KillProcess`, `FocusApp` | psutil + fallback |
| **Window Management** | `ListWindows`, `FocusWindow`, `MoveWindow`, `MinimizeWindow` | AppleScript / PowerShell / wmctrl |
| **Input Automation** | `TypeText`, `Hotkey`, `MouseClick`, `MouseMove` | AppleScript / PowerShell / xdotool |
| **Audio** | `ListAudioDevices`, `RecordAudio`, `PlayAudio`, `TranscribeAudio` | sounddevice + Whisper |
| **Browser Automation** | `BrowserNavigate`, `BrowserClick`, `BrowserType`, `BrowserExtract`, `BrowserScreenshot`, `BrowserEval`, `BrowserTabs` | Playwright |
| **Network Discovery** | `NetworkInfo`, `NetworkScan`, `PortScan`, `MDNSDiscover` | socket + zeroconf |
| **System Monitoring** | `SystemResources`, `BatteryStatus`, `DiskUsage`, `TopProcesses` | psutil |
| **File Watching** | `WatchDirectory`, `WatchEvents`, `StopWatch` | watchfiles |
| **OS Integration** | `AppleScript`, `PowerShellScript`, `GetInstalledApps` | Native scripting |
| **Scheduler** | `ScheduleTask`, `ListScheduled`, `CancelScheduled`, `HeartbeatStatus`, `PreventSleep` | In-memory task scheduler |
| **Media** | `ImageOCR`, `ImageResize`, `PdfExtract`, `ArchiveCreate`, `ArchiveExtract` | PyMuPDF + Tesseract |
| **WiFi & Bluetooth** | `WifiNetworks`, `BluetoothDevices`, `ConnectedDevices` | macOS / Windows / Linux |
| **Transport** | WebSocket `/ws`, REST `/tools/invoke`, `/tools/list` | Concurrent dispatch, session state, cancellation |
| **Packaging** | PyInstaller `.spec` | macOS `.app` / Windows `.exe` / Linux binary |
| **Auto-Update** | tufup | Checks on startup, applies, restarts |

**73 tools total** — all available via both WebSocket and REST.

### Scraper Engine (v0.3 — New)

The integrated scraper engine (from `scraper-service/`) provides production-grade web scraping:

- **Multi-strategy fetching:** httpx → curl-cffi (with browser impersonation) → Playwright fallback
- **Cloudflare detection** and automatic retry with proxy rotation
- **Content extraction:** HTML parsing, PDF text extraction (PyMuPDF), image OCR (Tesseract)
- **Domain-specific configs:** per-domain parsing rules, path overrides, content filters
- **Two-tier caching:** in-memory TTLCache + PostgreSQL persistence (optional)
- **Brave Search integration:** web search, search-and-scrape, deep research workflows
- **Graceful degradation:** works without database (memory-only cache), without Playwright (curl-cffi handles most sites), without Brave API key (search disabled, scraping works)

---

## Prerequisites

- [uv](https://docs.astral.sh/uv/getting-started/installation/) — handles Python, venvs, and deps automatically

---

## First-Time Setup

```bash
git clone https://github.com/armanisadeghi/matrx_local.git
cd matrx_local

# 1. Copy env file and fill in API_KEY (any value works for local dev)
cp .env.example .env

# 2. Install all Python dependencies
uv sync --extra monitoring --extra discovery

# 3. (Optional) Install Playwright for browser automation tools
uv sync --extra browser
uv run playwright install chromium
```

---

## Running the Python Engine (Backend)

The Python engine is a FastAPI server that exposes all 73 tools over REST and WebSocket. Run it standalone for quick testing — no Rust/Node required.

### Start

```bash
cd /Users/armanisadeghi/Code/matrx-local

# Start in foreground (Ctrl+C to stop, logs print to terminal)
uv run python run.py

# Start in background (logs go to file)
uv run python run.py > /tmp/matrx-engine.log 2>&1 &
echo "Engine PID: $!"
```

The server starts at **`http://127.0.0.1:22140`** and prints the URL on startup. It auto-selects a free port if 22140 is taken (tries 22140–22159).

### Stop

```bash
# If running in foreground: press Ctrl+C

# If running in background:
pkill -f "uv run python run.py"

# Or kill by port:
lsof -ti:22140 | xargs kill -9
```

### Check if it's running

```bash
# Should return {"name":"matrx-local","version":"..."}
curl http://127.0.0.1:22140/

# List all available tools
curl http://127.0.0.1:22140/tools/list

# Check engine logs (if started in background)
tail -f /tmp/matrx-engine.log
```

### Test a tool (REST API)

All tool calls require a `Bearer` token matching your `.env` `API_KEY`:

```bash
# Invoke SystemInfo
curl -X POST http://127.0.0.1:22140/tools/invoke \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY_HERE" \
  -d '{"tool": "SystemInfo", "input": {}}'

# Invoke SystemResources (needs psutil: uv sync --extra monitoring)
curl -X POST http://127.0.0.1:22140/tools/invoke \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY_HERE" \
  -d '{"tool": "SystemResources", "input": {}}'

# Run a bash command
curl -X POST http://127.0.0.1:22140/tools/invoke \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY_HERE" \
  -d '{"tool": "Bash", "input": {"command": "echo hello world"}}'
```

Replace `YOUR_API_KEY_HERE` with whatever value you put in `.env` for `API_KEY`.

### View API docs (Swagger UI)

With the server running, open: **http://127.0.0.1:22140/docs**

---

## Port & Environment

```bash
# Force a specific port
MATRX_PORT=9999 uv run python run.py

# Debug mode with verbose logging
DEBUG=True LOG_LEVEL=DEBUG uv run python run.py
```

### Environment Variables

Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `API_KEY` | Yes | Any value for local dev (used as Bearer token) |
| `DATABASE_URL` | No | PostgreSQL for persistent scrape cache |
| `BRAVE_API_KEY` | No | Enables `Search` and `Research` tools |
| `SCRAPER_SERVER_URL` | No | Remote scraper proxy URL |
| `MATRX_PORT` | No | Override default port 22140 |

### Dependency Groups

```bash
uv sync                              # Core only
uv sync --extra monitoring           # psutil (SystemResources, BatteryStatus, etc.)
uv sync --extra discovery            # zeroconf (MDNSDiscover, NetworkScan)
uv sync --extra browser              # Playwright (BrowserNavigate, FetchWithBrowser)
uv sync --extra audio                # sounddevice + numpy (RecordAudio, PlayAudio)
uv sync --extra transcription        # openai-whisper (TranscribeAudio)
uv sync --extra all                  # Everything above
```

---

## Desktop App (Tauri)

The full desktop app wraps the Python engine in a React/Tauri shell — system tray, native window, bundled sidecar, auto-update. In dev mode the Python engine runs from source alongside Vite's hot-reload. In production it's a bundled binary with a PyInstaller sidecar.

### Prerequisites (one-time setup)

```bash
# 1. Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# 2. pnpm
npm install -g pnpm

# 3. Install JS dependencies
cd desktop && pnpm install && cd ..
```

### Dev mode (start desktop app with hot reload)

**Important:** The Tauri dev mode starts its own embedded Python engine. Stop any standalone Python engine first (`pkill -f "uv run python run.py"`) to avoid port conflicts.

```bash
cd /Users/armanisadeghi/Code/matrx-local/desktop
pnpm tauri:dev
```

This compiles the Rust core (takes ~2 minutes the first time, seconds after that), starts the Vite dev server on port 1420, then opens the app window. Python changes are picked up by restarting the sidecar. React/TS changes hot-reload instantly.

### Stop dev mode

Press `Ctrl+C` in the terminal where `pnpm tauri:dev` is running, or close the app window.

### Build & ship (production binary)

**Step 1 — Build the Python sidecar** (do this any time Python code changes):

```bash
cd /Users/armanisadeghi/Code/matrx-local
uv sync              # make sure deps are up to date
bash scripts/build-sidecar.sh
```

This creates a single-file ~60 MB binary at `desktop/src-tauri/sidecar/aimatrx-engine-aarch64-apple-darwin` (name varies by platform).

**Step 2 — Build the desktop app:**

```bash
cd /Users/armanisadeghi/Code/matrx-local/desktop
pnpm tauri build
```

Output is in `desktop/src-tauri/target/release/bundle/`:
- macOS: `.dmg` installer
- Windows: `.msi` installer
- Linux: `.AppImage` or `.deb`

### Automated CI builds (GitHub Actions)

Push to `main` and GitHub Actions builds signed binaries for all platforms automatically. Requires these secrets set in the repo:

| Secret | Value |
|--------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.tauri/matrx-local.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `matrx-signing-2026` |

Set them at: https://github.com/armanisadeghi/matrx-local/settings/secrets/actions

### Desktop environment variables

Copy `desktop/.env.example` to `desktop/.env`:

```bash
cp desktop/.env.example desktop/.env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Yes | Supabase publishable key (safe to embed) |

---

## Architecture

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the full system architecture, project structure, tool reference, auth flow, and packaging guide.

Key design decisions:

- **scraper-service/ is a git subtree** from `ai-dream` -- never edited in this repo, updates flow one-way
- **Import isolation** via `sys.modules` remapping -- zero modifications to scraper-service code
- **Graceful degradation** -- works without database, Playwright, or Brave API key
- **Tauri desktop shell** -- React UI + Rust core + Python sidecar

---

## Updating the Scraper Engine

When the scraper-service is updated in the `ai-dream` repo:

```bash
# From local ai-dream repo (development)
./scripts/update-scraper.sh --local

# From GitHub (CI/CD)
./scripts/update-scraper.sh

# Then update dependencies if scraper-service pyproject.toml changed
uv sync --extra browser
```

This merges upstream changes into `scraper-service/` without touching the integration layer.

---

## API Reference

### REST

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/tools/list` | GET | List all available tools |
| `/tools/invoke` | POST | Invoke a tool (stateless session) |

**POST /tools/invoke** body:
```json
{
  "tool": "Scrape",
  "input": {
    "urls": ["https://example.com"],
    "use_cache": true
  }
}
```

### WebSocket (`/ws`)

Messages are JSON. Each tool call runs concurrently.

```json
// Tool call
{"id": "req-1", "tool": "Scrape", "input": {"urls": ["https://example.com"]}}

// Response
{"id": "req-1", "type": "success", "output": "...", "metadata": {...}}

// Cancel a task
{"id": "req-1", "action": "cancel"}

// Cancel all
{"action": "cancel_all"}

// Ping
{"action": "ping"}
```

---

## License

Proprietary — internal use only.
