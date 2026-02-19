# Matrx Local -- Backlog

> Features and enhancements not yet implemented. Prioritized, roughly ordered.
> See `ARCHITECTURE.md` for the current system documentation.

---

## Scraping Enhancements

Building on the v0.3 scraper engine:

- **`ScrapeStructured`** -- Given a URL and extraction rules (CSS selectors, XPath, or natural language description), return structured JSON. Supports pagination.
- **`BrowserSession`** -- Persistent browser context for multi-step scraping. Login once, then scrape protected pages across multiple tool calls.
- **`CookieExport`** -- Export cookies from installed browsers (Chrome, Firefox, Safari) for authenticated requests.
- **`ProxyRelay`** -- Expose a local SOCKS5/HTTP proxy so the cloud server can tunnel requests through the user's machine.
- **Chrome profile copy mode** -- Scrape using the user's actual Chrome cookies by copying their profile to a temp directory (see `PROPOSED_ARCHITECTURE.md` patterns for reference).
- **Site warm-up** -- Automated warm-up for sites that block even real browsers on first visit (visit homepage, accept cookies, scroll, build history).

---

## Cloud Integration

- **Job queue** -- Desktop app polls the AI Matrx cloud for pending scrape jobs assigned to this device.
- **WebSocket bridge** -- Real-time job delivery without polling latency.
- **Device registration** -- Register desktop instances with capabilities (scrape, warm-up, etc.) so the cloud routes jobs appropriately.
- **Result sync** -- Push local scrape results back to cloud storage.

---

## Clipboard

- **`ClipboardWatch`** -- Stream clipboard changes in real time.

## Notifications

- **`NotifyWithAction`** -- Notification with clickable action buttons that return user's choice.
- **`AlertDialog`** -- Native confirm/cancel or input prompt dialog.

## File Transfer

- **`SyncDirectory`** -- Two-way sync between local directory and Supabase Storage bucket.

---

## Audio I/O Pipeline

- **`AudioRecord`** -- Record from microphone.
- **`AudioPlay`** -- Play audio on speakers.
- **`AudioStream`** -- Real-time bidirectional audio streaming over WebSocket (foundation for voice-mode AI).
- **`AudioDeviceList`** -- List audio devices.
- **`AudioTranscribe`** -- Local speech-to-text using Whisper (no API cost, no data leaves machine).

---

## Process and Application Management

- **`ProcessList`**, **`ProcessKill`**
- **`AppLaunch`**, **`AppFocus`**, **`AppList`**
- **`WindowList`**

## Local AI Model Execution

- **`ModelLoad`** / **`ModelInfer`** / **`ModelList`** / **`ModelUnload`** -- Local GGUF/ONNX models via llama.cpp.

## Screen and Input Automation

- **`ScreenCapture`** (region/window), **`ScreenRecord`** (video)
- **`MouseClick`**, **`MouseMove`**, **`KeyboardType`**, **`KeyboardShortcut`**

---

## Lower Priority

- **Git Operations** -- `GitStatus`, `GitDiff`, `GitCommit`, `GitLog`, `GitBranch`, `GitClone`
- **Database Access** -- `DbQuery`, `DbSchema`, `DbExport`, `DbImport`
- **Network Utilities** -- `PortScan`, `DnsLookup`, `HttpTest`, `NetworkInfo`, `SpeedTest`
- **Docker Management** -- `DockerPs`, `DockerLogs`, `DockerExec`, `DockerCompose`, `DockerBuild`
- **Environment Config** -- `EnvRead`, `EnvSet`, `DotenvRead`, `DotenvWrite`, `SshKeyList`, `SshTest`
- **Document Processing** -- `PdfExtract`, `PdfGenerate`, `OcrImage`, `DocConvert` (note: PDF/OCR already in scraper engine, these would expose them as standalone tools)

---

## Security (Pre-Ship)

- Allowlists for filesystem access outside approved directories
- Confirmation prompts for destructive operations
- Rate limiting for scraping / resource exhaustion
- Audit logging (every tool call with timestamp, inputs, result)
- Auth token requirement for WS/REST connections
- Sandboxed browser contexts (isolated profiles by default)

---

## Desktop App UX

- Wire Tauri Store to Settings page (persist theme, scrape delay, etc.)
- Auto-updater endpoint configuration
- First-run setup wizard (Playwright install, Chrome detection)
- Comparison view: side-by-side FetchUrl vs FetchWithBrowser vs Scrape for the same URL
