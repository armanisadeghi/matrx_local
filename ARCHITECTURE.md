# Matrx Local -- System Architecture

> The single source of truth for understanding this repository. Start here.

---

## What is Matrx Local?

Matrx Local is the companion desktop application for **AI Matrx**. It runs on the user's machine and exposes a tool-based API (REST + WebSocket) that the AI Matrx web/mobile apps and AI agents call to interact with the user's local environment: filesystem, shell, browser, clipboard, hardware, and residential IP. It also integrates a production-grade scraping engine for bypassing anti-bot protections using the user's real browser and real IP.

---

## High-Level Architecture

```mermaid
graph TB
  subgraph TauriApp [Tauri Desktop App]
    RustCore["Rust Core<br/>Window, tray, sidecar lifecycle"]
    ReactUI["React/Vite UI<br/>Dashboard, Scraping, Tools, Settings"]
    RustCore -->|WebView| ReactUI
  end

  subgraph PythonEngine [Python/FastAPI Engine]
    FastAPI["FastAPI Server<br/>run.py :22140"]
    ToolDispatcher["Tool Dispatcher<br/>23 tools"]
    ScraperEngine["Scraper Engine<br/>scraper-service subtree"]
    WSManager["WebSocket Manager<br/>Concurrent sessions"]
    FastAPI --> ToolDispatcher
    FastAPI --> WSManager
    ToolDispatcher --> ScraperEngine
  end

  ReactUI -->|"HTTP / WS<br/>localhost:22140"| FastAPI
  RustCore -->|"Sidecar spawn/kill"| PythonEngine

  Cloud["AI Matrx Cloud<br/>aimatrx.com"]
  SupabaseAuth["Supabase Auth<br/>OAuth + JWT"]
  RemoteScraper["Remote Scraper Server<br/>scraper.app.matrxserver.com"]
  SupabaseDB["Supabase PostgreSQL<br/>Optional local cache"]

  ReactUI -->|OAuth| SupabaseAuth
  PythonEngine -->|"Validate JWT"| SupabaseAuth
  PythonEngine -->|"Cache storage"| SupabaseDB
  PythonEngine -->|"X-API-Key"| RemoteScraper
  Cloud -->|"Scrape jobs"| PythonEngine
```

### Data Flow

1. **User interacts** with the React UI in the Tauri WebView.
2. **React sends** REST or WebSocket requests to the Python engine at `localhost:22140`.
3. **Python dispatches** the request to the appropriate tool handler.
4. **Tool executes** the operation (file I/O, shell command, scrape, etc.).
5. **Result returns** through the same transport to the UI.

In production, Tauri spawns the Python engine as a managed child process (sidecar). In development, the Python engine runs standalone.

---

## Project Structure

