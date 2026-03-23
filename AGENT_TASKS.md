# Matrx Local -- Task Tracker

> Living document. Every discovered bug, missing feature, or architectural issue gets logged here immediately.
> Check items off as they're resolved. Expand with details as investigation progresses.

---

## 🔴 AGENT PRIORITY QUEUE (updated 2026-03-18)

> Pick tasks from top to bottom. Each is self-contained. Do not start a task that depends on an unresolved one above it.

### P0 — Fix broken core features (ship blockers)

- [x] **Orphaned sidecar processes survive app quit / crash (CRITICAL)** — Fixed 2026-03-23: Multiple root causes identified and fixed:
  1. **Python SIGTERM handler didn't wake main thread**: `_handle_exit` set `_uvicorn_server.should_exit = True` but the main thread was stuck in `time.sleep(1)` in `_wait_forever()`. SIGTERM doesn't raise an exception in a sleeping thread, so the process never actually exited. Fix: replaced `time.sleep()` loop with `threading.Event.wait()`, signal handler now sets `_shutdown_event` which wakes the main thread immediately.
  2. **No shutdown watchdog**: If lifespan teardown hung (stuck Playwright browser, blocked I/O), the process stayed alive forever. Fix: `_schedule_force_exit(15)` spawns a daemon thread that forces `os._exit(1)` after 15 seconds if graceful teardown doesn't complete.
  3. **No parent-death detection**: When Tauri crashed or was force-killed, the sidecar was adopted by PID 1 (launchd) and kept running with ports bound. Fix: `_start_parent_watchdog()` thread checks `os.getppid()` every 2 seconds; if the parent dies (PPID becomes 1 on Unix, or parent PID is gone on Windows), triggers graceful self-termination.
  4. **Rust `stop_sidecar` used SIGKILL instead of SIGTERM**: The `stop_sidecar` Tauri command called `child.kill()` (SIGKILL) directly, bypassing Python's signal handler entirely. Fix: now uses `sigterm_then_kill()` for graceful shutdown.
  5. **Rust startup doesn't clean stale processes**: Starting a new sidecar while an orphan from a previous session was still running caused port conflicts. Fix: `start_sidecar` now calls `kill_orphaned_sidecars()` before spawning.
  6. **Rust shutdown cleanup more robust**: `graceful_shutdown_sync` now calls `kill_orphaned_sidecars()` (pkill/taskkill fallback) as a final step after the CommandChild handle kill, catching any processes whose handles were lost. Also removes the stale `~/.matrx/local.json` discovery file.
  7. **stop.sh network output was misleading**: `lsof -p PID -i` showed system-wide connections, not just the target PID's. Fix: filter with awk to only show lines matching the target PID.
  8. **No Windows stop script existed**: Created `scripts/stop.ps1` — full Windows equivalent of stop.sh with process tree killing, port scanning, PyInstaller temp dir cleanup, and discovery file removal.
  9. **stop.sh now also cleans cloudflared tunnels**: Added step 8 to stop orphaned cloudflared processes tied to Matrx.
  Files: `run.py`, `desktop/src-tauri/src/lib.rs`, `scripts/stop.sh`, `scripts/stop.ps1` (new).

- [x] **Comprehensive shutdown audit — 6 additional cleanup gaps fixed (2026-03-23):**
  1. **Wake word service not stopped in teardown**: Python `WakeWordService.stop()` was never called during lifespan teardown — microphone InputStream and ONNX model leaked. Fix: added Phase S2 in teardown with 3s timeout.
  2. **Scheduled tasks not cancelled**: Active `asyncio.create_task` tasks from scheduler were orphaned on shutdown. `_prevent_sleep_process` subprocess (`caffeinate`/`PowerShell`/`systemd-inhibit`) was never killed. Fix: new `shutdown_scheduler()` function cancels all tasks and kills the subprocess; called in Phase S3.
  3. **File watches not cleaned up**: Global `_watches` dict in `file_watch.py` was never cleared — tasks outlived WebSocket disconnects. Fix: new `shutdown_file_watches()` function; called in Phase S4.
  4. **Document file watcher not stopped**: `sync_engine.start_watcher()` creates a `_watch_task` with `watchfiles.awatch()` that was never stopped. Fix: added `stop_watcher()` call in Phase S4 with 3s timeout.
  5. **Force-exit timer too short**: 15s watchdog vs ~17s+ worst-case teardown. If all services hit their timeouts simultaneously, `os._exit(1)` would fire before clean shutdown completed. Fix: increased to 25s with detailed budget comment.
  6. **LlmProcessHandle was dead code**: The `LlmProcessHandle` (sync Mutex) was initialized as `None` and never written to — the "kill via handle" path in `graceful_shutdown_sync` was unreachable. Fix: added `LlmServerState` parameter to `graceful_shutdown_sync`, uses `tokio::sync::Mutex::try_lock()` to access `LlmServer.stop_blocking()` directly. All 4 call sites updated. Fallback `pkill -9`/`taskkill` still runs as belt-and-suspenders.
  7. **SyncEngine task not awaited**: `_task.cancel()` was called but never awaited — could leave httpx connections half-open. Fix: added `wait_for(task, timeout=2.0)` after cancel.
  Files: `app/main.py`, `app/tools/tools/scheduler.py`, `app/tools/tools/file_watch.py`, `run.py`, `desktop/src-tauri/src/lib.rs`.

- [x] **Windows: local models crash with "llama_params_fit: failed to load model"** — Fixed 2026-03-23: Two-part fix in `build_server_args` (`llm/server.rs`). (1) Backslash → forward-slash normalization for the model path on Windows: llama.cpp's split-GGUF sibling discovery uses string operations on the path to find parts 2 and 3, and mixed separators caused it to mis-derive the directory. (2) Added `--no-mmap` flag on Windows only: `CreateFileMapping` can fail for large split GGUF parts (>2 GB each), producing a silent "failed to load model" that then triggers the confusing `llama_params_fit` error. No impact on macOS/Linux.

