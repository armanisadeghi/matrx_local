# Matrx Local — Backlog

> Features and enhancements not yet implemented. Prioritized, roughly ordered.
> See `ARCHITECTURE.md` for the current system documentation.

---

## ✅ Shipped (moved from backlog)

These were backlog items now implemented as of 2026-02-21:

- **AudioRecord / AudioPlay / AudioTranscribe / AudioDeviceList** — `tools/audio_tools.py` (sounddevice + Whisper)
- **ProcessList / ProcessKill** — `tools/system_tools.py` (psutil)
- **AppLaunch / AppFocus / AppList (GetInstalledApps)** — `tools/system_tools.py`
- **WindowList / FocusWindow / MoveWindow / MinimizeWindow** — `tools/system_tools.py` (AppleScript)
- **MouseClick / MouseMove / KeyboardType (TypeText) / KeyboardShortcut (Hotkey)** — `tools/input_tools.py`
- **ScreenCapture (Screenshot)** — available via browser tools
- **PortScan / NetworkInfo / NetworkScan** — `tools/network_tools.py`
- **PdfExtract / OcrImage (ImageOCR) / ImageResize** — `tools/media_tools.py`
- **ClipboardWatch** — not yet, but clipboard read/write available

---

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

~~**`AudioRecord`** / **`AudioPlay`** / **`AudioStream`** / **`AudioDeviceList`** / **`AudioTranscribe`**~~ ✅ Shipped (stream not yet)

- **`AudioStream`** — Real-time bidirectional audio over WebSocket (voice-mode AI foundation) — still todo

---

## Process and Application Management

~~**`ProcessList`**, **`ProcessKill`**~~ ✅ Shipped
~~**`AppLaunch`**, **`AppFocus`**, **`AppList`**~~ ✅ Shipped
~~**`WindowList`**~~ ✅ Shipped

## Local AI Model Execution

- **`ModelLoad`** / **`ModelInfer`** / **`ModelList`** / **`ModelUnload`** -- Local GGUF/ONNX models via llama.cpp.

## Screen and Input Automation

~~**`ScreenCapture`** (region/window)~~ ✅ Shipped (Screenshot via browser tools)

- **`ScreenRecord`** (video) — not yet
  ~~**`MouseClick`**, **`MouseMove`**, **`KeyboardType`**, **`KeyboardShortcut`**~~ ✅ Shipped

---

## Lower Priority

- **Git Operations** — `GitStatus`, `GitDiff`, `GitCommit`, `GitLog`, `GitBranch`, `GitClone`
- **Database Access** — `DbQuery`, `DbSchema`, `DbExport`, `DbImport`
  ~~**Network Utilities** — `PortScan`, `DnsLookup`, `HttpTest`, `NetworkInfo`, `SpeedTest`~~ (PortScan, NetworkInfo ✅ Shipped; DnsLookup, SpeedTest still todo)
- **Docker Management** — `DockerPs`, `DockerLogs`, `DockerExec`, `DockerCompose`, `DockerBuild`
- **Environment Config** — `EnvRead`, `EnvSet`, `DotenvRead`, `DotenvWrite`, `SshKeyList`, `SshTest`
  ~~**Document Processing** — `PdfExtract`, `OcrImage`~~ ✅ Shipped — `PdfGenerate`, `DocConvert` still todo

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
