# Matrx Local — Task Tracker

_Last updated: 2026-03-16_

> Living document. Log every discovered bug, issue, and improvement immediately.
> Keep active items concise and actionable. Completed items go in the History section at the bottom.


# New bugs:
- ## Chat
  - Trying to use an agent returns Error: {"detail":"Agent not found: ce657368-415b-4acd-bad6-823cb6752d94"} even for ones I know are ok.
  - We need to incorporate a tab just like chat, co-work, and code, but call it "Local" which will allow us to work with the local models, which we already have in the local models tab but it needs to be here in this ui as well.
  - There is a problem with the agenets and they are not properly synced with my real agents. I need to identify the cause of this. More importantly, since we are trying to sync this and many other things like these, we need a clear and simply way for the user to open a popup that shows the exact current live data from the cloud, the exact local data so we can debug these things.
- 



---

## 🔴 P0 — Blockers (Fix Before Any Shipping)

### ORM / Database Architecture (CRITICAL)
- [x] **`chat_routes.py` dead asyncpg/ORM paths removed** — `_list_models_server()`, `_list_agents_server()`, `_get_supabase_manager()`, and all `SupabaseManager` + asyncpg ORM imports removed from `chat_routes.py`. Both endpoints now read from local SQLite only (2026-03-15).
- [x] **`sync_engine.py` dead ORM paths removed** — `if not has_db(): return` guards and all `matrx_ai` asyncpg ORM import blocks removed. SyncEngine now uses `AIDreamClient` HTTP calls (2026-03-15).
- [ ] **`matrx-ai` engine still uses server-side ORM for `/chat/ai/*` routes** — The AI streaming endpoints (chat, agent, conversation) are mounted from `matrx_ai.app.routers` which internally still uses the asyncpg ORM path. This path requires a direct DB connection and will fail in a shipped binary. Must be fixed before shipping.
  - **Scope:** `build_ai_sub_app()` in `chat_routes.py`, `matrx_ai.app.middleware.auth`, `matrx_ai.app.routers.*`
  - **Approach:** Update `matrx-ai` package to use client mode (PostgREST/AIDream API) for all DB reads in the AI engine routes.
  - **Without this fix:** The app cannot be safely shipped to users.
- [ ] **`tool_sync.py` CLI still uses raw asyncpg SQL** — `app/tools/tool_sync.py` calls `Tools.raw_sql(INSERT INTO tools ...)` via asyncpg. This is a CLI utility, not a live route, but should be updated to use the AIDream server API (`GET /api/ai-tools`) for reads. Track for future cleanup.
- [ ] **matrx-ai registry fetches ALL tools instead of matrx_local only** — `ToolRegistryV2._fetch_tools_async()` calls `get_api_client().get_tools()` with no `source_app` filter, pulling all 146 tools (84 `matrx_ai` + 62 `matrx_local`). Should call `get_tools(source_app="matrx_local")` to hit `GET /api/ai-tools/app/matrx_local`. **Bug is in the `matrx-ai` package** — `_NATIVE_SOURCE_APPS` doesn't include `matrx_local`, and no source_app is passed to `get_tools()`. File a fix upstream in the `matrx-ai` package.
- [ ] **Server-side tools incorrectly tagged `source_app="matrx_ai"`** — 20 tools with `function_path` pointing to `mcp_server.tools.*` are tagged `source_app="matrx_ai"`, causing matrx-ai to classify them as `LOCAL` and fail to import `mcp_server` on the desktop. The correct `source_app` should be something like `"mcp_server"` or `"matrx_server"`. **Bug is in the AIDream server DB data** — fix the `source_app` field for those 20 tools in the tools table. Failing tools: `code_web_store_html`, `core_math_calculate`, `data_sql_*`, `web_search_v1`, `web_read_v1`, etc.

