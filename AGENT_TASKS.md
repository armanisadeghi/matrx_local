# Matrx Local — Agent task queue

> **Living doc.** Log new bugs the moment you find them. **Last cleaned:** 2026-03-25 (added image gen engine, model catalog overhaul, LLM tier expansion).
> Wake word training steps moved to [`docs/wake-word-training.md`](docs/wake-word-training.md).

---

## Active — work top to bottom

### P0 — Ship / safety

- [ ] **matrx-ai circular import bug — GenericOpenAIChat broken** — `matrx-ai` is at v0.1.26 but importing `GenericOpenAIChat` triggers a circular import: `providers/__init__.py` → `unified_client.py` → `orchestrator/executor.py` → `providers/__init__.py`. Local LLM routing is **completely disabled**. Full error: `ImportError: cannot import name 'UnifiedAIClient' from partially initialized module 'matrx_ai.providers'`. Fix: break the circular import in the `matrx-ai` package (move the `UnifiedAIClient` import in `orchestrator/executor.py` to a lazy/local import, or restructure `providers/__init__.py` to not import `unified_client` at module level). See `docs/matrx-ai-generic-openai-port.md`. Run `uv sync` after fix.
- [ ] **matrx-ai server-side ORM** — Cloud engine still hits server DB in places; blocks “safe shipping” until client-only/local paths are verified (`matrx-ai` / chat stack).

### P0 — Build / deployment bugs (recently fixed)

- [x] **PyInstaller missing `python-multipart`** — Fixed 2026-03-30. `python-multipart` was declared in `pyproject.toml` but not listed in `hiddenimports` in any of the four `.spec` files or in the `build_with_flags()` fallback in `scripts/build-sidecar.sh`. FastAPI's `Form`, `File`, and `UploadFile` types (used in `tts_routes.py`) require `python-multipart` at import time. Without it in the bundle, the engine logged `Form data requires "python-multipart" to be installed` on every request that touched those routes. Fixed by adding `'python_multipart'` and `'multipart'` to `hiddenimports` in all four spec files and in `build_with_flags()`.

- [x] **llama-server Gatekeeper crash on macOS** — Fixed 2026-03-30. The llama-server binary from llama.cpp GitHub Releases carries only an ad-hoc signature (`flags=adhoc,linker-signed`). macOS Gatekeeper rejects ad-hoc signatures for binaries not launched from the user's own build, causing the process to be killed immediately on launch with no output. The CI workflow signed the `.dylib` files but missed signing the executable itself. Fixed by extending the `Sign llama.cpp binaries for notarization` CI step to also re-sign the llama-server binary with `codesign --force --timestamp --options runtime --sign "$APPLE_SIGNING_IDENTITY"`.

### P1 — Product gaps