- [x] **HuggingFace XET storage: downloads silently fail or produce corrupt files** — Fixed 2026-03-23: HuggingFace's new XET storage system (used by many newer repos) cannot be downloaded with a plain HTTP client — the file is stored as content-addressed chunks that require authentication + the hf_xet SDK to reconstruct. Before this fix, downloads would either fail silently or write garbage to disk. Fix: (1) Rust: `is_xet_url()` helper probes HF with a no-redirect HEAD request before downloading; if the redirect target is `xethub.hf.co`, returns a clear `XET_TOKEN_REQUIRED` / `XET_TOKEN_INVALID` error instead of attempting the download. (2) Rust: `hf_token` loaded from `llm.json` and injected as `Authorization: Bearer` on all HF requests (download + HEAD probes). With a valid token, HF returns a direct CDN URL instead of an XET endpoint. (3) Rust: `save_hf_token` / `get_hf_token` Tauri commands persist the token in `llm.json`. (4) TS: `use-llm.ts` exposes `hfToken`, `xetTokenRequired`, `saveHfToken`, `getHfToken`; XET error codes parsed to set `xetTokenRequired` flag. (5) UI: `HfTokenPanel` component in `LocalModels.tsx` — collapsible, auto-expands when a XET download fails, step-by-step instructions (go to hf.co/settings/tokens → create read token → paste here), validates `hf_` prefix, shows "token configured" state. Token is stored locally only, never transmitted except to huggingface.co.



1. [x] **Dashboard: User profile "Not Found"** — Fixed 2026-03-02: Added user profile card to Dashboard.tsx with avatar, name, email, provider. `auth.user` and `auth.signOut` now passed from App.tsx.
2. [x] **Dashboard: Browser Engine "standby"** — Fixed 2026-03-02: Label now shows "Not Installed" (not "Not Found") and install instruction `uv sync --extra browser`. Status uses `playwright_available` from SystemInfo tool.
3. [x] **Documents: New Folder / New Note do nothing** — Fixed 2026-03-19: Full offline-first rewrite. Notes now use filesystem + SQLite (dual store) with zero cloud dependency for CRUD. Supabase sync is manual-only (three modes: push/pull/bidirectional). Per-note sync metadata (status, timestamps) tracked in SQLite V6 migration. Conflict resolution UI with side-by-side diff/merge view. Transcription push-to-note verified working.
3a. [x] **Notes not saving (uuid mismatch)** — Fixed 2026-03-18: `create_note` generated a random `uuid4()` but `update_note` looked up notes using deterministic `uuid5(file_path)`. These never matched → every save returned 404. Fixed: compute ID from `_note_id_for_path(file_path)` in `create_note`. Comprehensive logging added to `update_note`/`get_note`.
3b. [x] **Agents not syncing for logged-in user** — Fixed 2026-03-18: SyncEngine ran `sync_agents()` on startup before the JWT was available, so user prompts were always skipped. Fix: `POST /auth/token` now triggers immediate background `sync_agents()` after saving JWT. Also `initialize()` in `use-engine.ts` now calls `syncTokenToPython()` before `configureCloudSync()` to close the INITIAL_SESSION race. `/chat/agents` also kicks a background sync when builtins exist but user agents are empty and a JWT is stored.
3c. [ ] **Agent not found error when using agents in chat** — `{"detail":"Agent not found: ce657368-415b-4acd-bad6-823cb6752d94"}` — likely caused by agents not syncing (fixed above) or matrx-ai looking up agent by ID in the server DB instead of local SQLite. Needs verification after agent sync fix is deployed.
3d. [ ] **"Local" chat tab missing** — Need a new tab alongside Chat/Co-work/Code that routes messages to local LLM (llama-server) rather than cloud providers.
4. [x] **Documents: Sync bar is cosmetic** — Fixed 2026-03-02: `SyncStatusBar` now always renders (shows "Not configured" placeholder instead of null). Sync button triggers real `triggerSync()` call.
5. [x] **Web search tool: argument errors** — Investigated 2026-03-02: argument mapping is correct (`keywords: list[str]` → `tags` field type). Root cause is `BRAVE_API_KEY` not configured. Add `BRAVE_API_KEY=<key>` to `.env` to enable. Not a code bug.
6. [x] **Notify tool: does nothing** — Fixed 2026-03-02: `notify.py` now has platform-specific fallbacks: macOS (osascript), Windows (PowerShell toast), Linux (notify-send), last resort (log). No longer requires `plyer`.
7. [x] **Record Audio: broken** — Improved 2026-03-02: Better error messages for device-not-found errors (PortAudio errors), including troubleshooting steps for macOS/WSL. Core issue is WSL has no audio device by default.

### P1 — UX improvements (needed before public beta)

8. [x] **Scraping UX overhaul** — Fixed 2026-03-02: Complete rewrite of `Scraping.tsx`. Now: flat URL list on left, independent scrollable content panel on right, `normalizeUrl()` auto-prefixes bare domains with `https://`.
9. [x] **Tool output areas scroll** — Verified 2026-03-02: `ToolOutput.tsx` uses `ScrollArea` with `max-h-[400px]`. `OutputCard.tsx` uses `overflow-auto` with configurable `maxHeight`. Already working.
10. [x] **Tool results shown for action tools** — Fixed 2026-03-02: `ClipboardPanel.tsx` now shows error results (red border + message) in addition to success content.
11. [x] **File picker for path-required tools** — Already implemented: `FilePathField.tsx` uses `@tauri-apps/plugin-dialog` with graceful browser fallback.
12. [x] **Installed Apps: persistent list** — Already implemented: `InstalledAppsPanel.tsx` uses `CACHE_KEY = "matrx:installed-apps"`, loads from localStorage on mount, shows "Showing cached results. Click Refresh to reload." banner, and has an explicit "Refresh" button.

### P2 — Features (important, not blocking)

13. [x] **Dark mode contrast audit** — Verified 2026-03-02: pages/ have no hardcoded `bg-white`/`bg-black`. Dialog overlays in `bg-black/50` are intentional semi-transparent overlays. Clean.
14. [x] **System Info UI** — Fixed 2026-03-02: Added `ResourceGauge` widget cards to Dashboard showing live CPU%, RAM used/total, Disk used/total, Battery% (with 10s auto-refresh). Uses `SystemResources` tool.
15. **Scraping persistence** — Still needed. Save completed scrapes to Supabase `scrapes` table.
16. [x] **Scheduler real persistence** — Already implemented: `scheduler.py` persists to `~/.matrx/scheduled_tasks.json` and restores on startup via `restore_scheduled_tasks()` in `main.py`.
17. **Proxy Test Connection** — Waiting on Arman to confirm `MAIN_SERVER` URL.
18. **Forbidden URL list** — Still needed. UI + Supabase `forbidden_urls` table.
19. [x] **Transcribe Audio: live mode** — Fixed 2026-03-02: `AudioMediaPanel.tsx` now has two sub-tabs: "Live Mic" (record → auto-transcribe, or record-only + manual transcribe) and "From File" (path input + transcribe). Duration selector (15s/30s/1m/2m), Whisper model selector (tiny/base/small), error display. Result routing via `lastToolRef` prevents cross-tool contamination.
20. [x] **Browser control UI** — Fixed 2026-03-02: Complete rewrite of `BrowserPanel.tsx`. Now has: (1) Automation tab with ordered step builder (navigate/click/type/extract/screenshot/eval) with add/remove/reorder, run-all with per-step status icons (pending/running/done/error), and inline output; (2) Auto-screenshot toggle captures page after each step; (3) Session indicator (green dot when active, tab count); (4) Live Page View shows latest screenshot with manual refresh; (5) Quick Nav and Console tabs preserved.