### Cloud Instance Registration
- [ ] **Verify `register_instance` now succeeds** — Hit `GET /cloud/debug` after login. Confirm `is_orphan=false` and `last_registration_result="ok"`. Migration 005 was applied (adds `board_id`, `hardware_uuid`, `serial_number`), but RLS may still block the upsert.
  - If `HTTP 401` → JWT rejected (wrong `aud` claim or expired).
  - If `HTTP 403` / silent empty body → RLS blocking. Run `SELECT auth.uid()` in Supabase SQL Editor with the user's JWT to confirm `sub` resolves.
  - If still broken: add a service-role write route on the engine side (bypasses RLS safely since engine already validates the JWT).
- [ ] **Surface orphan-instance warning in UI** — When `GET /cloud/instances` returns `is_orphan: true`, show a non-blocking banner on Settings/Dashboard with a "Retry Registration" button that calls `POST /cloud/configure` again.

### App Icon
- [ ] **App icon is the default purple box** — Replace all icons in `desktop/src-tauri/icons/` with the AI Matrx logo. Blocks looking legitimate.

---

## 🟠 P1 — Voice Transcription

- [x] **Auto-initialize transcription on app startup** — `lib.rs` `.setup()` now spawns a Tauri async task that reads `transcription.json`, verifies the model file exists, and calls `TranscriptionManager::load()` automatically. The Transcribe tab now shows a loading spinner while the model loads rather than the "Setup Required" dead-end gate.
- [x] **Frontend polling for in-memory model load** — `use-transcription.ts` now polls `get_active_model` every second (max 30s) after mount, updating `activeModel` once Rust confirms the model is resident.
- [x] **"Taking too long? Click to retry" escape hatch** — Transcribe tab loading state includes a manual retry button that calls `initTranscription` directly.
- [x] **Audio device selection in Voice tab** — `AudioCapture::start_with_device(Option<&str>)` added in Rust. `start_transcription` now accepts `device_name: Option<String>` and passes it through. `use-transcription.ts` gained `selectedDevice` state and `setSelectedDevice` action. Voice → Audio Devices tab now shows all devices with Select buttons and persists selection. Voice → Transcribe tab now shows device picker chips and current selection. Previously, transcription always silently used the system default regardless of user choice.
- [x] **Devices page shows all microphones** — Python `tool_list_audio_devices` on macOS now uses `system_profiler SPAudioDataType` as the primary source (CoreAudio sees all devices) and overlays sounddevice indices for recording compatibility. Previously PortAudio/sounddevice only reported one device.
- [x] **Recording sample rate mismatch** — `tool_record_audio` now queries the device's native `default_samplerate` instead of hardcoding 44100. This fixed "Invalid sample rate" failures on devices with 48kHz or other native rates.
- [ ] **VAD integration** — The silero VAD model (`ggml-silero-v6.2.0.bin`) is downloaded but the transcription loop never calls it. The RMS energy gate works but produces false positives. Wire in VAD for accurate speech/silence detection.
- [ ] **selectedDevice persistence** — `selectedDevice` in `use-transcription.ts` resets on page reload. Persist to `localStorage` or the Tauri app config so the user's choice survives navigation.
- [ ] **Multilingual support** — Currently hardcoded to `.en` models. Add model picker that includes multilingual variants (`ggml-base.bin` etc.) for non-English users.
- [ ] **CDN mirror for whisper models** — Models download directly from HuggingFace. Mirror to `assets.aimatrx.com/whisper-models/` before shipping.
  - Files: `ggml-tiny.en.bin` (75MB), `ggml-base.en.bin` (142MB), `ggml-small.en.bin` (466MB), `ggml-silero-v6.2.0.bin` (0.8MB)

**Reference:** `whisper-transcription-integration.md`

---

## 🟠 P1 — Local LLM Inference

