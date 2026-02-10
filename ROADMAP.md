# Matrx Local — Feature Roadmap

> **What this is:** A prioritized list of capabilities to build into `matrx_local`, the companion desktop service that bridges AI Matrx web/mobile apps and AI engines to the user's local machine.

> **Why it matters:** Cloud-hosted AI platforms hit a wall when the task requires the user's real filesystem, local network, native hardware, or residential IP. This service is the escape hatch — it runs on the user's machine and exposes a secure, tool-based API that the web app and AI agents can call in real time over WebSocket or REST.

---

## What's Already Built (v0.2)

| Area | Tools / Endpoints | Status |
|------|------------------|--------|
| **File Operations** | `Read`, `Write`, `Edit`, `Glob`, `Grep` | Done |
| **Shell Execution** | `Bash` (fg + bg), `BashOutput`, `TaskStop` — full Windows (PowerShell) + macOS/Linux (zsh/bash) | Done |
| **System** | `SystemInfo`, `Screenshot`, `ListDirectory`, `OpenUrl`, `OpenPath` | Done |
| **Clipboard** | `ClipboardRead`, `ClipboardWrite` — cross-platform via pyperclip | Done |
| **Notifications** | `Notify` — native OS notifications via plyer (macOS, Windows, Linux) | Done |
| **Scraping Proxy** | `FetchUrl` (httpx, residential IP), `FetchWithBrowser` (Playwright headless) | Done |
| **File Transfer** | `DownloadFile`, `UploadFile` — chunked streaming via httpx | Done |
| **Transport** | WebSocket (`/ws`) with per-connection sessions, concurrent dispatch, cancellation | Done |
| **Transport** | REST (`/tools/invoke`, `/tools/list`) — stateless, one-shot | Done |
| **Packaging** | PyInstaller `.spec` for macOS `.app` / Windows `.exe` / Linux binary | Done |
| **Auto-Update** | tufup integration in startup — checks remote server, applies updates, restarts | Done |
| **Legacy Routes** | `/trigger`, `/system/info`, `/files`, `/screenshot`, `/db-data`, `/logs`, `/generate-directory-structure/*` | Done (pre-tool-system) |
| **Services (stubs)** | `audio/recorder`, `screenshots/capture` | Partial |
| **Services (empty)** | `ai/`, `audio/player`, `files/explorer`, `files/uploader`, `transcription/transcribe`, `tts/player` | Placeholder only |

---

## Priority 1 — High Impact, Moderate Effort

### 1. Web Scraping Proxy

**Why this is the #1 priority:** Users' residential IPs get dramatically better results than data-center proxies. Anti-bot systems (Cloudflare Turnstile, DataDome, PerimeterX, Akamai) treat residential traffic as legitimate. Running scraping through the user's machine means:

- No CAPTCHAs or JS challenges in most cases
- Access to geo-restricted content based on the user's real location
- No proxy costs — the user's own connection is the proxy
- Logged-in scraping — the user's own browser cookies and sessions are available

**Capabilities to build:**

- **`FetchUrl`** — Simple HTTP fetch from the local machine (GET, POST, etc.) with full request/response passthrough (headers, cookies, status codes, body). The web app sends the request spec, `matrx_local` executes it using the user's IP, returns the result.
- **`FetchWithBrowser`** — Full headless browser fetch via Playwright for JS-rendered pages. Waits for content, handles SPA navigation, returns rendered DOM.
- **`ScrapeStructured`** — Given a URL and extraction rules (CSS selectors, XPath, or a natural language description for the AI to interpret), return structured JSON data. Supports pagination.
- **`BrowserSession`** — Persistent browser context for multi-step scraping workflows. Login once, then scrape protected pages across multiple tool calls in the same session.
- **`CookieExport`** — Export cookies from the user's installed browsers (Chrome, Firefox, Safari) for use in fetch requests. Lets AI agents make authenticated requests as the user.
- **`ProxyRelay`** — Expose a local SOCKS5/HTTP proxy endpoint that the cloud server can tunnel requests through. The user's machine becomes a relay node for the platform's scraping infrastructure.

### 2. Clipboard Integration