```
matrx_local/
├── app/                            # Python engine source
│   ├── main.py                     # FastAPI app, CORS, scraper lifespan
│   ├── config.py                   # Env-based configuration
│   ├── websocket_manager.py        # WS connection handling
│   ├── api/
│   │   ├── routes.py               # Legacy HTTP routes
│   │   ├── tool_routes.py          # /tools/invoke, /tools/list
│   │   └── remote_scraper_routes.py # /remote-scraper/* proxy to scraper server
│   ├── tools/
│   │   ├── dispatcher.py           # Tool routing (23 tools registered)
│   │   ├── session.py              # Per-connection state (cwd, bg processes)
│   │   ├── types.py                # ToolResult, ToolResultType
│   │   └── tools/                  # Individual tool implementations
│   │       ├── file_ops.py         # Read, Write, Edit, Glob, Grep
│   │       ├── execution.py        # Bash, BashOutput, TaskStop
│   │       ├── system.py           # SystemInfo, Screenshot, etc.
│   │       ├── clipboard.py        # ClipboardRead, ClipboardWrite
│   │       ├── notify.py           # Notify
│   │       ├── network.py          # FetchUrl, FetchWithBrowser, Scrape, Search, Research
│   │       └── transfer.py         # DownloadFile, UploadFile
│   ├── services/
│   │   └── scraper/
│   │       ├── engine.py           # ScraperEngine bridge to scraper-service
│   │       └── remote_client.py    # HTTP client for remote scraper server API
│   └── common/
│       └── system_logger.py        # Rotating file + console logging
├── scraper-service/                # Git subtree -- DO NOT EDIT directly
│   ├── app/                        # Upstream scraper codebase
│   ├── alembic/                    # DB migrations (PostgreSQL)
│   └── pyproject.toml              # Upstream dependencies
├── desktop/                        # Tauri + React desktop UI
│   ├── src/
│   │   ├── App.tsx                 # Router, auth guard, engine context
│   │   ├── index.css               # Dark theme (shadcn/ui CSS vars)
│   │   ├── components/
│   │   │   ├── layout/             # Sidebar, Header, AppLayout
│   │   │   └── ui/                 # shadcn/ui components (Button, Card, Badge, etc.)
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx       # Engine status, system info, browser detection
│   │   │   ├── Scraping.tsx        # URL input, batch scrape, dual-mode results
│   │   │   ├── Tools.tsx           # Browse and invoke all 23 tools
│   │   │   ├── Activity.tsx        # Real-time WebSocket event log
│   │   │   ├── Settings.tsx        # Engine, scraping, theme, account
│   │   │   ├── Login.tsx           # OAuth (Google/GitHub/Apple) + email
│   │   │   └── AuthCallback.tsx    # OAuth redirect handler
│   │   ├── hooks/
│   │   │   ├── use-engine.ts       # Engine auto-discovery, health, WS
│   │   │   ├── use-auth.ts         # Supabase auth state + OAuth methods
│   │   │   ├── use-theme.ts        # Dark/light/system theme management
│   │   │   └── use-tool.ts         # Tool invocation with loading/error
│   │   └── lib/
│   │       ├── api.ts              # REST + WS client for Python engine
│   │       ├── supabase.ts         # Supabase client singleton
│   │       ├── sidecar.ts          # Tauri sidecar lifecycle
│   │       ├── settings.ts         # App settings persistence (localStorage)
│   │       └── utils.ts            # cn(), formatBytes, formatDuration
│   ├── src-tauri/                  # Rust backend
│   │   ├── src/lib.rs              # Sidecar spawn/kill, system tray, hide-to-tray
│   │   ├── src/main.rs             # Windows subsystem entry point
│   │   ├── tauri.conf.json         # App config, CSP, sidecar + bundle settings
│   │   ├── capabilities/           # Permission grants (shell, notification, store)
│   │   └── Cargo.toml              # tauri v2, shell/notification/store plugins
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.ts
├── scripts/
│   ├── update-scraper.sh           # Pull upstream scraper-service changes
│   └── build-sidecar.sh            # PyInstaller -> platform-named binary
├── run.py                          # Entry point (port discovery, tray, uvicorn)
├── pyproject.toml                  # Python deps (uv-managed)
└── .env                            # Local config (not committed)
```

---

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Desktop Shell** | Tauri v2 (Rust) | 2.x |
| **Frontend** | React + TypeScript + Vite | React 19, TS 5.7, Vite 6 |
| **Styling** | Tailwind CSS + shadcn/ui | TW 3.4 |
| **Python Runtime** | Python | 3.13+ |
| **API Framework** | FastAPI + Uvicorn | Latest |
| **Auth** | Supabase Auth | OAuth (Google, GitHub, Apple) + email |
| **Database** | PostgreSQL (optional local cache) | asyncpg |
| **Remote Scraper** | REST API at scraper.app.matrxserver.com | httpx |
| **Scraping** | httpx, curl-cffi, Playwright, BeautifulSoup, PyMuPDF | See pyproject.toml |
| **Search** | Brave Search API | Optional |
| **Package Manager (JS)** | npm | 10.x |
| **Package Manager (Python)** | uv | Latest |

---

## Communication Protocols

### REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/tools/list` | GET | List all available tools |
| `/tools/invoke` | POST | Invoke a tool (stateless session) |

**POST /tools/invoke** body:
```json
{
  "tool": "Scrape",
  "input": { "urls": ["https://example.com"], "use_cache": true }
}
```

**Response:**
```json
{
  "type": "success",
  "output": "Human-readable text output",
  "image": null,
  "metadata": { "status_code": 200, "content_type": "html" }
}
```