- [x] **Documents: silent data loss on navigation** — Fixed 2026-03-29. When a user navigated away from the Documents page before the 1-second debounce timer fired, the pending edit was silently discarded. Fixed by: (1) tracking the pending save in `pendingSaveRef`, (2) flushing it fire-and-forget in the cleanup function of the `useEffect`. Users can now navigate away mid-keystroke without losing data.
- [x] **Documents: Realtime pull overwrote in-flight local saves** — Fixed 2026-03-29. A Supabase Realtime event for a note being actively typed would call `engine.pullNote()` while the local debounce timer was still running, clobbering keystrokes. Fixed by exporting `markNoteEditing(noteId)` / `markNoteIdle(noteId)` from `use-realtime-sync.ts`; `updateNote` calls these to create a write-suppress window around the debounce period.
- [x] **Documents: Realtime self-echo triggered redundant pulls** — Fixed 2026-03-29. Every local push to Supabase triggered a Realtime event back to the same client, causing `engine.pullNote()` to fire, then a full `loadTree()` + `loadNotes()` + `selectNote()` cycle. Fixed by tracking `recentPushesRef` timestamps and skipping the pull (but still notifying UI) when the event was generated within 10s of a local push.
- [x] **Documents: `scan_all()` on every keystroke** — Fixed 2026-03-29. `update_note` in `document_routes.py` walked the entire notes directory on every debounced save. Fixed by checking SQLite first (O(1) lookup) and only falling back to `scan_all()` when SQLite has no record.
- [x] **Documents: non-atomic file writes** — Fixed 2026-03-29. `Path.write_text()` is not atomic; a crash mid-write produces a corrupt .md file. Added `_atomic_write()` helper (tempfile + `os.replace()`) in `file_manager.py`; all note writes and sync-state JSON writes now use it.
- [x] **Documents: `saving` spinner could hang forever** — Fixed 2026-03-29. `docRequest` in `api.ts` had no timeout. If the engine hung during `scan_all()` the fetch would never resolve. Added 15-second `AbortController` timeout with a clear error message.
- [x] **Documents: stale `docs` object captured in Realtime callbacks** — Fixed 2026-03-29. `onNoteChange` and `onFolderChange` in `Documents.tsx` closed over the entire `docs` object (new reference every render), causing the active-note ID to be stale when the callback fired. Fixed by destructuring stable function refs (`loadTree`, `loadNotes`, `selectNote`) and tracking `activeNoteId` in a `useRef`.
- [x] **Documents: 21-copies bug when typing a note title** — Fixed 2026-03-29. `NoteEditor.handleLabelChange` fired `onLabelChange` on every keystroke. Parent passed `immediate=true` to `updateNote`, bypassing the debounce. Each character triggered one HTTP PUT. When `old_file_path` was absent from the existing record, `write_note` used `note_path(folder, label)` — creating a new file per character. Fixed by: (1) debouncing label changes in `NoteEditor` (600 ms, fires on blur too); (2) removing `immediate=true` from `Documents.handleLabelChange`; (3) making `update_note` atomically rename the file when label changes using `file_manager.rename_note()`, so `file_path` is always valid and no new file is created.
- [x] **Documents: note ID derived from file path** — Fixed 2026-03-29. `_note_id_for_path` = `uuid5(file_path)` meant renaming a file generated a new ID. New notes now get a random `uuid4()` at `create_note` time, stored in SQLite as the canonical ID. Old UUID5-based notes continue to work (legacy fallback). `list_notes`, `get_note`, and `delete_note` all use SQLite-first lookup.
- [x] **Documents: duplicate "New Note" files** — Fixed 2026-03-29. `_unique_file_path()` helper added: checks if `folder/label.md` exists; appends `_2`, `_3` … or a timestamp suffix if all are taken.
- [x] **Documents: label reverts to filename after restart** — Fixed 2026-03-29. `update_note` now calls `file_manager.rename_note()` when the label changes, keeping the `.md` filename in sync with the user-visible label. `_build_note_record` still derives `label` from `p.stem` as a fallback, but the SQLite label (via `_enrich_record_from_sqlite`) takes precedence.

- [ ] **Chat: “Agent not found” after pick** — May be ID mismatch vs local SQLite vs cloud; reproduce after agent sync fixes (`Chat.tsx` / matrx-ai lookups).
- [ ] **Chat: “Local” tab for llama-server** — Route desktop chat to local LLM, not only cloud providers.
- [ ] **Voice E2E on real devices** — Confirm setup → record → transcript with `transcription_auto_init` and current Rust pipeline; fix gaps if any.

### P2 — Features & polish