- [x] **Sidebar entry added** — "Voice" (Mic icon) and "Local Models" (BrainCircuit icon) both visible in sidebar.
- [x] **llama-server macOS ARM binary** — Downloaded from `ggml-org/llama.cpp` release b8281 and placed at `binaries/llama-server-aarch64-apple-darwin`. Verified it runs (`--version` returns b8281).
- [x] **llama-server dylibs bundled** — All required shared libs (`libggml-*.dylib`, `libllama.dylib`, `libmtmd.dylib`) copied to `binaries/`. Rpath rewritten by `download-llama-server.sh` via `install_name_tool` to `@executable_path` — no `DYLD_LIBRARY_PATH` needed.
- [x] **Split GGUF model support fixed** — llama.cpp b8281+ rejects assembled (concatenated) multi-part GGUF files due to embedded split metadata. Download now stores each part with its original `-00001-of-N` filename. `model_selector.rs` updated: `filename` is the first part, `all_part_filenames()` returns all parts. `list_llm_models` shows the model as one entry; `delete_llm_model` removes all parts. Assembled legacy `qwen2.5-14b-instruct-q4_k_m.gguf` auto-deleted on first startup via `get_llm_setup_status` migration.
- [x] **llama-server startup errors surfaced** — Removed `--log-disable` flag. `server.rs` now captures stdout/stderr via a background task and attaches the most relevant error lines to the timeout error message.
- [x] **Startup timeout increased to 120s** — Was 30s (too short for 14B models). Now 120s with 1s poll interval. 503 (model still loading) is correctly treated as "keep waiting".
- [x] **Loading progress shown in UI** — `isStarting` + `startingModelName` state in `use-llm.ts`. Setup tab and Models tab show a blue "Loading model into memory…" banner with the model filename and an explanation during the wait. `llm-server-starting` Tauri event wired.
- [x] **UI state no longer resets between tabs** — All tab components (`SetupTab`, `ModelsTab`, `InferenceTab`, `ServerTab`, `HardwareTab`, `CustomModelSection`) now consume a shared `LlmContext` instead of each calling `useLlm()` independently. `LocalModels` component calls `useLlm()` once and provides it via context.
- [ ] **End-to-end smoke test** — Download Qwen3-4B or Phi-4-mini, verify server starts, test inference in the Test tab.
- [ ] **Mirror GGUF models to CDN** — `assets.aimatrx.com/llm-models/` with CDN-first + HF fallback.
  - Default model: `Qwen3-8B-Instruct-Q4_K_M.gguf` (~5.2GB). Also mirror Qwen3-4B, Phi-4-mini.
- [ ] **llama-server binaries for other platforms** — Intel Mac, Windows, Linux builds not yet added.
- [ ] **Cloud capability sync** — Sync available local models to Supabase `app_instances`.

**Reference:** `local-llm-inference-integration.md` — full architecture, sidecar config, model catalog, server.rs, commands.rs, Qwen3 tool calling gotchas.

**Critical gotchas from the integration guide:**
- `--jinja` flag is REQUIRED for Qwen3 tool calling — without it, tool calls silently fail
- Never use temperature=0 with Qwen3 (causes endless repetition)
- No streaming when `tools` param is provided — always `stream: false` for tool calls
- GGUF magic bytes are `0x47475546`, NOT the GGML `0x67676d6c` used by Whisper
- On Windows: add `windowsHideConsole: true` to sidecar config to suppress console window

---

## 🟡 P2 — Known Bugs & Issues

### WiFi / Network
- [ ] **WiFi shows "hidden network"** — `WifiNetworks` tool returns the connected network as "hidden" because `airport` CLI doesn't expose the SSID when privacy mode is on. Investigate using CoreWLAN via PyObjC (`objc.lookUpClass("CWWiFiClient")`) to get the real SSID.

### Devices / Camera
- [ ] **Camera capture and video recording** — Now uses `opencv-python` (`cv2`) which is installed. Needs testing end-to-end via `GET /devices/camera` and `POST /devices/record-video`. Screen recording uses system `ffmpeg` (if installed) with `mss` as fallback — also needs testing.

### Dashboard
- [ ] **Status indicators can lag behind actual engine state** — Investigate if the 10s health poll interval is too slow for the UI to feel responsive.

