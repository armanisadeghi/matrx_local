# Matrx Local — Task Tracker

> **Living doc.** Add new issues the moment you find them. Mark done items immediately.
> Last cleaned: 2026-03-30.

---

## 🔴 Blocked — Requires External Fix

These cannot be resolved by changes to this repo. They are blocked on upstream packages or external services.

- [ ] **matrx-ai circular import — GenericOpenAIChat completely broken** — `matrx-ai` v0.1.26: importing `GenericOpenAIChat` triggers a circular import: `providers/__init__.py` → `unified_client.py` → `orchestrator/executor.py` → `providers/__init__.py`. Local LLM routing is **completely disabled**. Error: `ImportError: cannot import name 'UnifiedAIClient' from partially initialized module 'matrx_ai.providers'`. Fix must land in the `matrx-ai` package: move the `UnifiedAIClient` import in `orchestrator/executor.py` to a lazy/local import, or restructure `providers/__init__.py`. See `docs/matrx-ai-generic-openai-port.md`. Run `uv sync` after the fix is published.

- [ ] **matrx-ai server-side ORM leaking into desktop** — The `matrx-ai` / chat stack still hits the server-side DB in places. Blocks confident production shipping until client-only/local paths through `matrx-ai` are verified and any server-side assumptions are guarded.

---

## 🟠 Active Bugs & Regressions

Known broken things in the current release that need fixing.