- [x] **Voice: `useWakeWord` actions/state not wrapped in `useMemo`** — Fixed 2026-03-26. Both `state` and `actions` objects were plain literals, causing new references every render. This triggered cascading re-renders through `WakeWordContext` to `QuickActionBar`. Both now wrapped in `useMemo`. Regression test: `tests/parity/test_transcription_parity.py::test_use_wake_word_*`.
- [x] **Voice: `useTranscriptionSessions` actions not wrapped in `useMemo`** — Fixed 2026-03-26. Same pattern as above. Also fixed `viewingSession` re-reading localStorage on every render — now derived from React state via `useMemo`. Regression test: `tests/parity/test_transcription_parity.py::test_use_transcription_sessions_actions_memoized`.
- [x] **Voice: `useTranscription` state not wrapped in `useMemo`** — Fixed 2026-03-26. State object was a plain literal; now `useMemo`-wrapped.
- [x] **Voice: Multiple independent `useTranscription` instances** — Fixed 2026-03-26. `App.tsx`, `Voice.tsx`, and `NoteEditor.tsx` all called `useTranscription()` independently, creating 3 separate state instances managing one Rust audio pipeline. Created `TranscriptionContext` (same singleton pattern as TTS/LLM): hook runs once at app root, all consumers use `useTranscriptionApp()`. Regression test: `tests/parity/test_transcription_parity.py::test_transcription_provider_in_app`.
- [x] **Voice: Wake word keyword not persisted on Rust side** — Fixed 2026-03-26. `configure_wake_word` changed the keyword in memory but `WakeWordState` had no config persistence. On restart, always reset to "hey matrix". Added `wake_keyword` field to `TranscriptionConfig` (with serde default for backward compat), `configure_wake_word` now saves to config, startup loads persisted keyword into `WakeWordState`. Also fixed the running thread to read keyword dynamically from `state.keyword` instead of capturing once at thread start.
- [x] **Voice: No whisper model download cancellation** — Fixed 2026-03-26. Added `WhisperDownloadCancelState` (shared `AtomicBool`), `cancel_whisper_download` Rust command, per-chunk cancel check in `downloader.rs`, and `cancelDownload` action in `useTranscription`. Follows same pattern as `cancel_llm_download`.
- [x] **Voice: localStorage thrashing during recording** — Fixed 2026-03-26. `appendSegments()` did a full parse+serialize on every whisper-segment event (~1/5s). Added debounced batching: segments accumulate in memory and flush to localStorage every 1s. `finalizeSession` force-flushes before persisting. `useTranscriptionSessions` registers a flush callback for React state sync.
- [ ] **Voice: Extract Voice.tsx into separate component files** — Voice.tsx is 2822 lines with `SetupTab`, `TranscribeTab`, `ModelsTab`, `DevicesTab`, and utilities all inline. Should extract each tab into `desktop/src/components/voice/*.tsx`.
- [ ] **Voice: No partial/streaming transcription results** — Whisper operates on full 5-second chunks. Users see nothing until each chunk completes. Consider overlapping windows or VAD-triggered early flush for perceived latency improvement.
- [ ] **Voice: Single language (English only)** — All Whisper params hardcode `.language("en")`. No UI for language selection.
- [ ] **Voice: No cloud sync for transcription sessions** — Sessions are 100% localStorage (500 cap). No Supabase push. Settings sync exists but session data does not.
- [x] **TTS settings parity gap** — Fixed 2026-03-29. Added 4 TTS settings to Python `DEFAULT_SETTINGS`, added `tts` section to `SECTION_KEYS`, added `/tts → TextToSpeech.tsx` alias to route manifest test. All 55 parity tests pass.
- [x] **TTS streaming synthesis** — Added 2026-03-29. Backend `POST /tts/synthesize-stream` splits text at sentence boundaries and streams length-prefixed WAV chunks. Frontend `synthesizeStream()` async generator + `speakStreaming()` in `use-tts.ts` with buffered audio queue for gapless playback. TextToSpeech page auto-selects streaming for text >200 chars.
- [x] **TTS chat read-aloud** — Added 2026-03-29. `use-chat-tts.ts` hook bridges LLM streaming messages to TTS with sentence-boundary buffering + `parseMarkdownToText()`. Read-aloud button on each assistant message in `ChatMessages`. Settings: `ttsReadAloudEnabled`, `ttsReadAloudAutoPlay`. Added to Python `DEFAULT_SETTINGS` and `SECTION_KEYS`.
- [x] **Markdown-to-speech parser** — Added 2026-03-29. `parse-markdown-for-speech.ts` from web project, fixed `mx-glass` typo and unused variable lint. Used automatically for LLM output read-aloud, optional "Clean Markdown" button in TTS page.
- [x] **TTS comprehensive configuration** — Added 2026-03-29. Expanded TTS settings: per-system voice (`ttsChatVoice`, `ttsNotificationVoice`), per-system speed (`ttsChatSpeed`), streaming threshold (`ttsStreamingThreshold`), auto-clean markdown (`ttsAutoCleanMarkdown`). Full Configurations page card with language-grouped voice dropdowns via `use-config-catalogs` TTS voice catalog. `use-chat-tts` now reads user's chat-specific voice/speed from settings. Cloud sync (`mergeCloudSettings` / `settingsToCloud`) and Python `DEFAULT_SETTINGS` updated for all new keys.

