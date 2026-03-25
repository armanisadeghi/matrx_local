# Matrx Local — Agent task queue

> **Living doc.** Log new bugs the moment you find them. **Last cleaned:** 2026-03-25 (added image gen engine, model catalog overhaul, LLM tier expansion).
> Wake word training steps moved to [`docs/wake-word-training.md`](docs/wake-word-training.md).

---

## Active — work top to bottom

### P0 — Ship / safety

- [ ] **matrx-ai circular import bug — GenericOpenAIChat broken** — `matrx-ai` is at v0.1.26 but importing `GenericOpenAIChat` triggers a circular import: `providers/__init__.py` → `unified_client.py` → `orchestrator/executor.py` → `providers/__init__.py`. Local LLM routing is **completely disabled**. Full error: `ImportError: cannot import name 'UnifiedAIClient' from partially initialized module 'matrx_ai.providers'`. Fix: break the circular import in the `matrx-ai` package (move the `UnifiedAIClient` import in `orchestrator/executor.py` to a lazy/local import, or restructure `providers/__init__.py` to not import `unified_client` at module level). See `docs/matrx-ai-generic-openai-port.md`. Run `uv sync` after fix.
- [ ] **matrx-ai server-side ORM** — Cloud engine still hits server DB in places; blocks “safe shipping” until client-only/local paths are verified (`matrx-ai` / chat stack).

### P1 — Product gaps

- [ ] **Chat: “Agent not found” after pick** — May be ID mismatch vs local SQLite vs cloud; reproduce after agent sync fixes (`Chat.tsx` / matrx-ai lookups).
- [ ] **Chat: “Local” tab for llama-server** — Route desktop chat to local LLM, not only cloud providers.
- [ ] **Voice E2E on real devices** — Confirm setup → record → transcript with `transcription_auto_init` and current Rust pipeline; fix gaps if any.

### P2 — Features & polish

- [x] **GPU not detected on Windows/WSL** — Fixed 2026-03-25. Three separate bugs: (1) `_detect_gpus()` in `detector.py` did not search WSL-specific nvidia-smi paths (`/usr/lib/wsl/lib/nvidia-smi`); (2) `_check_gpu()` in `setup_routes.py` duplicated detection logic instead of using the shared detector; (3) `_probe_gpu()` in `platform_ctx.py` same issue; (4) Rust `try_nvidia_smi()` in `hardware.rs` only tried bare `nvidia-smi` name which may not be on PATH in a compiled sidecar. All four fixed: unified detector used everywhere, WSL/Windows PATH fallbacks added to both Python and Rust.

- [x] **Image generation engine** — Integrated Python `diffusers` library as optional feature (2026-03-25). Routes at `/image-gen/*`. Models: FLUX.1 Schnell, FLUX.1 Dev, HunyuanDiT v1.2, SDXL Turbo. 6 workflow presets. Full UI in LocalModels "Image & Video" tab. Install deps: `uv sync --extra image-gen`. See `app/services/image_gen/`, `app/api/image_gen_routes.py`.
- [ ] **Image gen: VRAM detection gating** — Surface hardware VRAM from `/hardware` in the image gen model picker to mark models as "incompatible" for the user's GPU. Currently shows VRAM requirements but doesn't cross-reference detected hardware.
- [ ] **Image gen: model download progress** — Hugging Face `from_pretrained` downloads silently. Wire up HF `tqdm` callback or `huggingface_hub.snapshot_download` with progress events via SSE so the UI shows download progress.
- [ ] **Image gen: persistent cache path** — Currently models download to HF default cache (`~/.cache/huggingface`). Consider moving to `~/.matrx/image-models/` for consistency with other matrx data paths.
- [ ] **Image gen: FLUX.1 Dev token gate** — FLUX.1 Dev requires a HF token AND accepting license on HF. Surface a pre-check in the UI: call `/settings/api-keys/huggingface/value` and show a warning if absent before loading.
- [ ] **Video generation engine** — Integrate Python `diffusers` for Kandinsky-5.0-T2V-Pro and Wan2.2-TI2V-5B. Route: `POST /tools/video-gen`. Similar architecture to image gen. GPU/VRAM requirement is higher (24+ GB for Kandinsky; 8–12 GB for Wan2.2-5B).
- [ ] **ComfyUI sidecar** — Evaluate embedding ComfyUI as an optional second sidecar for advanced image/video generation workflows. Would replace or augment the Diffusers integration. See `local-llm-inference-integration.md` for sidecar pattern.
- [ ] **Gemma-3n vision** — Gemma-3n-E4B has native multimodal (text+image+audio) but llama.cpp support is text-only currently. When llama.cpp adds gemma3n vision pipeline, enable vision for this model (update `vision_rating` from 0 to 3 in `model_selector.rs`, add mmproj download).
- [ ] **Scrape persistence** — Persist completed scrapes (e.g. Supabase `scrapes` table + migration).
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