### Settings
- [ ] **`POST /system/open-folder` returns 500** — Clicking "Open Logs/Data Folder" fails. Investigate the error and fix.
- [ ] **"Engine Port" reconnect/restart reliability** — Needs testing after engine port changes.
- [ ] **Proxy Test Connection** — Waiting on `MAIN_SERVER` URL to implement real round-trip test.

### Notes / Documents
- [ ] **`/documents/*` vs `/notes/*`** — Verify React calls use the `/notes/*` canonical path (via `engine.docRequest`) not the old `/documents/*` alias.
- [ ] **Conflict resolution UI** — Needs testing with real simultaneous edits.
- [ ] **`forbidden_urls` table is dead code** — Migration 003 created it in Supabase but nothing reads/writes it. Blocked URLs live in local settings JSON (not synced across devices). Decide: wire to Supabase for cross-device sync, or remove the table.

### Tools
- [ ] **Tools UI is not user-friendly** — PR #1 (`codex/create-user-friendly-ui-for-tools-tab`) needs review and merge.
- [ ] **Some tools lack clear error messages** for missing system dependencies (e.g., tesseract for OCR).
- [ ] **Brave Search must route through AIDream server** — `BRAVE_API_KEY` cannot be embedded in the desktop binary (it would be exposed to all users). The `Search` and `Research` tools in `app/tools/tools/network.py` currently call the Brave API directly using `os.getenv("BRAVE_API_KEY")`. They must be rewritten to call a server-side proxy endpoint on `AIDREAM_SERVER_URL_LIVE` (e.g. `POST /api/search/brave`) that holds the key server-side. The Python engine passes the user's JWT for auth. Remove `BRAVE_API_KEY` from `.env`, `HOWTO.md`, and all references.

### CI/CD & Shipping
- [x] **macOS "did not exit cleanly" crash reports on any quit/force-quit** — Fixed 2026-03-16. Three root causes:
  1. `RunEvent::ExitRequested` was not handled in Rust — OS-triggered termination (Activity Monitor, `kill`, system shutdown) bypassed all cleanup. Added `ExitRequested` arm in the `.run()` closure that calls `graceful_shutdown_sync()` before allowing the exit.
  2. `child.kill()` sent SIGKILL directly (no Python signal handler ran) — Rust now sends SIGTERM first, waits up to 3s for Python to exit cleanly, then falls back to SIGKILL. Requires `libc` dependency (`[target.'cfg(unix)'.dependencies]`).
  3. `os._exit(0)` in Python's `_handle_exit` hard-killed before uvicorn lifespan teardown ran — ports 22140 and 22180 (proxy) stayed bound. Python now sets `_uvicorn_server.should_exit = True` to trigger the FastAPI lifespan shutdown (stops proxy, tunnel, scraper, SQLite) before exiting.
- [ ] **Windows MSI looks outdated** — Consider switching from WiX (.msi) to NSIS (.exe) for a modern install experience.
- [ ] **Verify "Launch on Startup" and "Minimize to Tray"** actually work at the OS level when the setting is toggled.

---

## 🟢 P3 — Future Features

- [ ] **Full VAD integration** — Replace RMS energy gate with Silero VAD for accurate speech detection in transcription loop.
- [ ] **Wake word detection** — Trigger AI agents automatically on a custom wake phrase.
- [ ] **Rate limiting** — Per-user rate limits on the remote scraper server.
- [ ] **Scrape job queue** — Cloud-assigned scrape jobs with status tracking.
- [ ] **Wake-on-LAN / Smart device protocols** — HomeKit, Google Home, Alexa integration.
- [ ] **Reverse tunnel** — cloud→local proxy routing for remote agent control.
- [ ] **Multilingual transcription** — Add non-`.en` Whisper model variants to the model picker.

---

## ✅ COMPLETED — Recent (2026-03-15)