- [x] **GPU not detected on Windows/WSL** — Fixed 2026-03-25. Three separate bugs: (1) `_detect_gpus()` in `detector.py` did not search WSL-specific nvidia-smi paths (`/usr/lib/wsl/lib/nvidia-smi`); (2) `_check_gpu()` in `setup_routes.py` duplicated detection logic instead of using the shared detector; (3) `_probe_gpu()` in `platform_ctx.py` same issue; (4) Rust `try_nvidia_smi()` in `hardware.rs` only tried bare `nvidia-smi` name which may not be on PATH in a compiled sidecar. All four fixed: unified detector used everywhere, WSL/Windows PATH fallbacks added to both Python and Rust.

- [x] **Image generation engine** — Integrated Python `diffusers` library as optional feature (2026-03-25). Routes at `/image-gen/*`. Models: FLUX.1 Schnell, FLUX.1 Dev, HunyuanDiT v1.2, SDXL Turbo. 6 workflow presets. Full UI in LocalModels "Image & Video" tab. Install deps: `uv sync --extra image-gen`. See `app/services/image_gen/`, `app/api/image_gen_routes.py`.
- [ ] **Image gen: VRAM detection gating** — Surface hardware VRAM from `/hardware` in the image gen model picker to mark models as "incompatible" for the user's GPU. Currently shows VRAM requirements but doesn't cross-reference detected hardware.
- [ ] **Image gen: model download progress** — Hugging Face `from_pretrained` downloads silently. Wire up HF `tqdm` callback or `huggingface_hub.snapshot_download` with progress events via SSE so the UI shows download progress.
- [ ] **Image gen: persistent cache path** — Currently models download to HF default cache (`~/.cache/huggingface`). Consider moving to `~/.matrx/image-models/` for consistency with other matrx data paths.
- [ ] **Image gen: FLUX.1 Dev token gate** — FLUX.1 Dev requires a HF token AND accepting license on HF. Surface a pre-check in the UI: call `/settings/api-keys/huggingface/value` and show a warning if absent before loading.
- [ ] **Video generation engine** — Integrate Python `diffusers` for Kandinsky-5.0-T2V-Pro and Wan2.2-TI2V-5B. Route: `POST /tools/video-gen`. Similar architecture to image gen. GPU/VRAM requirement is higher (24+ GB for Kandinsky; 8–12 GB for Wan2.2-5B).
- [ ] **ComfyUI sidecar** — Evaluate embedding ComfyUI as an optional second sidecar for advanced image/video generation workflows. Would replace or augment the Diffusers integration. See `local-llm-inference-integration.md` for sidecar pattern.
- [ ] **Gemma-3n vision** — Gemma-3n-E4B has native multimodal (text+image+audio) but llama.cpp support is text-only currently. When llama.cpp adds gemma3n vision pipeline, enable vision for this model (update `vision_rating` from 0 to 3 in `model_selector.rs`, add mmproj download).
- [x] **Scrape persistence — dual-write** (2026-03-25) — All local scrapes now write to **two places** on every successful scrape:
  1. **Local SQLite** (`scrape_pages` table in `~/.matrx/matrx.db`, migration v8) — always written first, survives forever, no TTL.
  2. **Remote scraper server** (`scrape_parsed_page` Postgres) — background fire-and-forget; failure is tracked in `cloud_sync_status` column.
  On startup the engine resets any failed rows back to `pending` and retries them. Background sync loop runs every 120s. API: `GET /scrapes`, `GET /scrapes/sync-status`, `POST /scrapes/sync`, `GET /scrapes/{id}`, `DELETE /scrapes/{id}` (soft-delete, requires second `?confirmed=true` call for permanent delete), `POST /scrapes/{id}/restore`. Files: `app/services/scraper/scrape_store.py`, `app/api/scrape_routes.py`, schema migration in `app/services/local_db/schema.py` (`_V8_SCRAPE_PAGES`).