- [x] **Image gen tab: 401 "Authorization header required"** — Fixed 2026-03-31: `imageGenFetch` in `api.ts` did not attach the same `Authorization: Bearer` JWT as other engine calls; auth middleware rejected `/image-gen/*`. Also added client `emitClientLog` on failures, Python `logger.warning` on missing token, and clearer Image tab error UI (sign-in vs HF token vs engine). **Commit and push** these files if not yet on `origin/main`.
- [x] **Image gen E2E audit follow-ups (2026-03-31)** — HunyuanDiT catalog used wrong pipeline (now `hunyuan` + `HunyuanDiTPipeline`); generation no longer holds the service lock for the full diffusion forward pass; HF UI copy points to **Settings → API keys**; `delete_user_key` clears injected `HF_TOKEN` / `HUGGING_FACE_HUB_TOKEN`; removed dead `desktop/src/lib/image-gen/*` client; smoke tests use sentinel ids to avoid accidental multi-GB downloads in CI.
- [x] **Image gen: consumer installer (2026-03-31)** — Replaced "run `uv sync --extra image-gen`" developer error screen with a one-click "Install now" button + real-time progress bar. Packages install into `~/.matrx/image-gen-packages/` (or Windows `%LOCALAPPDATA%\AI Matrx\image-gen-packages\`). `runtime_hook.py` + `main.py` lifespan inject the directory into `sys.path` on engine start. New: `app/services/image_gen/installer.py`, new routes `POST /image-gen/install`, `GET /image-gen/install/status`, `GET /image-gen/install/stream` (SSE), new `ImageGenInstaller` component in `LocalModels.tsx`.

- [ ] **Health check false-positives on slow engine start** — `isHealthy()` in `api.ts` and Rust's `check_engine_health` both call `/tools/list` with a 2-second timeout. Heavy first-load (scraper init, model warmup) can exceed 2 s and incorrectly flip the engine to "disconnected" in the UI. Fix: either switch to a lightweight `/health` endpoint, or increase the timeout to 5–8 s for the startup grace window.

- [ ] **Chat: "Agent not found" silent failure after agent pick** — `ChatPanel` calls `.find()` across the loaded agent list; if the agent ID isn't present (e.g. sync hasn't completed), `activeAgent` silently becomes `null` — no error toast, next send proceeds agentlessly. Fix: show a toast / retry when `found === undefined`, and gate the send button until sync completes.

- [ ] **`transcription_auto_init` setting has no effect** — The toggle exists in `Configurations.tsx` and syncs to cloud, but neither `Voice.tsx` nor any transcription hook reads it. The Rust layer auto-initializes unconditionally at startup, ignoring the user's preference. Fix: read `transcriptionAutoInit` from settings in `use-transcription.ts` and call `init_transcription` conditionally.

- [ ] **Voice E2E needs real-device confirmation** — Full setup → record → transcript with the current Rust pipeline has not been confirmed on physical hardware. Specifically verify: model download, model load, mic permission grant, wake-word trigger, segment streaming, and session persistence.

---

## 🟡 Important Missing Features

These are gaps in committed functionality — things we said the app does but it doesn't yet, or things users will expect.

- [ ] **Chat: "Local" tab routing to llama-server** — `Chat.tsx` has no tab or mechanism to route messages to the local llama-server. Users can only use cloud providers from Chat. The LLM page runs inference but there is no in-chat UI for it. Need a "Local" mode/tab that sends messages to the running llama-server via `/v1/chat/completions`.

- [ ] **Image gen: FLUX.1 Dev token gate** — FLUX.1 Dev requires a HuggingFace token AND license acceptance. Before loading the model, surface a pre-check: read the HF token from `/settings/api-keys/huggingface/value` and show a blocking warning if absent or if the license hasn't been accepted.

- [ ] **Image gen: model download progress** — `from_pretrained` downloads silently. Wire up `huggingface_hub.snapshot_download` with a `tqdm` callback that streams progress events via SSE so the UI shows a real progress bar instead of a spinner.

- [ ] **Image gen: VRAM gating** — The model picker shows VRAM requirements but never cross-references the user's detected GPU VRAM (available at `/hardware`). Mark models as incompatible when detected VRAM is below the model's requirement.

- [ ] **Voice: no partial/streaming transcription results** — Whisper operates on full 5-second chunks; users see nothing until each chunk completes. Consider overlapping windows or VAD-triggered early flush to reduce perceived latency.

- [ ] **Voice: English-only hardcoded** — All Whisper params hardcode `.language("en")`. No UI for language selection. Should read from a settings key and expose a picker in the Voice setup tab.

- [ ] **Voice: transcription sessions not synced to cloud** — Sessions live entirely in `localStorage` (500-entry cap). Settings sync exists but session data does not. Users lose sessions on reinstall or device switch.

- [ ] **QA: Launch at login and tray minimize end-to-end** — Code is wired (`tauri_plugin_autostart`, `CloseToTray`), but these have not been confirmed working on both macOS and Windows in a signed production build. Needs physical-device QA pass.

- [ ] **QA: Headless scraping toggle** — The `headless_scraping` setting exists in the UI but has not been confirmed to flow through to Playwright's `headless` flag in the actual scrape paths. Needs a live smoke test.

---

## 🔵 Tech Debt & Code Quality

Refactors and cleanups that improve maintainability but don't change user-facing behavior.

- [ ] **Voice.tsx needs splitting into component files** — `Voice.tsx` is ~2,800 lines with `SetupTab`, `TranscribeTab`, `ModelsTab`, `DevicesTab`, and utilities all inline. Extract each tab into `desktop/src/components/voice/*.tsx`. No behavior change, pure refactor.

- [ ] **Health check: add a lightweight `/health` endpoint** — The Python engine has no dedicated health route; `/tools/list` is a heavyweight endpoint used as a proxy for "engine alive". Add `GET /health` → `{"status": "ok"}` and update both `api.ts` and Rust's `check_engine_health` to use it.

- [ ] **Zustand for shared app state** — `App.tsx` currently prop-drills auth/engine/settings state. A `desktop/src/stores/app-store.ts` with slices would clean this up. Keep `EngineAPI` singleton. Defer until active bugs are resolved.

- [ ] **Image gen: move model cache to `~/.matrx/image-models/`** — Currently downloads to HF default cache (`~/.cache/huggingface`). Centralizing under `~/.matrx/` would be consistent with other matrx data paths and make the Settings "clear cache" feature easier to implement.

- [ ] **API key extras** — Rotation timestamps and optional OS keychain storage (macOS Keychain, Windows Credential Manager). Currently all keys stored as SQLite plaintext blob.

- [ ] **Configurations consistency gaps** — `CONFIGURATIONS.md` §6 documents concrete issues: theme saved from Configurations does not update `matrx-theme` / live DOM; `chatMaxConversations` exists in `AppSettings` but `use-chat.ts` still caps with hardcoded `100`; `transcriptionAudioDevice` vs `matrx-selected-audio-device` dual storage; wake keyword in cloud vs Rust `transcription.json`. Close each gap or document intentional behavior.

- [ ] **Dark mode audit** — A spot-check of Settings.tsx, Tools.tsx, and Activity.tsx shows clean semantic tokens (no hardcoded light colors found). Remaining risk: modal overlays, dropdown menus, and third-party component wrappers. Do a full-app visual pass in light mode to catch edge cases.

---

## ⚪ Wish List / Future Work

Nice-to-haves and exploratory ideas. Not on the immediate roadmap.

- [ ] **Video generation engine** — Integrate `diffusers` for Kandinsky-5.0-T2V-Pro and Wan2.2-TI2V-5B (routes at `POST /tools/video-gen`). GPU/VRAM requirements are high (24+ GB for Kandinsky, 8–12 GB for Wan2.2-5B). Similar architecture to image gen.

- [ ] **ComfyUI sidecar** — Evaluate embedding ComfyUI as a second optional sidecar for advanced image/video workflows. Would replace or augment the Diffusers integration. See `local-llm-inference-integration.md` for the sidecar pattern.

- [ ] **Cloud AI relay** — Authenticated relay endpoint on AIDream so users don't need to paste provider API keys. `matrx-ai` should prefer the relay when no user key is set. Requires server + client coordination.

- [ ] **Cloud-assigned job queue** — Cloud pushes scrape jobs to the desktop app for background execution. Needs a durable job queue and status callbacks.

- [x] **Tools tab UX overhaul** — Fixed 2026-03-31: `ConsumerPanel` in `Tools.tsx` was dispatching by category instead of by selected tool — all category panels (FilesPanel, NetworkPanel, etc.) ignored `selectedSchema` and showed a fixed tab UI regardless of which tool was clicked. Replaced with `GenericToolPanel` for all tools, which renders a schema-driven form for the exact selected tool. `key={schema.toolName}` on `ToolForm` ensures clean state resets on tool switches. Only `SystemResources`/`TopProcesses` retain the live-gauge MonitoringPanel. Both simple (form) and advanced (JSON) modes now respond correctly to per-tool selection.

- [ ] **Welcome cards → agent IDs + Settings favorites** — Chat page welcome screen should deep-link to specific agents and surface user-pinned settings. Product design needed first.

- [ ] **Proxy full end-to-end test** — `POST /proxy/test` exercises the local forward proxy only. A real E2E test would hit `MAIN_SERVER` with a callback. Needs the `MAIN_SERVER` URL from Arman (see `.arman/ARMAN_TASKS.md`).

- [ ] **Wake word: sherpa-onnx KWS** — When stable Rust bindings exist, replace or augment the current dual-WhisperContext approach. Would reduce CPU usage significantly.

- [ ] **Wake-on-LAN / smart home APIs** — Future tool integrations.

- [ ] **Reverse tunnel** — Cloud-to-local proxy path for receiving inbound calls without a public IP.

- [ ] **App icon** — Replace the placeholder icon with final branded artwork before a major public launch.

---

## 📋 Doc Hygiene

Files that need attention. Do not delete without Arman's confirmation.

| Path | Action |
|------|--------|
| `.arman/in-progress/proxy/INITIAL.md` | **Delete** — generic Electron proxy essay, not project-specific |
| `.arman/pending/ui-overhaul/INITIAL.md` | **Archive or delete** — large draft superseded by incremental work |
| `PLATFORM_AUDIT.md` | **Delete or rewrite** — claims `initPlatformCtx` is never called; this is false (`use-engine.ts` calls it). Misleading if left as-is |

_Valid reference docs (keep, update when features change):_ `ARCHITECTURE.md`, `CONFIGURATIONS.md`, `CLAUDE.md`, `local-llm-inference-integration.md`, `whisper-transcription-integration.md`, `docs/react-migration-notes-api.md`, `docs/proxy-integration-guide.md`, `docs/proxy-testing-guide.md`, `docs/local-storage-architecture.md`, `docs/activity-log.md`.