### P3 — Polish (nice to have)

21. **First-run wizard** — On first launch (no settings file), show a wizard: Sign in → Engine health → optional capabilities install → done.

---

### Remote Access — Tunnel Persistence (fixed 2026-03-23)

- [x] **Tunnel preference not persisted** — Root cause: `tunnel_enabled` was not in `DEFAULT_SETTINGS` in `settings_sync.py`, so the engine always defaulted to `TUNNEL_ENABLED=False` from `config.py` on every boot regardless of what the user had set in the UI. `POST /tunnel/start` and `POST /tunnel/stop` now call `settings_sync.set("tunnel_enabled", True/False)` immediately after the subprocess starts/stops. The Python engine reads the persisted value from `~/.matrx/settings.json` on startup (Phase 5 of lifespan). Fixed files: `app/services/cloud_sync/settings_sync.py` (added `tunnel_enabled` to DEFAULT_SETTINGS), `app/api/tunnel_routes.py` (persist on start/stop).

- [x] **Frontend tunnel preference not tracked** — `AppSettings` in `settings.ts` had no `tunnelEnabled` field. The UI toggle only called the API but never saved the preference locally or via `saveSetting()`. Fixed: added `tunnelEnabled: boolean` to `AppSettings` and `DEFAULTS`, added `tunnelEnabled` case to `syncSetting()`, updated `mergeCloudSettings()` and `settingsToCloud()`. `Settings.tsx` `handleTunnelToggle` now calls `saveSetting("tunnelEnabled", enable)` after the API call so the preference is consistent across local storage, Python SQLite, and cloud.

- [x] **WebSocket not connected when auth arrives after engine** — If the engine discovered before the user was authenticated, WS was skipped and never retried. The `SIGNED_IN` handler in `use-engine.ts` called `initialize()` but the mutex blocked it when the engine was already "connected". Fixed: SIGNED_IN handler now checks `wsConnectedRef` and calls `engine.connectWebSocket()` directly when the engine is connected but WS is not, without triggering a full re-init.

- [ ] **Health check false-positive disconnects** — `isHealthy()` uses a 2s timeout on `GET /tools/list`. Any response > 2s during heavy tool execution flips status to "disconnected" after the 90s grace period. Consider increasing the health check timeout to 5s or using a dedicated lightweight `/health` endpoint that always responds fast.

- [x] **WS URL missing from Supabase** — `app_instances` only stored `tunnel_url` (REST). Added `tunnel_ws_url` column (migration 006). `instance_manager.update_tunnel_url()` now auto-derives and stores both URLs. `settings_sync.heartbeat()` writes both every 5 minutes. `InstanceInfo` TypeScript type updated. Settings Connected Devices UI now shows and copies both REST + WS URLs.

- [x] **Duplicate RLS policies** — All 3 tables (`app_instances`, `app_settings`, `app_sync_status`) had two identical policies from two migration runs. Duplicate `*_owner` policies removed (migration 007). One policy per table remains.

- [x] **Stale tunnel auto-expiry** — If an engine crashes (SIGKILL/power loss) without running cleanup, `tunnel_active=true` rows would stay live forever and mislead remote clients. Added `expire_stale_tunnels()` DB function + pg_cron job (every 5 min) that clears `tunnel_active`, `tunnel_url`, `tunnel_ws_url` for any instance whose `last_seen` is older than 15 minutes (migration 007).

- [ ] **Quick tunnel URL is ephemeral** — `*.trycloudflare.com` URLs change on every engine restart. Remote clients (mobile app, browser) re-fetch from Supabase's `app_instances.tunnel_url` + `tunnel_ws_url` after each restart. Named tunnel (stable URL) requires a `CLOUDFLARE_TUNNEL_TOKEN` in `.env`.

### AI Provider Keys & Cloud Relay (added 2026-03-22)

- [x] **User API key storage implemented** — `ApiKeysRepo` in `repositories.py` stores per-provider keys in the `app_settings` SQLite blob (base64-obfuscated). `key_manager.py` injects them into `os.environ` at startup and on every save. `GET/PUT/DELETE /settings/api-keys/{provider}` routes wired in `settings_routes.py`. Settings page has an "API Keys" tab (second tab). Chat page amber banner links to Settings when no providers are configured.

- [ ] **Cloud relay auth** — Users should not need their own API keys. Implement a relay service where authenticated users (via Supabase JWT) forward AI requests to our AIDream server, which makes provider calls using platform-owned keys. The `AppContext.api_keys` dict field in `matrx_ai` is a placeholder for per-user key injection — it is not currently wired to provider constructors. Two options: (1) patch `matrx_ai` provider `__init__` methods to check `AppContext.api_keys` before `os.environ`; (2) route through a cloud endpoint that handles provider calls server-side. Blocked until AIDream server relay endpoint is built. Track in ARMAN_TASKS for the server work.

- [ ] **API key rotation reminder** — Add a "last updated" timestamp to stored API keys and show a UI hint after 90 days suggesting the user rotate their key. Requires adding a `{provider}_key_updated_at` field alongside the key in the settings blob.

- [ ] **OS keychain encryption for API keys** — Upgrade from base64 obfuscation to OS-native keychain storage (macOS Keychain / Windows Credential Manager / libsecret on Linux) using Tauri's `tauri-plugin-stronghold` or native Keychain plugin. Significant complexity — implement only if user data security requirements increase.

### Voice — Wake Word System (added 2026-03-18)