REST creates a fresh session per request. State does not persist between calls.

### WebSocket (`/ws`)

Persistent sessions with concurrent tool execution and cancellation.

```json
// Send a tool call
{ "id": "req-1", "tool": "Scrape", "input": { "urls": ["https://example.com"] } }

// Receive result
{ "id": "req-1", "type": "success", "output": "...", "metadata": { ... } }

// Cancel a task
{ "id": "req-1", "action": "cancel" }

// Cancel all running tasks
{ "action": "cancel_all" }

// Ping
{ "action": "ping" }
```

Multiple tool calls run simultaneously on one connection. Each uses its own `id`.

### Remote Scraper Proxy (`/remote-scraper/*`)

The React frontend calls the Python engine's `/remote-scraper/*` routes, which proxy requests to the remote scraper server (`scraper.app.matrxserver.com`). This keeps the `SCRAPER_API_KEY` server-side -- the frontend never talks to the remote server directly.

| Endpoint | Method | Proxies To | Description |
|----------|--------|-----------|-------------|
| `/remote-scraper/status` | GET | `GET /api/v1/health` | Check remote server availability |
| `/remote-scraper/scrape` | POST | `POST /api/v1/scrape` | Scrape URLs via remote server |
| `/remote-scraper/search` | POST | `POST /api/v1/search` | Search via remote server |
| `/remote-scraper/search-and-scrape` | POST | `POST /api/v1/search-and-scrape` | Combined search + scrape |
| `/remote-scraper/research` | POST | `POST /api/v1/research` | Deep research via remote server |

**POST /remote-scraper/scrape** body:
```json
{
  "urls": ["https://example.com"],
  "options": { "use_cache": true }
}
```

Auth: The Python engine attaches `Authorization: Bearer <SCRAPER_API_KEY>` from the env var. No auth header needed from the frontend for these routes. In production, this can be replaced with the user's Supabase JWT.

---

## Tool Reference (23 Tools)

### File Operations

| Tool | Parameters | Description |
|------|-----------|-------------|
| `Read` | `path` | Read file contents |
| `Write` | `path`, `content` | Write/overwrite a file |
| `Edit` | `path`, `old_text`, `new_text` | Find-and-replace in a file |
| `Glob` | `pattern`, `path?` | Find files matching a glob pattern |
| `Grep` | `pattern`, `path?`, `include?` | Search file contents with regex |

### Shell Execution

| Tool | Parameters | Description |
|------|-----------|-------------|
| `Bash` | `command`, `timeout?` | Execute shell command (fg or bg) |
| `BashOutput` | `shell_id` | Read background shell output |
| `TaskStop` | `shell_id` | Kill a background process |

### System

| Tool | Parameters | Description |
|------|-----------|-------------|
| `SystemInfo` | *(none)* | OS, CPU, memory, disk, Python version |
| `Screenshot` | *(none)* | Capture screen (base64 PNG) |
| `ListDirectory` | `path?` | List directory contents |
| `OpenUrl` | `url` | Open URL in default browser |
| `OpenPath` | `path` | Open file/folder in default app |

### Clipboard

| Tool | Parameters | Description |
|------|-----------|-------------|
| `ClipboardRead` | *(none)* | Read clipboard text |
| `ClipboardWrite` | `text` | Write text to clipboard |

### Notifications

| Tool | Parameters | Description |
|------|-----------|-------------|
| `Notify` | `title`, `message` | Native OS notification |

### Network -- Simple

| Tool | Parameters | Description |
|------|-----------|-------------|
| `FetchUrl` | `url`, `method?`, `headers?`, `body?`, `follow_redirects?`, `timeout?` | Direct HTTP from residential IP |
| `FetchWithBrowser` | `url`, `wait_for?`, `wait_timeout?`, `extract_text?` | Playwright headless fetch |

### Network -- Scraper Engine

| Tool | Parameters | Description |
|------|-----------|-------------|
| `Scrape` | `urls[]`, `use_cache?`, `output_mode?`, `get_links?`, `get_overview?` | Full multi-strategy scraper |
| `Search` | `keywords[]`, `country?`, `count?`, `freshness?` | Brave Search API |
| `Research` | `query`, `country?`, `effort?`, `freshness?` | Deep research (search + scrape + compile) |

