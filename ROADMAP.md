# Matrx Local — Feature Roadmap

> **What this is:** A prioritized list of capabilities to build into `matrx_local`, the companion desktop service that bridges AI Matrx web/mobile apps and AI engines to the user's local machine.

> **Why it matters:** Cloud-hosted AI platforms hit a wall when the task requires the user's real filesystem, local network, native hardware, or residential IP. This service is the escape hatch — it runs on the user's machine and exposes a secure, tool-based API that the web app and AI agents can call in real time over WebSocket or REST.

---

## What's Already Built (v0.3)

| Area | Tools / Endpoints | Status |
|------|------------------|--------|
| **File Operations** | `Read`, `Write`, `Edit`, `Glob`, `Grep` | Done |
| **Shell Execution** | `Bash` (fg + bg), `BashOutput`, `TaskStop` — full Windows (PowerShell) + macOS/Linux (zsh/bash) | Done |
| **System** | `SystemInfo`, `Screenshot`, `ListDirectory`, `OpenUrl`, `OpenPath` | Done |
| **Clipboard** | `ClipboardRead`, `ClipboardWrite` — cross-platform via pyperclip | Done |
| **Notifications** | `Notify` — native OS notifications via plyer (macOS, Windows, Linux) | Done |
| **Scraping (Simple)** | `FetchUrl` (httpx, residential IP), `FetchWithBrowser` (Playwright headless) | Done |
| **Scraping (Advanced)** | `Scrape` (multi-strategy, Cloudflare-aware, caching), `Search` (Brave API), `Research` (search + scrape + compile) | Done (v0.3) |
| **File Transfer** | `DownloadFile`, `UploadFile` — chunked streaming via httpx | Done |
| **Transport** | WebSocket (`/ws`) with per-connection sessions, concurrent dispatch, cancellation | Done |
| **Transport** | REST (`/tools/invoke`, `/tools/list`) — stateless, one-shot | Done |
| **Packaging** | PyInstaller `.spec` for macOS `.app` / Windows `.exe` / Linux binary | Done |
| **Auto-Update** | tufup integration in startup — checks remote server, applies updates, restarts | Done |
| **Scraper Engine** | Full `scraper-service` integrated via git subtree — orchestrator, fetcher (httpx/curl-cffi/Playwright), parser, cache, domain config, Brave Search | Done (v0.3) |
| **Legacy Routes** | `/trigger`, `/system/info`, `/files`, `/screenshot`, `/db-data`, `/logs`, `/generate-directory-structure/*` | Done (pre-tool-system) |
| **Services (stubs)** | `audio/recorder`, `screenshots/capture` | Partial |
| **Services (empty)** | `ai/`, `audio/player`, `files/explorer`, `files/uploader`, `transcription/transcribe`, `tts/player` | Placeholder only |

**23 tools total across 7 categories.**

---

## Priority 1 — High Impact, Moderate Effort

### 1. Scraping Enhancements (builds on v0.3 scraper engine)

The core scraper engine is integrated. These additions would extend it:

- **`ScrapeStructured`** — Given a URL and extraction rules (CSS selectors, XPath, or a natural language description for the AI to interpret), return structured JSON data. Supports pagination.
- **`BrowserSession`** — Persistent browser context for multi-step scraping workflows. Login once, then scrape protected pages across multiple tool calls in the same session.
- **`CookieExport`** — Export cookies from the user's installed browsers (Chrome, Firefox, Safari) for use in fetch requests. Lets AI agents make authenticated requests as the user.
- **`ProxyRelay`** — Expose a local SOCKS5/HTTP proxy endpoint that the cloud server can tunnel requests through. The user's machine becomes a relay node for the platform's scraping infrastructure.

### 2. Clipboard Enhancements

`ClipboardRead` and `ClipboardWrite` are done. Still needed:

- **`ClipboardWatch`** — Stream clipboard changes in real time (user copies something, AI sees it immediately)

### 3. Notification Enhancements

`Notify` is done. Still needed:

- **`NotifyWithAction`** — Notification with clickable action buttons that send a response back to the AI
- **`AlertDialog`** — Show a native dialog (confirm/cancel, input prompt) and return the user's choice