- [ ] **Proxy “full” test (optional)** — Today: `POST /proxy/test` exercises the **local** forward proxy. A true end-to-end test would also hit `MAIN_SERVER` with a callback; needs Arman URL (`MAIN_SERVER`). See `.arman/ARMAN_TASKS.md`.
- [ ] **Cloud AI relay** — Authenticated relay on AIDream so users need not paste provider keys; matrx-ai must prefer relay when no user key. Coordinate server + client.
- [ ] **Health check tuning** — `isHealthy()` uses short timeout on `/tools/list`; heavy tools can false-flag “disconnected”. Consider `/health` or longer timeout (see prior tunnel section notes).
- [ ] **Tools tab UX** — PR “user-friendly tools UI” or incremental forms; still developer-heavy for some tools.
- [ ] **Welcome cards → agent IDs + Settings favorites** — Product follow-up in Chat.
- [ ] **API key extras** — Rotation timestamps / OS keychain (was “nice-to-have” backlog).
- [ ] **Dark mode** — Spot-check pages beyond Ports for hardcoded colors.
- [ ] **QA: Launch at login, tray minimize, engine restart** — Toggles exist; end-to-end confirm on macOS/Windows.
- [ ] **QA: Headless scraping toggle** — Confirm engine passes `headless_scraping` into Playwright paths live.
- [ ] **App icon** — Replace default / placeholder artwork for shipping.
- [ ] **Zustand (or similar) for shared shell state** — Reduce `App.tsx` prop drilling; keep page-local state local. Defer until P0/P1 stable.

### P3 — Future / research

- [ ] **Job queue** — Cloud-assigned scrape jobs.
- [ ] **Rate limiting** — Per-user on remote scraper.
- [ ] **Wake-on-LAN / smart home APIs** — Future integrations.
- [ ] **Reverse tunnel** — Cloud → local proxy path.
- [ ] **Alembic** — Only relevant if you run a **local** Postgres for scraper via `DATABASE_URL`.
- [ ] **Wake word: sherpa-onnx KWS** — When usable Rust bindings exist; lowers CPU vs dual WhisperContext.

**Notes (verified in code, not tickets):**

- **Forbidden URLs** — Settings → Scraping (engine `GET/POST/DELETE /settings/forbidden-urls`), enforced in network/scrape tools; stored in settings sync JSON. Optional: confirm same keys round-trip in cloud blob for multi-device.
- **First-run** — `FirstRunScreen` + setup wizard in app when setup incomplete.
- **System hardware** — Settings → **System** (`/hardware`) plus Dashboard resource gauges.
- **Installed Apps tool UI** — `InstalledAppsPanel` uses localStorage cache + refresh.
- **Hugging Face token** — Settings → **API Keys** (`huggingface`); Local Models links there only.

---

## Completed archive (one line each)

_Order bullets = newest areas first; details live in git history._