- **`ClipboardRead`** — Get current clipboard contents (text, image, file references)
- **`ClipboardWrite`** — Write text or image to clipboard
- **`ClipboardWatch`** — Stream clipboard changes in real time (user copies something, AI sees it immediately)

Why: Users constantly copy-paste between apps. Having the AI react to clipboard content in real time is a killer UX pattern (e.g., user copies a URL and the AI immediately starts analyzing it).

### 3. Notification / Alert System

- **`Notify`** — Send native OS notifications (macOS Notification Center, Windows Toast, Linux libnotify) with title, body, icon, actions
- **`NotifyWithAction`** — Notification with clickable action buttons that send a response back to the AI
- **`AlertDialog`** — Show a native dialog (confirm/cancel, input prompt) and return the user's choice

Why: AI agents need a way to get the user's attention and ask for confirmation before taking destructive actions. This is also essential for background tasks that complete while the user is in another app.

### 4. File Transfer (Cloud <-> Local)

- **`UploadFile`** — Upload a local file to Supabase Storage or a presigned URL. Supports large files with chunked upload and progress reporting.
- **`DownloadFile`** — Download a file from a URL to a local path. Progress reporting via WebSocket.
- **`SyncDirectory`** — Two-way sync between a local directory and a Supabase Storage bucket. Configurable ignore patterns.

Why: Users need to move files between their machine and the cloud. AI agents need to save generated content locally or upload local files for processing.

---

## Priority 2 — High Impact, Higher Effort

### 5. Audio I/O Pipeline

Build on the existing `recorder.py` stub:

