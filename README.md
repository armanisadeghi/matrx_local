# Matrx Local

**Matrx Local** is the companion desktop service for **AI Matrx**. It runs on the user's machine and exposes a secure, tool-based API that the web/mobile apps and AI agents call over WebSocket or REST. It bridges the gap between cloud-hosted AI and the user's local machine — filesystem, shell, network, hardware, and residential IP.

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

Create a `.env` file in the project root:

```env
# Required for scraper engine (set to any value for local dev)
API_KEY=local-dev

# Database (optional — scraper works without it, memory-only cache)
DATABASE_URL=postgresql://user:pass@localhost:5432/scraper_db

# Brave Search (optional — enables Search and Research tools)
BRAVE_API_KEY=your-brave-api-key

# Proxy lists (optional — comma-separated, scraper rotates through them)
DATACENTER_PROXIES=http://proxy1:port,http://proxy2:port
RESIDENTIAL_PROXIES=http://proxy1:port,http://proxy2:port

# Server config (optional — auto-selects if not set)
# MATRX_PORT=22140
DEBUG=True
```

### Common Commands

```bash
uv sync                          # Install/update dependencies
uv sync --extra browser          # Include Playwright
uv add <package>                 # Add a dependency
uv run <command>                 # Run in project environment
uv run python run.py             # Start the server
```

---

## Architecture

```
matrx_local/
├── app/
│   ├── main.py                  # FastAPI app + scraper engine lifespan
│   ├── config.py                # App configuration
│   ├── websocket_manager.py     # WebSocket connection handling
│   ├── api/
│   │   ├── routes.py            # Legacy HTTP routes
│   │   └── tool_routes.py       # REST tool invocation (/tools/invoke, /tools/list)
│   ├── tools/
│   │   ├── dispatcher.py        # Tool routing (23 tools registered)
│   │   ├── session.py           # Per-connection state (cwd, bg processes)
│   │   ├── types.py             # ToolResult, ToolResultType
│   │   └── tools/               # Tool implementations
│   │       ├── file_ops.py      # Read, Write, Edit, Glob, Grep
│   │       ├── execution.py     # Bash, BashOutput, TaskStop
│   │       ├── system.py        # SystemInfo, Screenshot, etc.
│   │       ├── clipboard.py     # ClipboardRead, ClipboardWrite
│   │       ├── notify.py        # Notify
│   │       ├── network.py       # FetchUrl, FetchWithBrowser, Scrape, Search, Research
│   │       └── transfer.py      # DownloadFile, UploadFile
│   └── services/
│       └── scraper/
│           └── engine.py        # ScraperEngine — bridge to scraper-service
├── scraper-service/             # Git subtree from ai-dream repo (DO NOT EDIT)
│   ├── app/                     # Full scraper-service codebase
│   ├── alembic/                 # Database migrations
│   ├── pyproject.toml           # Scraper-service dependencies
│   └── Dockerfile               # Production Docker build
├── scripts/
│   └── update-scraper.sh        # Pull latest scraper-service from ai-dream
├── pyproject.toml               # Project config & dependencies
├── run.py                       # Entry point
└── uv.lock                      # Dependency lockfile
```

### Key Design Decisions

- **scraper-service/ is a git subtree** — pulled from the `ai-dream` monorepo. It is **never edited in this repo**. Updates flow one-way from ai-dream. Run `./scripts/update-scraper.sh --local` to pull the latest.
- **Import isolation** — The scraper-service uses `app.*` imports internally, which would conflict with matrx_local's own `app/`. The `ScraperEngine` in `app/services/scraper/engine.py` handles this via `sys.modules` namespace remapping. Zero modifications to the scraper-service code are needed.
- **Graceful degradation** — The scraper engine starts with whatever is available. No database? Memory-only cache. No Playwright? curl-cffi handles it. No Brave key? Search is disabled but scraping works.

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