- [x] **Wake word architecture implemented** — Whisper-tiny based on-device detection. Rust: `transcription/wake_word.rs` with dedicated AudioCapture thread, 2-second inference windows, cooldown + dismiss state machine. New Tauri commands: `start_wake_word`, `stop_wake_word`, `mute_wake_word`, `unmute_wake_word`, `dismiss_wake_word`, `trigger_wake_word`, `configure_wake_word`, `get_wake_word_mode`, `is_wake_word_running`.
- [x] **Wake word UI implemented** — `WakeWordOverlay` (full-screen lighting animation + canvas voice ring + big transcript text), `WakeWordControls` (VSCode-style control strip in Voice page header), `useWakeWord` hook with `WakeWordUIMode` state machine.
- [x] **Wake word SIGABRT on quit fixed** — `graceful_shutdown_sync` now receives `WakeWordAppState`, sets `running=false`, and sleeps 120ms before dropping the main WhisperContext. All four call sites updated (`restart_for_update`, tray quit, `on_window_event` CloseRequested, `RunEvent::ExitRequested`). Previously the wake word thread's `WhisperContext` was still alive when GGML atexit handlers fired → SIGABRT / macOS crash report.
- [x] **openWakeWord engine added** — Dual-engine wake word system: Whisper-tiny (Rust, built-in) + openWakeWord (Python sidecar, ONNX, ~150ms latency). Engine preference persisted in SQLite via `AppSettingsRepo` key `"wake_word"`. Frontend `useWakeWord` hook transparently routes to the active engine. New dedicated **Wake Word** tab in Voice sidebar with Controls, Configuration, OWW Models library, and Training Guide sections. Default engine: Whisper-tiny. Files: `app/services/wake_word/` (service + models), `app/api/wake_word_routes.py`, `app/api/settings_routes.py` (extended), `desktop/src/pages/WakeWord.tsx`, `desktop/src/hooks/use-wake-word.ts` (extended), `desktop/src/lib/api.ts` (extended), `desktop/src/lib/transcription/types.ts` (extended). Dependency: `openwakeword>=0.6.0` + `onnxruntime>=1.18.0` with tflite-runtime override for Python 3.13+ compatibility.
- [ ] **Wake word: train custom "hey matrix" model** — Use the Training Guide in Voice → Wake Word → Training Guide tab. Generates synthetic samples via Piper TTS, trains a binary classifier, outputs `hey_matrix.onnx` to `~/.matrx/oww_models/`. Expected accuracy: >95% DR at <1 FP/hour after threshold tuning.
- [ ] **Wake word: migrate to sherpa-onnx KWS** — When `sherpa-onnx` 0.1 adds `KeywordSpotter` Rust bindings (tracked in sherpa-onnx issue #3210), replace the whisper-tiny inference loop with the 10 MB streaming Zipformer KWS model for lower latency (~160ms vs 2s) and lower CPU usage.
- [ ] **Wake word: dual WhisperContext memory** — When both wake word and main transcription are active simultaneously, two `WhisperContext` objects are held in memory (~75 MB for tiny.en + N MB for the user's chosen model). This is intentional — whisper.cpp contexts are not thread-safe for concurrent inference, so they cannot be shared. Future: when migrating to sherpa-onnx KWS, memory usage drops to ~10 MB for the KWS model (Zipformer). No code change needed until that migration.
24. [x] **Windows build: engine not reachable / all OPTIONS return 400** — Fixed 2026-03-18: Windows WebView2 (Edge-based) enforces the Private Network Access spec and adds `Access-Control-Request-Private-Network: true` to every preflight from `http://tauri.localhost` to `http://127.0.0.1`. Starlette's CORSMiddleware rejects this with 400 unless `allow_private_network=True` is set. Added to both `app/main.py` and `app/api/chat_routes.py`. Also suppressed the `_ProactorBasePipeTransport / WinError 10054` noise in `run.py` by installing a custom asyncio exception handler on Windows that silently drops pipe reset errors on shutdown.
23. [x] **Noisy Ctrl-C shutdown** — Fixed 2026-03-18: `ScraperEngine.stop()` now suppresses the `scraper_app.core.fetcher.browser_pool` logger during teardown (level→CRITICAL) and wraps the call in `asyncio.wait_for(timeout=5.0)`. The "Connection closed while reading from the driver" tracebacks were expected — Playwright's driver subprocess is killed by SIGINT before `browser.close()` is called. Also fixed a typo in `local_tool_bridge.py` where `self._on_conversation_end` (private, doesn't exist) was registered instead of `self.on_conversation_end`.
22. [x] **Monitoring tools iOS-style UI** — Fully done: `MonitoringPanel.tsx` has `GaugeRing` + `Sparkline` components with 3s auto-refresh, CPU/Memory/Disk/Battery gauges, sparkline history, stats row, and a full process table with kill buttons. Dashboard also has live gauges (10s refresh).

---

## 🔴 NEW — Testing Findings (2026-02-21)

> Full QA pass by Arman. Every item below is an open bug or missing feature.

---

### Dashboard

- [x] **User profile shows "Not Found"** — Fixed 2026-03-02: Added profile card with avatar, name, email, provider, sign-out button.
- [x] **Browser Engine shows "standby"** — Fixed 2026-03-02: Now shows "Not Installed" + `uv sync --extra browser` hint when Playwright unavailable.

---

### Documents

- [x] **New Folder / New Note errors on startup** — Fixed 2026-03-22. Three root causes found and resolved:
  1. **Wrong Supabase API key for PostgREST**: `supabase_client.py` and `settings_sync.py` were sending `sb_publishable_*` as the `apikey` header to PostgREST. PostgREST only accepts JWT-format keys; the publishable key is not a JWT → 404 on every cloud write. Fixed: added `SUPABASE_ANON_KEY` to `config.py` and updated both clients to use it.
  2. **Startup race condition**: `use-documents.ts` computed `engineReady = !!engine.engineUrl` as a snapshot at render time. If the user navigated to Notes while the engine was still starting (WebSocket disconnect 1006 + SSE stream errors during the ~30s engine boot), `engineReady` was false and the hook never retried. Fixed: `useDocuments` now accepts `engineStatus` prop; the `useEffect` re-fires when `engineStatus` transitions to `"connected"`.
  3. **Noisy cloud failures in stderr**: Supabase push errors were logged at WARNING level with `exc_info=True`, flooding stderr (shown as sidecar IPC errors). Cloud sync failure is non-critical — all cloud write failures downgraded to DEBUG level.
- [x] **Sync bar claims "Connected" but does nothing** — Fixed 2026-03-02: `SyncStatusBar` always renders now (with "Not configured" placeholder). Sync button triggers real sync.
- [x] **Notes not saving (all updates returning 404)** — Fixed 2026-03-18: UUID mismatch between create and update. See 3a above.

- [x] **Notes system hardened for local-first architecture** — Fixed 2026-03-23: Comprehensive overhaul:
  1. **Local version history** — Added SQLite migration V7 (`note_versions` table gets `label`, `version_number`, `change_source` columns). New `NoteVersionsRepo` class. Version snapshots auto-created on every content edit. Version history and revert now work fully offline.
  2. **Cloud decoupled** — Supabase `httpx` timeout reduced from 30s to 15s (5s connect). `get_note` and `update_note` cloud fallbacks wrapped in `asyncio.wait_for(timeout=5.0)`. Cloud operations never block local CRUD.
  3. **Append conflict resolution** — New `append` resolution strategy: combines local + cloud content with separator. Available in both backend (`sync_engine.py`) and frontend (`ConflictResolver.tsx`).
  4. **Version history available offline** — `list_versions` endpoint returns local versions first, merges cloud versions when available. Version history button now visible in local-only mode (removed `userId` gate).
  5. **Revert works offline** — `revert_note` checks local SQLite first, falls back to cloud only if needed. No longer requires cloud sync to be configured.
  6. **Voice push-to-note hardened** — Added empty transcript guard and better logging. Pipeline uses local-only `engine.createNote("local", ...)` which was verified working through the local-first route.
  7. **Frontend types updated** — `DocVersion` fields made optional for local version compatibility. Conflict resolution types include `append`.

---

### Scraping

- [ ] **No persistence — scrapes not saved anywhere** — Still open. Add Supabase `scrapes` table + migration.
- [x] **UX: URL list should be flat, not batched with tabs** — Fixed 2026-03-02: Complete rewrite. Flat URL list left, content panel right, no tabs.
- [x] **Content panel does not scroll** — Fixed 2026-03-02: Content panel now has `overflow-auto` with independent scroll.
- [x] **Auto-prefix URLs with https://** — Fixed 2026-03-02: `normalizeUrl()` in Scraping.tsx auto-prefixes bare domains.

---

### Tools Page

- [ ] **Tools UI is not user-friendly** — PR #1 (`codex/create-user-friendly-ui-for-tools-tab`) exists. Pull and review.
- [x] **Monitoring tools need iOS-style UI** — `MonitoringPanel.tsx` has `GaugeRing` + `Sparkline` components, 3s live refresh, process table with kill buttons. Fully done.
- [x] **Browser control tool: no order/structure + no visible session** — Done: step builder with status icons, session indicator, auto-screenshot, live page view.
- [x] **Large text output areas don't scroll** — Verified: `ToolOutput` uses `ScrollArea(max-h-400)`, `OutputCard` uses `overflow-auto`. Already working.
- [x] **Scheduler is fake / no persistence** — Already implemented: persists to `~/.matrx/scheduled_tasks.json`.
- [x] **Tool results not shown for action tools** — Fixed 2026-03-02: ClipboardPanel shows error results. Other panels already showed results.
- [x] **Web search tool: argument errors** — Investigated: argument mapping correct. Root cause: `BRAVE_API_KEY` not set in `.env`. Add it to enable.
- [x] **Record Audio: broken, gives errors** — Improved 2026-03-02: Better error messages. Core issue: no audio device in WSL/headless. Works on macOS/Windows with sounddevice installed.
- [x] **Transcribe Audio: needs live transcription mode** — Done: two tabs (Live Mic + From File), auto-transcribe on stop, model selector, duration selector.
- [x] **Notify tool: does nothing** — Fixed 2026-03-02: platform-specific fallbacks (osascript/PowerShell/notify-send/log).
- [ ] **Installed Apps: needs persistent list with refresh** — Still open.
- [x] **Path-required tools (ImageOCR, etc.) need a file picker** — Already implemented: `FilePathField.tsx` uses Tauri dialog with browser fallback.

---

### Ports

- [x] **"Grace Kill" text is invisible in dark mode** — Fixed 2026-03-02: replaced `bg-white/*` and `bg-black/*` tokens with semantic `bg-muted`/`border-border` throughout Ports.tsx.

---

### Settings — General

- [ ] **Verify "Launch on Startup" actually works** — The toggle sets the OS entry, but has it been confirmed to actually relaunch on login? Needs an end-to-end test.
- [ ] **Verify "Minimize to Tray" actually works** — The Rust command is wired, but needs confirmation the window actually goes to tray and can be reopened.
- [ ] **"Engine" concept needs clarity + reliability** — Settings shows "Engine Port", "Reconnect", "Restart" buttons. Does restarting the engine actually restart the Python sidecar reliably for end users? Needs confirmation + error handling if it fails.

---

### Settings — Proxy

- [ ] **"Test Connection" is fake / misleading** — The button currently returns a local success response. A real test must: (1) call our main Python server at `MAIN_SERVER` (env var, do NOT hardcode), (2) have the server send a SEPARATE, independent request back to this client, (3) only mark as "Connected" after that callback is confirmed. Add `MAIN_SERVER` env var (e.g. `https://server.app.matrxserver.com` — Arman to confirm correct URL).

---

### Settings — Scraping

- [ ] **Verify headless mode actually does something** — The toggle must be confirmed to switch Playwright to `headless=True/False` at runtime.
- [ ] **Add forbidden URL list** — A UI-managed list of URLs that are forbidden from being scraped, even if requested. List must sync to Supabase (per user).

---

### Settings — Cloud Account

- [ ] **Cloud sync broken: 404 on `app_settings` table** — Error: `404 Not Found` for `/rest/v1/app_settings`. Migration 002 is marked run in ARMAN_TASKS. If 404 persists: **Arman task** — verify in Supabase SQL Editor that `app_settings` exists and RLS allows `auth.uid() = user_id`. Possible causes: migration run on different project, RLS blocking, wrong URL.
  ```
  Sync error: Client error '404 Not Found' for url
  'https://txzxabzwovsujtloxrus.supabase.co/rest/v1/app_settings?user_id=eq.4cf62e4e-...&instance_id=eq.inst_571f36f61346a092f97c6cc31a3ca265&select=*'
  ```
- [x] **User avatar not shown** — Fixed 2026-03-02: expanded Tauri CSP `img-src` to include `lh3.google.com`, `avatars.githubusercontent.com`, and `gravatar.com` for Google/GitHub OAuth avatars.

---

### Settings — About

- [x] **"Open Logs Folder" button doesn't work** — Fixed 2026-03-02: now calls `POST /system/open-folder` with absolute config paths instead of relative OpenPath tool.
- [x] **"Open Data Folder" button doesn't work** — Fixed 2026-03-02: same fix as above.

---

### Global / UI

- [x] **Dark mode color contrast issues (Ports.tsx)** — Fixed 2026-03-02: `bg-white/*`, `bg-black/*`, `border-white/*` replaced with semantic tokens.
- [ ] **Dark mode contrast: audit remaining pages** — Other pages may still have hardcoded light/dark-only colors. Full audit needed.

---

### Missing Features — System Info

- [ ] **No system info UI for end users** — CPU, RAM, disk, battery, etc. are buried in raw JSON tool outputs. Normal users will never find this. Build a proper System Info section (could be a dashboard widget or dedicated page) that shows at minimum: CPU usage, memory usage, disk usage, battery status, and uptime — in a readable, visual format.

---

## Pending / Open

- [ ] **Rate limiting** — No per-user rate limiting on scraper server yet.
- [x] **Prose markdown styling** — `@tailwindcss/typography` installed; NoteEditor uses `prose prose-sm dark:prose-invert` (verified 2026-03-02).
- [ ] **First-run setup wizard**
- [ ] **Job queue for cloud-assigned scrape jobs**
- [ ] **No Alembic migration runner** (only matters if `DATABASE_URL` is set locally)
- [x] **GitHub Actions workflow** — Fixed 2026-03-02: CI builds all 4 platforms, auto-publishes releases (no longer draft), Apple notarization env vars wired. v1.0.0 CI run failed; v1.0.1 fix: changed `--all-extras` → `--extra all` (avoids pyaudio/portaudio.h), added Windows venv path detection in `build-sidecar.sh`.
- [ ] **Wake-on-LAN support**
- [ ] **Smart device control protocols** (HomeKit, Google Home, Alexa APIs)
- [ ] **Reverse tunnel** for cloud→local proxy routing

---

## Investigation / Verification (unconfirmed from code review)

> Tasks for Arman or a specialized agent when code review cannot confirm status.

- [ ] **Cloud sync 404** — ARMAN: In Supabase SQL Editor, run `SELECT * FROM app_settings LIMIT 1`. If table missing, run migration 002. If table exists, check RLS allows `auth.uid() = user_id`.
- [ ] **Launch on Startup** — ARMAN: Toggle on, quit app, log in to OS again. Confirm app auto-starts.
- [ ] **Minimize to Tray** — ARMAN: Toggle on, click window close. Confirm window minimizes to tray (not quits). Reopen from tray.
- [ ] **Proxy Test Connection** — ARMAN: Confirm correct `MAIN_SERVER` URL before implementing real roundtrip test.
- [ ] **Dashboard "User profile Not Found"** — AGENT: Trace where profile data is fetched; identify why it returns Not Found.
- [ ] **Documents New Folder / New Note** — AGENT: Trace button handlers; identify why they have no effect.

---

## Critical / Blocking ✅

- [x] **Engine lifespan hangs when shell DATABASE_URL leaks in** — Fixed in `engine.py` (lines 191-192): sets `DATABASE_URL=""` via `os.environ.setdefault` if not in project env, preventing shell leakage from blocking scraper startup.
- [x] **Missing `supabase.ts`** -- Created with publishable key pattern (default export).
- [x] **No `.env` file for desktop** -- Created and populated with Supabase URL + publishable key.
- [x] **Hardcoded DB credentials** -- `app/database.py` now uses `DATABASE_URL` from `config.py`.
- [x] **Root `.env` created** -- Contains `API_KEY`, `SCRAPER_API_KEY`, `SCRAPER_SERVER_URL`. Fixed leading whitespace.
- [x] **Supabase client updated** -- Uses publishable key (not deprecated anon key). Default export pattern.
- [x] **Auth header mismatch fixed** -- `remote_client.py` was sending `X-API-Key` but scraper server expects `Authorization: Bearer <token>`.

---

## Auth & Shipping Strategy ✅

- [x] **JWT auth added to scraper server** -- Accepts both API key and Supabase JWT via JWKS (ES256).
- [x] **Shipping strategy decided** -- Supabase OAuth, JWT auth on scraper server, no embedded API keys.
- [x] **Deployed to production** -- Scraper-service pushed to main, `SUPABASE_JWKS_URL` set in Coolify.
- [x] **OAuth app registered** -- Client ID `af37ec97-3e0c-423c-a205-3d6c5adc5645`, type `public`.
- [x] **JWT forwarding** -- Proxy routes forward user's JWT from incoming request to scraper server.
- [x] **Auth middleware on Python engine** -- Bearer token required on protected routes. Token stored on `request.state` for forwarding.

---

## Settings Page ✅

- [x] **Theme switching** -- `use-theme.ts` hook manages `.dark` class, persists to localStorage, default dark.
- [x] **Settings persisted** -- `lib/settings.ts` with localStorage backend + native/engine sync.
- [x] **Folder buttons wired** -- Open Logs/Data via engine `OpenPath` tool.
- [x] **Restart Engine** -- Proper sidecar stop/start in Tauri mode.
- [x] **Version dynamic** -- App version from `package.json` via Vite define. Engine version from `/` endpoint.
- [x] **Launch on Startup** -- `tauri-plugin-autostart` added. Toggle in Settings syncs to OS via `enable()`/`disable()`.
- [x] **Minimize to Tray** -- Configurable via `set_close_to_tray` Tauri command. Toggle in Settings controls Rust-side behavior.
- [x] **Headless mode / Request delay** -- Engine settings API (`PUT /settings`). Settings synced on change and on startup.

---

## Remote Scraper Integration ✅

- [x] **`remote_client.py` created** -- HTTP client with `Authorization: Bearer` auth + JWT forwarding.
- [x] **`remote_scraper_routes.py` created** -- Proxy routes at `/remote-scraper/*` with auth forwarding.
- [x] **Config updated** -- `SCRAPER_API_KEY` and `SCRAPER_SERVER_URL` in `app/config.py`.
- [x] **JWT auth on server** -- Scraper server validates Supabase JWTs via JWKS.
- [x] **Frontend integration** -- Scraping page has Engine/Browser/Remote toggle. Remote calls `/remote-scraper/scrape`.
- [x] **`api.ts` methods** -- Added `scrapeRemotely()`, `remoteScraperStatus()`, `RemoteScrapeResponse` type.
- [x] **SSE streaming** -- Proxy routes + `stream_sse()` on engine, `streamSSE()` in frontend API, real-time results in Scraping page.

---

## API / Backend Connections ✅

- [x] **Database connection unified** -- Uses `DATABASE_URL` from config.
- [x] **Health endpoint mismatch** -- `sidecar.ts` now uses `/tools/list`.
- [x] **Remote scraper integration** -- Full proxy + JWT forwarding.
- [x] **Dead `/local-scrape/*` code cleaned up** -- Removed `scrapeLocally()`. `getBrowserStatus()` now uses `SystemInfo` tool fallback.
- [x] **`.gitignore` fixed** -- `desktop/src/lib/` was incorrectly ignored by Python `lib/` pattern. Added negation.
- [x] **Engine settings API** -- `PUT /settings` endpoint for headless mode and scrape delay.

---

## Database & Sync ✅

- [x] **DB strategy clarified** -- Scraper DB is internal-only. All data via REST API with Bearer auth.
- [x] **No Alembic migration runner** -- Only matters if `DATABASE_URL` is set locally.

---

## Supabase Integration ✅

- [x] **Client file** -- `desktop/src/lib/supabase.ts` with publishable key.
- [x] **Env vars** -- `desktop/.env` populated.
- [x] **Auth hooks** -- `use-auth.ts` and `use-engine.ts` updated to use default import.
- [x] **JWKS info captured** -- Key ID `8a68756f`, ES256, JWKS endpoint documented.
- [x] **OAuth app registered** -- Client ID `af37ec97-3e0c-423c-a205-3d6c5adc5645`.

---

## Code Quality ✅

- [x] **Stale closure fixed** in `use-engine.ts` health check.
- [x] **Error boundary added** -- `ErrorBoundary.tsx` wraps entire app in `App.tsx`.
- [x] **Version dynamic** -- App version from package.json, engine version from API.
- [x] **Dead code cleaned** -- Removed `scrapeLocally()`, cleaned unused imports in Scraping.tsx.

---

## Desktop Tool Expansion ✅ (2026-02-20)

- [x] **Process Management tools** -- ListProcesses, LaunchApp, KillProcess, FocusApp (psutil + fallback)
- [x] **Window Management tools** -- ListWindows, FocusWindow, MoveWindow, MinimizeWindow (AppleScript/PowerShell/wmctrl)
- [x] **Input Automation tools** -- TypeText, Hotkey, MouseClick, MouseMove (AppleScript/PowerShell/xdotool)
- [x] **Audio tools** -- ListAudioDevices, RecordAudio, PlayAudio, TranscribeAudio (sounddevice + Whisper)
- [x] **Browser Automation tools** -- BrowserNavigate, BrowserClick, BrowserType, BrowserExtract, BrowserScreenshot, BrowserEval, BrowserTabs (Playwright)
- [x] **Network Discovery tools** -- NetworkInfo, NetworkScan, PortScan, MDNSDiscover (socket + zeroconf)
- [x] **System Monitoring tools** -- SystemResources, BatteryStatus, DiskUsage, TopProcesses (psutil)
- [x] **File Watch tools** -- WatchDirectory, WatchEvents, StopWatch (watchfiles)
- [x] **OS App Integration tools** -- AppleScript, PowerShellScript, GetInstalledApps
- [x] **Scheduler/Heartbeat tools** -- ScheduleTask, ListScheduled, CancelScheduled, HeartbeatStatus, PreventSleep
- [x] **Media Processing tools** -- ImageOCR, ImageResize, PdfExtract, ArchiveCreate, ArchiveExtract
- [x] **WiFi & Bluetooth tools** -- WifiNetworks, BluetoothDevices, ConnectedDevices
- [x] **Dispatcher updated** -- 79 tools registered (dispatcher); LOCAL_TOOL_MANIFEST has 62 for cloud sync
- [x] **Frontend updated** -- Tools page has categories + input templates for all new tools
- [x] **pyproject.toml updated** -- New optional dependency groups: monitoring, discovery, transcription, all
- [x] **Architecture docs updated** -- ARCHITECTURE.md reflects tool count

---

## Documents & Notes Sync ✅ (2026-02-20)

- [x] **Database schema** -- SQL migration for `note_folders`, `note_shares`, `note_devices`, `note_directory_mappings`, `note_sync_log` tables + extensions to `notes`
- [x] **Supabase PostgREST client** -- `app/services/documents/supabase_client.py` with full CRUD
- [x] **Local file manager** -- `app/services/documents/file_manager.py`
- [x] **Sync engine** -- `app/services/documents/sync_engine.py` with push/pull, conflict detection, file watcher
- [x] **Document API routes** -- `app/api/document_routes.py` with 25+ endpoints
- [x] **Document tools** -- ListDocuments, ReadDocument, WriteDocument, SearchDocuments, ListDocumentFolders (5 new tools, 79 total in dispatcher)
- [x] **Documents page** -- Full UI with folder tree, note list, markdown editor (split/edit/preview), toolbar, search
- [x] **Realtime sync** -- `use-realtime-sync.ts` subscribes to Supabase Realtime on notes/folders tables
- [x] **Version history** -- Right panel with version list and one-click revert
- [x] **Sharing** -- Share dialog with per-user permissions + public link support
- [x] **Sync status bar** -- Shows connection state, conflict count, watcher status, file count, last sync time
- [x] **Run SQL migration** -- `migrations/001_documents_schema.sql` run in Supabase ✓
- [x] **Enable Supabase Realtime** -- `notes`, `note_folders`, `note_shares` added to publication ✓

---

## Chat UI with Sidebar ✅ (2026-02-21)

- [x] **Chat page** -- `desktop/src/pages/Chat.tsx` with full chat layout
- [x] **Chat components** -- `ChatInput`, `ChatMessages`, `ChatSidebar`, `ChatToolCall`, `ChatWelcome`
- [x] **Agent picker (prompts parity)** — Updated 2026-03-18: `AgentPicker.tsx` aligned with matrx-admin prompts UX — weighted **multi-token** search (name/description/category/tags/id/variables), **inclusion** chips for category & tags with **No category** / **No tags** (`NONE_SENTINEL`), favorites **All / only / exclude**, **Favorites first** pin (when showing all), sort adds **Category (A–Z)**. Public **`prompt_builtins`** are labeled **Catalog** with **Show** pills: All · Mine · Catalog · Shared. **2026-03-18 UX:** Picker is a **large centered dialog** (~1240×88vh max) with header search, left **Filters** sidebar, and a **responsive card grid** (1/2/3 columns) — not a tiny popover. Reference: `matrx-admin/features/prompts/.../PromptsGrid.tsx`, `DesktopFilterPanel.tsx`, `DesktopSearchBar.tsx`.
- [ ] **Welcome cards → agent IDs + Settings favorites** — Product follow-up (not started): map each `ChatWelcome` suggestion card to a stable agent id, ship defaults, and let users pick favorites in Settings/Preferences.
- [x] **Chat hook** -- `use-chat.ts` with message state, streaming, conversation management
- [x] **Tool schema system** -- `app/tools/tool_schemas.py` — structured tool definitions for AI
- [x] **Chat API routes** -- `app/api/chat_routes.py` for backend chat endpoints
- [x] **Collapsible sidebar** -- Conversation history sidebar with collapse/expand

---

## Local Proxy & Cloud Settings Sync ✅ (2026-02-21)

- [x] **HTTP proxy server** -- `app/services/proxy/server.py` — async forward proxy with CONNECT tunneling
- [x] **Proxy API routes** -- `app/api/proxy_routes.py` — start/stop/status/test endpoints
- [x] **Proxy auto-start** -- Proxy starts on engine startup if `proxy_enabled` is true
- [x] **Proxy settings toggle** -- Settings page has enable/disable toggle, status, stats, test button
- [x] **Cloud sync engine** -- `app/services/cloud_sync/settings_sync.py` — bidirectional sync with Supabase
- [x] **Instance manager** -- `app/services/cloud_sync/instance_manager.py` — stable machine ID, system info collection
- [x] **Cloud sync API routes** -- `app/api/cloud_sync_routes.py` — configure, settings CRUD, sync push/pull, heartbeat
- [x] **Supabase migration** -- `migrations/002_app_instances_settings.sql` with RLS policies
- [x] **Cloud sync on startup** -- `use-engine.ts` configures cloud sync when authenticated
- [x] **Heartbeat** -- 5-minute interval updates `last_seen` in cloud
- [x] **Run SQL migration** -- `migrations/002_app_instances_settings.sql` run in Supabase ✓

---

## Activity Log & Real-Time Monitoring ✅ (2026-02-22)

- [x] **Structured access logger** — `app/common/access_log.py` — JSON-line file (`system/logs/access.log`), 500-entry in-memory ring buffer, SSE subscriber queues
- [x] **Fixed `GET /logs` path bug** — was `"logs/system.log"` (always 404), now uses `Path(LOG_DIR)/"system.log"` from config
- [x] **`GET /logs/access`** — last-N structured access entries as JSON (`?n=100`, max 500)
- [x] **`GET /logs/stream`** — SSE that tails `system.log` in real time
- [x] **`GET /logs/access/stream`** — SSE live-push of structured access entries; keepalive every 15 s
- [x] **Auth `?token=` fallback** — `AuthMiddleware` now accepts token via query param for SSE (`EventSource` cannot set headers)
- [x] **`Activity.tsx` replaced** — two-tab real-time viewer: "HTTP Requests" (structured, filterable, stats bar) + "System Log" (color-coded raw tail)
- [x] **Sidebar** — "Activity" nav item added (`Radio` icon, between Tools and Ports)
- [x] **Integration doc** — `docs/activity-log.md` — full API reference + ready-made React hook for aimatrx.com

> **For aimatrx.com team:** see `docs/activity-log.md` for the SSE stream endpoint, React hook, and cURL examples.

---

---

## Wake Word Developer Training Guide (2026-03-18)

> **For Arman only** — end users receive the pre-trained model bundled in the app.
> This section documents how to train or retrain the "Hey Matrix" openWakeWord model
> so it can be bundled into releases.

### One-time environment setup

```bash
# Create a dedicated training venv (do NOT activate it in the sidecar env)
python3.13 -m venv ~/wakeword-train
source ~/wakeword-train/bin/activate
pip install "openwakeword[train]"   # pulls PyTorch (CPU), piper-tts, ~1GB total
```

### Step 1: Generate synthetic positive samples

openWakeWord includes a TTS pipeline that synthesises thousands of voice variants
automatically. You don't need to record any samples yourself.

```bash
python -m openwakeword.train generate_samples \
  --phrase "hey matrix" \
  --n_samples 5000 \
  --output_dir ~/wakeword-training/positive
```

Runtime: ~10–20 min on CPU. Produces 5000 audio clips in various voices, accents,
speeds, and room simulations.

### Step 2: Download negative samples (once per machine)

```bash
python -m openwakeword.train download_background_data \
  --output_dir ~/wakeword-training/negative
```

~2 GB of speech/noise/music background data. Required once.

### Step 3: Train

```bash
python -m openwakeword.train train \
  --positive_dir ~/wakeword-training/positive \
  --negative_dir ~/wakeword-training/negative \
  --model_name hey_matrix \
  --output_dir ~/.matrx/oww_models/
```

Runtime: ~3–20 min CPU, ~3 min GPU. Produces `hey_matrix.onnx` (~3 MB).

### Step 4: Evaluate and tune threshold

```bash
python -m openwakeword.train evaluate \
  --model_path ~/.matrx/oww_models/hey_matrix.onnx \
  --test_dir ~/my_test_recordings/
```

Recommended thresholds:
- `0.3–0.4` — sensitive, more false positives
- `0.5` — balanced (default)
- `0.7–0.8` — strict, very few false positives

### Step 5: Bundle for release

For pre-release testing: drop `hey_matrix.onnx` into `~/.matrx/oww_models/` and
select it in Voice → Wake Word → OWW Models.

For shipping with the app binary: copy to `desktop/src-tauri/resources/oww_models/hey_matrix.onnx`
and add a `resources` entry in `tauri.conf.json` so it gets bundled:
```json
"bundle": {
  "resources": ["resources/oww_models/**"]
}
```
Then update `app/services/wake_word/models.py` to check the bundled resources path
before `~/.matrx/oww_models/` as a fallback.

_Last updated: 2026-03-18_
