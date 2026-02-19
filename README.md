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

## Current Capabilities (v0.3)

| Area | Tools | Notes |
|------|-------|-------|
| **File Operations** | `Read`, `Write`, `Edit`, `Glob`, `Grep` | Full filesystem access |
| **Shell Execution** | `Bash`, `BashOutput`, `TaskStop` | Windows PowerShell + macOS/Linux bash/zsh, foreground + background |
| **System** | `SystemInfo`, `Screenshot`, `ListDirectory`, `OpenUrl`, `OpenPath` | Cross-platform |
| **Clipboard** | `ClipboardRead`, `ClipboardWrite` | Via pyperclip |
| **Notifications** | `Notify` | Native OS notifications via plyer |
| **Scraping (Simple)** | `FetchUrl`, `FetchWithBrowser` | Direct httpx / Playwright from residential IP |
| **Scraping (Advanced)** | `Scrape`, `Search`, `Research` | Full scraper engine — see below |
| **File Transfer** | `DownloadFile`, `UploadFile` | Chunked streaming via httpx |
| **Transport** | WebSocket `/ws`, REST `/tools/invoke`, `/tools/list` | Concurrent dispatch, session state, cancellation |
| **Packaging** | PyInstaller `.spec` | macOS `.app` / Windows `.exe` / Linux binary |
| **Auto-Update** | tufup | Checks on startup, applies, restarts |

**23 tools total** — all available via both WebSocket and REST.

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

## Quick Start

```bash
git clone https://github.com/armanisadeghi/matrx_local.git
cd matrx_local

# Install dependencies (including scraper engine deps)
uv sync --extra browser

# Install Playwright browser
uv run playwright install chromium

# Run the application
uv run python run.py
```

The server starts at `http://127.0.0.1:22140` by default and writes its actual URL to `~/.matrx/local.json` for frontend discovery.

### Port Selection

The default port is **22140** (chosen to avoid conflicts with common dev ports like 3000, 5173, 8000, 8001). If that port is taken, it auto-scans up to 20 consecutive ports (22140-22159). The frontend discovers the actual port by reading `~/.matrx/local.json`.

To force a specific port: `MATRX_PORT=9999 uv run python run.py`

### Environment Variables

Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

Key settings:

| Variable | Required | Description |
|----------|----------|-------------|
| `API_KEY` | Yes | Any value for local dev |
| `DATABASE_URL` | No | PostgreSQL for persistent scrape cache (Supabase or local) |
| `BRAVE_API_KEY` | No | Enables Search and Research tools |
| `MATRX_PORT` | No | Override default port 22140 |

See `.env.example` for the full list with documentation.

### Common Commands

```bash
uv sync                          # Install/update dependencies
uv sync --extra browser          # Include Playwright
uv add <package>                 # Add a dependency
uv run <command>                 # Run in project environment
uv run python run.py             # Start the server
```

---

## Desktop App (Tauri)

The full desktop app wraps the Python engine in a React/Tauri shell — system tray, native window, bundled sidecar, auto-update.

### Prerequisites (desktop only)

- **Rust toolchain** — install once via [rustup.rs](https://rustup.rs/):
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  source "$HOME/.cargo/env"
  ```
- **pnpm** — `npm install -g pnpm`

### 1 — Build the Python sidecar (required before any Tauri run)

```bash
cd /path/to/matrx_local
uv sync                        # installs all deps including pyinstaller
bash scripts/build-sidecar.sh  # builds ~60 MB single-file binary
```

Output: `desktop/src-tauri/sidecar/aimatrx-engine-aarch64-apple-darwin` (name is platform-specific).
Rebuild this any time you change Python code.

### 2 — Dev mode (hot reload)

```bash
cd desktop
pnpm install        # first time only
pnpm tauri dev      # starts Vite + Rust together
```

### 3 — Production build

```bash
cd desktop
pnpm tauri build
```

Outputs a `.dmg` (macOS), `.msi` (Windows), or `.AppImage`/`.deb` (Linux) in `desktop/src-tauri/target/release/bundle/`.

### Desktop environment variables

Copy `desktop/.env.example` to `desktop/.env`:

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