### 4. File Transfer Enhancements

`DownloadFile` and `UploadFile` are done. Still needed:

- **`SyncDirectory`** — Two-way sync between a local directory and a Supabase Storage bucket. Configurable ignore patterns.

---

## Priority 2 — High Impact, Higher Effort

### 5. Audio I/O Pipeline

Build on the existing `recorder.py` stub:

- **`AudioRecord`** — Record from microphone with configurable duration, sample rate, format. Return audio file path or base64-encoded audio.
- **`AudioPlay`** — Play an audio file or audio stream on the user's speakers/headphones.
- **`AudioStream`** — Real-time bidirectional audio streaming over WebSocket. This is the foundation for voice-mode AI conversations.
- **`AudioDeviceList`** — List available audio input/output devices.
- **`AudioTranscribe`** — Local speech-to-text using Whisper (runs on user's hardware, no API cost, no data leaves the machine).

### 6. Process & Application Management

- **`ProcessList`** — List running processes with CPU/memory usage
- **`ProcessKill`** — Kill a process by PID or name
- **`AppLaunch`** — Launch an application by name or path
- **`AppFocus`** — Bring an application window to the foreground
- **`AppList`** — List installed applications
- **`WindowList`** — List open windows with titles and positions

### 7. Local AI Model Execution

- **`ModelLoad`** — Load a local GGUF/ONNX model into memory using llama.cpp or similar
- **`ModelInfer`** — Run inference on a loaded model (text generation, embeddings)
- **`ModelList`** — List available local models and their status
- **`ModelUnload`** — Free GPU/RAM by unloading a model

### 8. Screen & Input Automation

- **`ScreenCapture`** — Capture a specific window, region, or the full screen (builds on existing Screenshot)
- **`ScreenRecord`** — Record screen to video file with optional audio
- **`MouseClick`** — Click at coordinates, with optional modifier keys
- **`MouseMove`** — Move cursor to coordinates or relative offset
- **`KeyboardType`** — Type text with proper key events
- **`KeyboardShortcut`** — Press key combinations (Cmd+C, Ctrl+Alt+Del, etc.)

---

## Priority 3 — Valuable, Build When Needed

### 9. Git Operations

- **`GitStatus`**, **`GitDiff`**, **`GitCommit`**, **`GitLog`**, **`GitBranch`**, **`GitClone`**

### 10. Database Access (Local)

- **`DbQuery`**, **`DbSchema`**, **`DbExport`**, **`DbImport`**

### 11. Network Utilities

- **`PortScan`**, **`DnsLookup`**, **`HttpTest`**, **`NetworkInfo`**, **`SpeedTest`**

### 12. Docker / Container Management

- **`DockerPs`**, **`DockerLogs`**, **`DockerExec`**, **`DockerCompose`**, **`DockerBuild`**

### 13. Environment & Config Management

- **`EnvRead`**, **`EnvSet`**, **`DotenvRead`**, **`DotenvWrite`**, **`SshKeyList`**, **`SshTest`**

### 14. PDF / Document Processing

- **`PdfExtract`**, **`PdfGenerate`**, **`OcrImage`**, **`DocConvert`**

Note: PDF text extraction and image OCR are already available through the scraper engine's content extractors (PyMuPDF, Tesseract). These tools would provide direct access outside of the scraping workflow.

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

Example: The scraper engine is a service (`app/services/scraper/engine.py`) that manages the orchestrator lifecycle. The `Scrape`, `Search`, and `Research` tools are thin wrappers that delegate to it.

### Scraper Engine Integration

The `scraper-service/` directory is a **git subtree** from the `ai-dream` monorepo. It is never edited in this repo — updates flow one-way via `./scripts/update-scraper.sh`. The `ScraperEngine` class in `app/services/scraper/engine.py` handles the `sys.modules` isolation needed to avoid import conflicts between the two `app/` packages.

### WebSocket Session State

The `ToolSession` object persists across tool calls within a single WebSocket connection. This is critical for:

- Working directory tracking (cd persists)
- Background process management
- Browser session persistence (scraping)
- Audio stream handles

REST calls get a fresh session each time — use WebSocket for stateful workflows.
