# Matrx Local — Task Tracker

_Last updated: 2026-03-11_

> Living document. Log every discovered bug, issue, and improvement immediately.
> Keep active items concise and actionable. Completed items go in the History section at the bottom.

---

## 🔴 P0 — Blockers (Fix Before Any Shipping)

### ORM / Database Architecture (CRITICAL)
- [ ] **Python engine uses server-side ORM DB access** — Works in local dev because env vars are set, but breaks in a built/shipped app. Direct DB access from a user's machine is a security hole (credentials in binary) AND breaks when env vars aren't set.
  - **Chosen fix:** Update ORM usage to use newly available client-side logic. Arman has the documentation for this — get it, implement it.
  - **Affected:** All `/chat/ai/*` routes, `matrx-ai` engine, `initialize_matrx_ai()`, anything touching `supabase_automation_matrix` DB config.
  - **Without this fix:** The app cannot be safely shipped to users.

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

### CI/CD & Shipping
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