- [x] **`NameError: STATE_FILE / MAPPINGS_FILE` in `file_manager.py`** — Module-level path constants were removed during refactor but still referenced in `load_sync_state`, `save_sync_state`, `load_local_mappings`, `save_local_mappings`. Fixed by adding `_state_file()` and `_mappings_file()` instance methods that resolve paths dynamically via `_notes_dir()`.
- [x] **Env vars missing in PyInstaller binary** — `AIDREAM_SERVER_URL_LIVE`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` were never available in the frozen sidecar (no `.env` file next to binary). Added `app/bundled_config.py` + `scripts/write_bundled_config.py` (runs in CI before PyInstaller) + updated `hooks/runtime_hook.py` to call `apply()` on startup. CI workflow now passes the vars to the sidecar build step.
- [x] **`tauri.conf.json` resources block broke cross-platform builds** — Removed explicit `.dylib` entries from base config; macOS glob in `tauri.macos.conf.json` handles them per-platform.
- [x] **Agent search / user filtering** — Added `user_id`, `category`, `tags`, `is_favorite` columns to `agents` table (migrations V4+V5). `AgentsRepo` and `sync_engine` updated to populate and filter by `user_id`.
- [x] **"Agent not found" error on agent invocation** — Patched `matrx_ai/agents/manager.py` `to_config` methods to handle plain dicts (client mode) not just ORM objects.
- [x] **`matrx-ai` ORM source_app filtering** — Added `source_app="matrx_local"` to `ClientModeConfig`; upstream `matrx-ai` patched to read and forward it.
- [x] **Terminal auto-scroll / log verbosity** — Silenced high-frequency polling routes in `_SILENT_PATHS` and `OPTIONS` preflight requests; WebSocket monitor tools demoted to DEBUG.
- [x] **Dark mode error color** — Fixed `--destructive` CSS variable from dark maroon to readable red.
- [x] **`matrx-ai` init failed with wrong kwargs** — Refactored `initialize_matrx_ai()` to build `ClientModeConfig` correctly.
- [x] **JWT cache warmup** — Added `warm_jwt_cache()` called at async startup; `set/clear_jwt_cache` wired into `token_routes.py`.
- [x] **`/chat/agents` returned 401 before login** — Added to `_PUBLIC_PATHS` in `auth.py`.

## ✅ COMPLETED — Recent (2026-03-12)

### macOS Permissions Full Audit (2026-03-12)
- [x] **`com.apple.security.files.all` entitlement added** — Both `Entitlements.plist` and `sidecar/sidecar.entitlements.plist` now declare Full Disk Access. Without this, FDA TCC grants had no effect in the hardened runtime.
- [x] **`com.apple.security.device.bluetooth` entitlement added** — Added to both plists so CoreBluetooth scanning works on macOS 12+ with the TCC grant.
- [x] **`com.apple.security.personal-information.reminders` entitlement added** — Added to both plists; also added personal-information entitlements for addressbook/calendars/photos to the sidecar plist which was missing them.
- [x] **Deprecated Quartz screenshot APIs replaced** — `system.py` now uses `screencapture -x` CLI as the primary macOS capture path (not deprecated). Quartz (`CGWindowListCreateImage`/`CGDisplayCreateImage`) kept as fallback for macOS < 15 only.
- [x] **Screen recording cross-check restored in `use-permissions.ts`** — When `CGPreflightScreenCaptureAccess()` returns false (known macOS lie-until-restart), the hook now cross-checks via `engine.getDevicePermission("screen_recording")` which uses ScreenCaptureKit (not deprecated Quartz). Status is correctly reported as granted if the engine confirms it.
- [x] **New pyobjc frameworks added** — `pyobjc-framework-Contacts`, `pyobjc-framework-EventKit`, `pyobjc-framework-Photos`, `pyobjc-framework-CoreLocation`, `pyobjc-framework-Speech` added to `pyproject.toml` and verified importing.
- [x] **New Python tool files** — `contacts.py`, `calendar_tools.py`, `photos.py`, `location.py`, `messages.py`, `mail.py`, `speech_recognition_tools.py` all implemented with full macOS-only + graceful fallback on other platforms.
- [x] **Permission checker expanded** — `checker.py` now has `check_contacts()`, `check_calendar()`, `check_reminders()`, `check_photos()`, `check_location()` (real CLLocationManager), `check_messages()` (functional probe), `check_mail()`, `check_speech_recognition()` — all registered in `check_all_permissions()`.
- [x] **New REST endpoints** — `permissions_routes.py` expanded with `/contacts`, `/calendar/events`, `/calendar/reminders`, `/photos`, `/location/current`, `/messages`, `/messages/conversations`, `/messages/send`, `/mail`, `/mail/send`, `/mail/accounts`, `/speech/transcribe`, `/speech/locales`.
- [x] **TypeScript permission keys expanded** — `use-permissions.ts` now has `reminders`, `messages`, `mail`, `speech_recognition` as full `PermissionKey` entries with metadata and `settingsUrl` deep links.
- [x] **`TOOL_PERMISSION_REQUIREMENTS` expanded** — `api.ts` now maps all new tool names to their required permissions.
- [x] **`PermissionsModal.tsx` updated** — New icons (Bell, MessageSquare, Mail, AudioLines) added; new keys inserted in `PERMISSION_ORDER`.

---

### Other (2026-03-12)

- [x] **Repeated macOS permission prompts on every window focus** — `SCShareableContent.getShareableContentWithCompletionHandler_()` was being used as a status check for screen recording. It is an *active capture operation* that triggers the macOS Sequoia 30-day recurring consent dialog every time it is called. Fixed: replaced with `CGPreflightScreenCaptureAccess()` (read-only, no prompt). Removed the engine cross-check in `use-permissions.ts` that called it. Removed the `onFocusChanged` listener that was firing `checkAll()` across 5 simultaneous hook instances on every System Settings round-trip.

- [x] **App crash report on every quit/restart/permission-approval restart** — macOS recorded `EXC_CRASH (SIGABRT)` via `ggml_abort` on every intentional exit. Root cause: `tao`'s `AppState::exit` calls `std::process::exit()` which triggers GGML C library atexit handlers before Rust drops `WhisperContext`. The GGML atexit handler calls `ggml_abort()` → C `abort()` → SIGABRT. Fixed: introduced `graceful_shutdown_sync()` in `lib.rs` that explicitly drops `TranscriptionState` (releasing `WhisperContext` → GGML) and kills the llama-server before any `app.exit(0)` or `app.request_restart()` call. Applied to all three exit paths: tray Quit, window close handler, and `restart_for_update` command.

---

## ✅ COMPLETED — Recent (2026-03-11)

- [x] **`opencv-python` and `mss` added to pyproject.toml** — Camera capture (`cv2.VideoCapture`) and screen recording fallback (`mss`) were imported in `permissions_routes.py` but never declared as dependencies. Added `opencv-python>=4.10.0` and `mss>=9.0.1`; both installed via `uv sync`.
- [x] **Playwright browser pool silently failing** — `PLAYWRIGHT_BROWSERS_PATH` was set only inside a local env dict for the subprocess install command, not in `os.environ`. ScraperEngine Phase 3 launched against the wrong path and silently fell back to a stub pool. Fixed by writing the path into `os.environ` in Phase 0b. Also logged the actual exception (it was being swallowed completely).
- [x] **`UnboundLocalError: importlib` crash on `GET /capabilities`** — `_check_module()` had `import importlib.metadata` inside an `if` branch, making Python treat `importlib` as local throughout the function. `importlib.util.find_spec()` on the else-path then raised `UnboundLocalError`. Fixed by hoisting both imports to module level.
- [x] **Duplicate `POST /cloud/configure`** — `initialize()` and the `onAuthStateChange(INITIAL_SESSION)` listener both fired configure for the same session. Fixed with a timestamp gate: listener skips if configure ran within the last 10s.
- [x] **Migration 005 applied** — Added `hardware_uuid`, `serial_number`, `board_id` columns to `app_instances` via Supabase MCP. Fixed `PGRST204 board_id column not found` error on every cloud configure.
- [x] **`engine.setTokenProvider()` never wired up** — Every authenticated API call returned 401 because the token provider was defined but never registered. Fixed in `useEngine()` via a `useEffect` before `initialize()` runs.
- [x] **WebSocket infinite reconnect loop** — Without a token, server rejected WS with 403, `onclose` triggered `scheduleReconnect()`, looping every 3s forever. Fixed: `initialize()` gates `connectWebSocket()` on session existence; `scheduleReconnect()` returns early if no token; added exponential backoff (3s→60s).
- [x] **AiMatrx iframe not authenticated** — `getSession()` returned stale/expired tokens. Added expiry check: if token expires within 5 minutes, calls `refreshSession()` before building the handoff URL. Added loading spinner.
- [x] **SetupWizard startup race** — `checkStatus()` fired before engine services settled. Fixed with 5-attempt retry loop with exponential backoff.
- [x] **Auto-install on first run** — Setup wizard now auto-triggers install when blocking components aren't ready. `autoInstallFiredRef` prevents looping.
- [x] **Permissions page: no "Open Settings" button** — Added button that opens macOS deep link for every non-granted permission.
- [x] **RAM shows 0.0/0 GB** — Frontend used `memory_*` fields; backend returns `ram_*`. Fixed frontend to read `ram_*` with `memory_*` fallback.
- [x] **Disk shows "12/3722 GB"** — Added smart TB formatting for values ≥ 1000 GB.
- [x] **CPU shows no detail** — Added core count, thread count, and frequency to System Resources card.
- [x] **Printer not found in Connected Devices** — Added `lpstat -p` and Thunderbolt scanning.
- [x] **`deep_link` missing from `PermissionInfo` TypeScript interface** — Added `deep_link?: string | null`.

---

## ✅ COMPLETED — Earlier Work

### Voice Transcription Pipeline (2026-03-11)
- [x] Download validation loop — expanded VALID_WHISPER_MAGIC to cover GGUF format + LE variant; added `sync_all()` after `flush()` to fix macOS write-read race.
- [x] Audio capture wrong sample rate — integrated `rubato` resampler for 44.1kHz/48kHz → 16kHz conversion in `AudioCapture::start()`.
- [x] Silence hallucinations — added RMS energy gate (threshold 0.01) and hallucination string filter.
- [x] 3-second chunks cut words — changed to 5-second sliding window.
- [x] Metal acceleration — changed `default = ["metal"]` in Cargo.toml for Apple Silicon GPU acceleration.
- [x] Duplicate VAD download — removed extra `downloadVadModel()` call in `Voice.tsx`.
- [x] VAD download showed no progress — fixed event listener in `use-transcription.ts`.

### Local-First Architecture (2026-03-03)
- [x] All user content moved to `~/Documents/Matrx/` (Notes, Files, Code). Engine internals stay in `~/.matrx/`.
- [x] `document_routes.py` rewritten: local filesystem first, Supabase fire-and-forget.
- [x] Path aliases added: `@notes`, `@files`, `@code`, `@workspaces`, `@agentdata`, `@user`.
- [x] Router registered at `/notes` (canonical) + `/documents` (backward-compat alias).

### Cloud & Auth (2026-03-02)
- [x] OAuth rewritten to proper OAuth 2.1 PKCE flow with registered client `af37ec97-...`.
- [x] Screen Recording re-prompt bug — replaced `screencapture` probe with `CGPreflightScreenCaptureAccess()`.
- [x] `409` on `register_instance` / `push_to_cloud` — added `?on_conflict=user_id,instance_id`.
- [x] 401 on web→local API calls — fixed API key validation.
- [x] JWT forwarding to remote scraper server.
- [x] Dashboard: live CPU/RAM/Disk/Battery gauges, user profile card.
- [x] Activity: real-time HTTP and system log streaming.
- [x] CI/CD: GitHub Actions for 4-platform builds and releases.
- [x] LLM model download URLs fixed — Phi-4-mini, Qwen2.5-14B split download, Mistral Small 3.1 repo.