- **`AudioRecord`** — Record from microphone with configurable duration, sample rate, format. Return audio file path or base64-encoded audio.
- **`AudioPlay`** — Play an audio file or audio stream on the user's speakers/headphones.
- **`AudioStream`** — Real-time bidirectional audio streaming over WebSocket. This is the foundation for voice-mode AI conversations.
- **`AudioDeviceList`** — List available audio input/output devices.
- **`AudioTranscribe`** — Local speech-to-text using Whisper (runs on user's hardware, no API cost, no data leaves the machine).

Why: Voice interaction is the fastest-growing AI modality. Running transcription locally is free, private, and low-latency.

### 6. Process & Application Management

- **`ProcessList`** — List running processes with CPU/memory usage
- **`ProcessKill`** — Kill a process by PID or name
- **`AppLaunch`** — Launch an application by name or path
- **`AppFocus`** — Bring an application window to the foreground
- **`AppList`** — List installed applications
- **`WindowList`** — List open windows with titles and positions

Why: AI agents managing a user's workflow need to interact with running applications. "Open my text editor", "kill the hung process", "what's using all my CPU" are common requests.

### 7. Local AI Model Execution

- **`ModelLoad`** — Load a local GGUF/ONNX model into memory using llama.cpp or similar
- **`ModelInfer`** — Run inference on a loaded model (text generation, embeddings)
- **`ModelList`** — List available local models and their status
- **`ModelUnload`** — Free GPU/RAM by unloading a model

Why: Some users have powerful local GPUs. Running certain inference tasks locally (summarization, classification, embedding generation) is faster, cheaper, and more private than round-tripping to a cloud API.

### 8. Screen & Input Automation

- **`ScreenCapture`** — Capture a specific window, region, or the full screen (builds on existing Screenshot)
- **`ScreenRecord`** — Record screen to video file with optional audio
- **`MouseClick`** — Click at coordinates, with optional modifier keys
- **`MouseMove`** — Move cursor to coordinates or relative offset
- **`KeyboardType`** — Type text with proper key events
- **`KeyboardShortcut`** — Press key combinations (Cmd+C, Ctrl+Alt+Del, etc.)

Why: Full desktop automation. An AI agent that can see the screen and control the mouse/keyboard can automate any application, even ones without APIs.

---

## Priority 3 — Valuable, Build When Needed

### 9. Git Operations

- **`GitStatus`** — Get repo status, branch, changed files
- **`GitDiff`** — Get diff of working tree or between commits
- **`GitCommit`** — Stage files and commit with message
- **`GitLog`** — Get commit history
- **`GitBranch`** — Create, switch, list branches
- **`GitClone`** — Clone a repository to a local path

Why: Developer-focused users will want AI agents that can manage their repos. While `Bash` can already do this, purpose-built tools give the AI structured data instead of parsing CLI output.

### 10. Database Access (Local)

- **`DbQuery`** — Run SQL against a local PostgreSQL, MySQL, or SQLite database
- **`DbSchema`** — Inspect tables, columns, types, constraints
- **`DbExport`** — Export query results to CSV/JSON
- **`DbImport`** — Import CSV/JSON into a table

Why: Many users run local databases for development. AI agents that can inspect and query local DBs are incredibly useful for debugging, data analysis, and migrations.

### 11. Network Utilities

- **`PortScan`** — Check which ports are open on the local machine or a target host
- **`DnsLookup`** — DNS resolution, reverse lookup, record types
- **`HttpTest`** — Send arbitrary HTTP requests and get detailed response info (timing, headers, TLS)
- **`NetworkInfo`** — Local IP, public IP, active connections, interfaces
- **`SpeedTest`** — Measure download/upload speed

Why: Debugging network issues is one of the most common developer tasks. These tools also feed into the scraping proxy — knowing the user's network state helps optimize scraping strategies.

### 12. Docker / Container Management

- **`DockerPs`** — List running containers
- **`DockerLogs`** — Get container logs
- **`DockerExec`** — Run a command inside a container
- **`DockerCompose`** — Start/stop/restart compose projects
- **`DockerBuild`** — Build an image from a Dockerfile

Why: Developers working with containers need quick access from the AI to inspect and manage their local Docker environment.

### 13. Environment & Config Management

- **`EnvRead`** — Read environment variables (with optional filtering for safety)
- **`EnvSet`** — Set environment variables for the session
- **`DotenvRead`** — Read a .env file
- **`DotenvWrite`** — Write/update a .env file
- **`SshKeyList`** — List SSH keys
- **`SshTest`** — Test SSH connectivity to a host

Why: AI agents setting up dev environments, configuring services, or debugging connection issues need access to environment configuration.

### 14. PDF / Document Processing

- **`PdfExtract`** — Extract text, tables, images from PDFs (local, no API cost)
- **`PdfGenerate`** — Generate PDFs from HTML/Markdown
- **`OcrImage`** — OCR text from images using Tesseract or similar
- **`DocConvert`** — Convert between document formats (docx, pdf, html, md)

Why: Document processing is a Python strength. Running it locally is free and private. This is one of the clearest cases for the Python microservice pattern described in the engineering constitution.

---

## Security Considerations

Every tool above runs with the user's full system permissions. Before shipping:

- **Allowlists over blocklists** — Default-deny for file system access outside approved directories
- **Confirmation prompts** — Destructive operations (file delete, process kill, env write) should require user confirmation via the `NotifyWithAction` / `AlertDialog` tools
- **Rate limiting** — Prevent runaway scraping or resource exhaustion
- **Audit logging** — Log every tool call with timestamp, tool name, inputs, and result status
- **Auth token** — WebSocket and REST connections should require a locally-generated token that the web app exchanges during pairing
- **Sandboxed browser contexts** — Scraping browser instances should use isolated profiles, not the user's main browser profile (unless explicitly requested for cookie export)

---

## Architecture Notes

### Tool Registration Pattern

Every new capability follows the same pattern:

1. Create a handler function in `app/tools/tools/<category>.py`
2. Function signature: `async def tool_name(session: ToolSession, **params) -> ToolResult`
3. Register in `app/tools/dispatcher.py` → `TOOL_HANDLERS` dict
4. That's it — the tool is immediately available via WebSocket and REST, and AI agents can call it

### Service vs. Tool

- **Tool** = a single, stateless operation that an AI agent or the UI can invoke (lives in `app/tools/tools/`)
- **Service** = a longer-lived capability with its own state management (lives in `app/services/`). Tools may wrap service calls.

Example: `AudioStream` is a service (maintains a live audio connection). `AudioRecord` is a tool that uses the audio service for a one-shot recording.

### WebSocket Session State

The `ToolSession` object persists across tool calls within a single WebSocket connection. This is critical for:

- Working directory tracking (cd persists)
- Background process management
- Browser session persistence (scraping)
- Audio stream handles

REST calls get a fresh session each time — use WebSocket for stateful workflows.