- Image generation engine: `app/services/image_gen/`, `/image-gen/*` routes, FLUX.1/HunyuanDiT/SDXL catalog, 6 workflow presets, full LocalModels UI tab (2026-03-25).
- Local LLM model catalog overhaul: 22-tier system, Qwen/Llama/GPT-OSS/Gemma/DeepSeek/Mistral models, multi-variant quant picker, server-grade section, uncensored models, multi-category star ratings, knowledge cutoff (2026-03-25).
- Auto-update: background pre-download without spamming progress UI; prepared-version cache in `localStorage` (2026-03-24).
- HF XET downloads + Hugging Face token in engine API Keys + bridge endpoint for Tauri (2026-03-24).
- Sidecar orphans, parent watchdog (Windows `TAURI_APP_PID` shim), SIGTERM→SIGKILL timing, force-exit 25s, cloudflared/llama cleanup, `kill_orphaned_sidecars`, `stop.ps1`, discovery-file race (2026-03).
- Shutdown audit: wake word stop, scheduler + prevent-sleep, file watches, document watcher, sync engine await (2026-03).
- Windows LLM: Vulkan binary, `-fit off`, `-fa` gating, b8358 binary bump, mmap path normalization (2026-03).
- Tunnel prefs persisted (`tunnel_enabled`), frontend `tunnelEnabled`, WS retry on late auth (2026-03).
- Tunnel DB: `tunnel_ws_url`, stale expiry cron, duplicate RLS cleanup (migrations 006–007).
- Hardware: `detector.py`, `/hardware`, migration 008, Settings System tab, Windows/macOS/Linux detection fixes (2026-03).
- Startup UX: `StartupScreen` log replay, heartbeats, Windows health `invoke`, capability install process groups, `EngineRecoveryModal` Windows detect (2026-03).
- User API keys: SQLite blob, `key_manager`, Settings API Keys tab, Chat link (2026-03).
- Documents: local-first, V6/V7 versions, conflicts + append, voice push-to-note (2026-03).
- Agents: JWT-triggered `sync_agents`, `use-engine` token order (2026-03).
- Activity log SSE, access log paths, auth `?token=` (2026-02).
- Proxy server, cloud settings sync, instance manager, migration 002 (2026-02).
- Chat UI, AgentPicker parity, tool schemas (2026-02–03).
- Desktop tool expansion (79 dispatcher tools), ARCHITECTURE count (2026-02).
- Remote scraper JWT, `api.ts` remote methods, Scraping page modes (2026-02).
- Scraping.tsx layout, normalizeUrl, scroll panels (2026-03).
- Dashboard profile + browser label, Ports dark mode, various tool panels (Clipboard/Browser/Monitoring) (2026-02–03).
- CI workflow, Apple notarization vars, `uv --extra all` fix (2026-03).
- GitHub Actions secrets documented; Windows NSIS installer (per ARMAN_TASKS).
- OAuth, Supabase publishable key, scraper JWKS shipping path (2025–2026).
- `@tailwindcss/typography` + NoteEditor prose (2026-03).

---

## Doc hygiene — candidates to delete or archive

_Do not delete until Arman confirms. Reason in parentheses._

| Path | Suggestion |
|------|------------|
| `.arman/in-progress/proxy/INITIAL.md` | **Delete** — generic Electron proxy essay, not project-specific. |
| `.arman/pending/ui-overhaul/INITIAL.md` | **Archive or delete** — huge draft; incremental Tools work replaced monolith plan. |
| `PLATFORM_AUDIT.md` | **Replace or major trim** — claims `initPlatformCtx` never called; **false** (`use-engine.ts` calls it). Re-audit if you keep the file. |

_Valid reference docs (keep; update when features change):_ `local-llm-inference-integration.md`, `whisper-transcription-integration.md`, `docs/react-migration-notes-api.md` (external `/notes` API), `docs/proxy-*`, `docs/local-storage-architecture.md`, `docs/activity-log.md`, `ARCHITECTURE.md`.

---

### Zustand idea (deferred)

Optional later: `desktop/src/stores/app-store.ts` slices for auth/engine/settings/platform; keep `EngineAPI` singleton; do not auto-merge SQLite + localStorage + Supabase in one store.