### File Transfer

| Tool | Parameters | Description |
|------|-----------|-------------|
| `DownloadFile` | `url`, `path` | Download file to local path |
| `UploadFile` | `path`, `url` | Upload local file to URL |

---

## Scraper Engine

The scraper engine is sourced from the `ai-dream` monorepo via **git subtree**. The `scraper-service/` directory is a read-only copy; changes flow one-way from upstream.

### Import Isolation

Both `matrx_local` and `scraper-service` have an `app/` package. The `ScraperEngine` class in `app/services/scraper/engine.py` resolves this conflict by manipulating `sys.modules` to alias the scraper's `app` as `scraper_app` at import time. This means:

- Zero modifications to `scraper-service/` code
- Upstream updates merge cleanly via `./scripts/update-scraper.sh`

### Multi-Strategy Fetching

1. **httpx** -- Fast, lightweight HTTP client
2. **curl-cffi** -- Browser TLS impersonation (bypasses JA3 fingerprinting)
3. **Playwright** -- Full headless browser (Cloudflare Turnstile, JS-heavy sites)

The engine tries strategies in order, escalating only when the simpler approach fails.

### Graceful Degradation

The engine starts with whatever resources are available:

| Resource | Available | Degraded |
|----------|-----------|----------|
| PostgreSQL (`DATABASE_URL`) | Persistent page cache | In-memory TTLCache only |
| Playwright | Full browser fallback | httpx + curl-cffi only |
| Brave API key | Search + Research tools | Search disabled, Scrape works |
| Proxies | Proxy rotation on blocks | Direct requests only |

### Updating the Scraper

```bash
./scripts/update-scraper.sh --local   # From local ai-dream repo
./scripts/update-scraper.sh           # From GitHub
uv sync --extra browser               # If scraper deps changed
```

---

## Remote Scraper Server

The desktop app can delegate scraping to a remote server at `scraper.app.matrxserver.com` instead of (or in addition to) the local scraper engine.

### Architecture

```mermaid
graph LR
  ReactUI["React UI"] -->|"POST /remote-scraper/scrape"| PythonEngine["Python Engine<br/>:22140"]
  PythonEngine -->|"POST /api/v1/scrape<br/>Bearer token"| RemoteServer["Remote Scraper<br/>scraper.app.matrxserver.com"]
  RemoteServer -->|JSON response| PythonEngine
  PythonEngine -->|JSON response| ReactUI
```

### Authentication

The remote server supports dual auth:
1. **API Key** -- `Authorization: Bearer <API_KEY>` (existing, for server-to-server)
2. **Supabase JWT** -- `Authorization: Bearer <supabase_jwt>` (new, for end users)

JWT validation uses the Supabase JWKS endpoint (`https://txzxabzwovsujtloxrus.supabase.co/auth/v1/.well-known/jwks.json`) with ES256 signing. When a Bearer token doesn't match the API key, the server tries JWT validation. Both auth methods coexist.

### Why Proxy Through the Engine?

The React frontend never talks to the remote scraper directly. All requests go through the Python engine's `/remote-scraper/*` proxy routes. This:
- Keeps auth tokens server-side (never exposed to frontend)
- Allows the engine to add request signing, caching, or rate limiting
- Provides a uniform interface whether scraping locally or remotely

### Remote Server API

The remote server provides these endpoints (see `.arman/scraper-api-reference.md` for full docs):

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/health` | Server health and capabilities |
| `POST /api/v1/scrape` | Scrape one or more URLs |
| `POST /api/v1/search` | Search via Brave Search API |
| `POST /api/v1/search-and-scrape` | Search + scrape results |
| `POST /api/v1/research` | Deep research (iterative search + scrape) |
| `GET /api/v1/scrape/stream` | SSE streaming scrape progress |
| `GET /api/v1/config/domains` | Domain-specific scraping configs |

### Local vs Remote Scraping

| Mode | IP | Best For |
|------|-----|----------|
| **Local** (scraper engine) | User's residential IP | Sites blocking datacenter IPs |
| **Remote** (scraper server) | Server infrastructure + proxy rotation | Bulk scraping, parallel jobs |

Both modes coexist. The UI will support toggling between them (not yet implemented).

---

## Authentication

### OAuth Flow (Desktop)

The desktop app uses Supabase Auth with three OAuth providers: Google, GitHub, and Apple.

```mermaid
sequenceDiagram
  participant User
  participant DesktopApp as React UI
  participant Supabase
  participant OAuthProvider as Google/GitHub/Apple

  User->>DesktopApp: Click "Sign in with Google"
  DesktopApp->>Supabase: signInWithOAuth(google)
  Supabase-->>DesktopApp: Redirect URL
  DesktopApp->>OAuthProvider: Open in browser
  OAuthProvider-->>Supabase: Auth callback
  Supabase-->>DesktopApp: Redirect to /auth/callback#tokens
  DesktopApp->>Supabase: setSession(tokens)
  Supabase-->>DesktopApp: Session + User
  DesktopApp->>PythonEngine: API calls with Authorization header
```

### Supabase Configuration Required

In **Supabase Dashboard > Auth > URL Configuration > Redirect URLs**, add:
```
http://localhost:1420/auth/callback
tauri://localhost/auth/callback
```

Ensure Google, GitHub, and Apple providers are enabled in **Auth > Providers**.

### Token Handling

- The React app stores the Supabase session in `localStorage` (managed by `@supabase/supabase-js`)
- All API requests to the Python engine include `Authorization: Bearer <jwt>` via the `EngineAPI.setTokenProvider()` mechanism
- The Python engine can validate the JWT against Supabase for cloud-sync features
- The remote scraper server also validates Supabase JWTs via JWKS endpoint (ES256)

### Shipping Auth Strategy

Supabase acts as an **OAuth 2.1 Server** (https://supabase.com/docs/guides/auth/oauth-server):

1. **Publishable key** -- Safe to embed in the desktop binary (RLS enforced, client-side by design)
2. **User JWT** -- Obtained via Supabase OAuth, used to authenticate with both the local engine and remote scraper server
3. **No embedded API keys** -- The `SCRAPER_API_KEY` is only used in development. In production, the user's Supabase JWT authenticates directly with the scraper server via JWKS validation
4. **JWKS endpoint** -- `https://txzxabzwovsujtloxrus.supabase.co/auth/v1/.well-known/jwks.json`

---

## Desktop App (Tauri)

### Sidecar Lifecycle

In production, the Rust core spawns the Python engine as a child process:

1. `start_sidecar` -- Spawns PyInstaller binary, streams stdout/stderr to Tauri logs
2. React UI polls `localhost:22140` until the engine responds
3. On window close -- Hides to system tray instead of quitting
4. On quit (tray menu) -- Kills the sidecar process, then exits

### System Tray

The app persists in the system tray for receiving background scrape jobs from the cloud. Menu items: Show, Status, Quit.

### Content Security Policy

The Tauri CSP allows connections to:
- `127.0.0.1:*` (local Python engine)
- `*.supabase.co` (auth + database)
- Profile image CDNs (Google, GitHub, Supabase)

---

## Port Discovery

The Python engine uses port **22140** by default (chosen to avoid conflicts with 3000, 5173, 8000, 8001). If taken, it scans 22140-22159.

| Priority | Mechanism |
|----------|-----------|
| 1 | `MATRX_PORT` env var (exact port, no fallback) |
| 2 | Default 22140 |
| 3 | Auto-scan 22140-22159 |

The engine writes connection info to `~/.matrx/local.json`:
```json
{
  "port": 22140,
  "host": "127.0.0.1",
  "url": "http://127.0.0.1:22140",
  "ws": "ws://127.0.0.1:22140/ws",
  "pid": 12345,
  "version": "0.3.0"
}
```

The React frontend scans the port range on startup. Cache the discovered port for the session; re-scan only on connection failure.

---

## Data Persistence

### Current State

- **Scrape cache**: In-memory TTLCache by default. Set `DATABASE_URL` to a PostgreSQL connection string (e.g., your Supabase PostgreSQL) for persistent caching across restarts.
- **Auth tokens**: Persisted in browser `localStorage` by Supabase client.
- **App settings**: Persisted to `localStorage` via `lib/settings.ts`. Tauri Store plugin is available for future native persistence upgrade.
- **Theme**: Managed by `use-theme.ts` hook. Applies `.dark` class to `<html>`, persists preference to `localStorage`, supports system theme detection. Default: dark.
- **Logs**: Rotating files in `system/logs/`.
- **Temp files**: Screenshots, code saves in `system/temp/`.

### Database Architecture

Three separate concerns:

1. **Remote Scraper Server** -- Dedicated server at `scraper.app.matrxserver.com` with its own internal PostgreSQL (domain configs, page cache, failure logs). The DB has **no public port** -- all access is via REST API with `X-API-Key`. The desktop app never connects to this DB directly.
2. **Supabase (Auth)** -- The AI Matrx platform's Supabase instance. Used for authentication only. Desktop app communicates using the publishable key + user JWT. Never use the service role key.
3. **Local Scraper Cache** -- Optional PostgreSQL for the local scraper engine (set `DATABASE_URL` in root `.env`). Defaults to in-memory TTLCache when not set.

### Configuring Database

In `.env`:
```env
DATABASE_URL=postgresql://user:pass@your-scrape-server:5432/scraper_db
```

The scraper engine uses `asyncpg` (PostgreSQL only). Without `DATABASE_URL`, the system works fully but scrape cache is memory-only.

---

## Development Setup

### Prerequisites

- [uv](https://docs.astral.sh/uv/) (Python package manager)
- [Node.js](https://nodejs.org/) 20+ (for desktop frontend)
- [Rust](https://rustup.rs/) (only needed for Tauri production builds)

### Running (Development)

```bash
# Terminal 1: Python engine
cd /path/to/matrx_local
cp .env.example .env   # Configure API_KEY, optionally DATABASE_URL
uv sync --extra browser
uv run playwright install chromium
API_KEY=local-dev uv run python run.py

# Terminal 2: React frontend (Vite dev server)
cd desktop
npm install
npm run dev
# Open http://localhost:1420
```

### Running (Tauri, requires Rust)

```bash
cd desktop
npm run tauri:dev
```

---

## Building for Distribution

### 1. Build the Python sidecar

```bash
cd /path/to/matrx_local
./scripts/build-sidecar.sh
```

This creates a PyInstaller binary and copies it to `desktop/src-tauri/sidecar/` with the correct platform naming.

### 2. Build the desktop app

```bash
cd desktop
npm run tauri:build
```

Outputs: `.dmg` (macOS), `.msi` (Windows), `.AppImage`/`.deb` (Linux).

### 3. CI/CD

Cross-platform builds run via GitHub Actions (see `.github/workflows/build-desktop.yml`). Artifacts are uploaded to GitHub Releases and optionally synced to S3 for download hosting.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_KEY` | Yes | -- | API key for engine access (any value for local dev) |
| `SCRAPER_API_KEY` | No | `""` | API key for remote scraper server (`X-API-Key` header) |
| `SCRAPER_SERVER_URL` | No | `https://scraper.app.matrxserver.com` | Remote scraper server base URL |
| `DATABASE_URL` | No | `""` | PostgreSQL connection string for local scraper cache |
| `BRAVE_API_KEY` | No | -- | Enables Search and Research tools |
| `DATACENTER_PROXIES` | No | -- | Comma-separated proxy list |
| `RESIDENTIAL_PROXIES` | No | -- | Comma-separated proxy list |
| `MATRX_PORT` | No | `22140` | Force a specific port |
| `DEBUG` | No | `True` | Debug mode |
| `LOG_LEVEL` | No | `DEBUG` | Logging level |

### Desktop Environment Variables (`desktop/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Yes | Supabase publishable key (safe to embed, RLS enforced) |

---

## CORS Configuration

The Python engine allows requests from:
- `https://aimatrx.com`, `https://www.aimatrx.com`
- `http://localhost:1420`, `http://localhost:3000-3002`, `http://localhost:5173`
- `http://127.0.0.1:1420`, `http://127.0.0.1:3000-3002`, `http://127.0.0.1:5173`
- `tauri://localhost`

Override via `ALLOWED_ORIGINS` env var (comma-separated).
