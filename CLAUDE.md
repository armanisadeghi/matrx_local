# CLAUDE.md -- Matrx Local Project Instructions

> Project-specific instructions for AI assistants working on this codebase.
> This supplements the global `/Users/armanisadeghi/Code/CLAUDE.md`.

---

## Project Overview

Matrx Local is a **Tauri v2 desktop app** (Rust shell + React UI) with a **Python/FastAPI backend engine** that runs as a sidecar. It exposes 79 tools (filesystem, shell, scraping, documents, etc.) via REST and WebSocket for the AI Matrx cloud platform. This is a desktop app for end users, not developers!

**This is NOT a Next.js project.** The global CLAUDE.md's Next.js/Vercel rules do not apply here. This project uses:
- **Desktop:** Tauri v2 (Rust) + React 19 + TypeScript 5.7 + Vite 6
- **Styling:** Tailwind CSS 3.4 + shadcn/ui (Radix UI) -- `darkMode: "class"` strategy
- **Backend:** Python 3.13+ / FastAPI / Uvicorn
- **Auth:** Supabase Auth (OAuth + email) -- Supabase also acts as OAuth Server for shipping
- **DB:** PostgreSQL via Supabase (optional, graceful degradation to in-memory)
- **Scraping:** Integrated scraper-service (git subtree, read-only in matrx_local; editable at source repo)
- **Package Managers:** pnpm (desktop), uv (Python)

---

## Key Architecture Rules

1. **scraper-service/ is read-only in this repo** -- It's a git subtree from the `aidream` repo. Never edit files there directly. Use `./scripts/update-scraper.sh` to pull updates. The source repo is at `/Users/armanisadeghi/Code/aidream-current/scraper-service` and CAN be edited directly.
2. **Module isolation** -- The scraper's `app/` is aliased as `scraper_app/` via `sys.modules` in `app/services/scraper/engine.py`. Do not create naming conflicts.
3. **Graceful degradation** -- The engine works without PostgreSQL (memory cache) or Brave API (search disabled). Never make these hard dependencies. Playwright, psutil, and zeroconf are core dependencies and always available.
4. **Port 22140** -- Default engine port. Auto-scans 22140-22159. Discovery file at `~/.matrx/local.json`.
5. **Every Python import must be in `pyproject.toml`** -- If a tool or route imports a package, that package must be listed as a dependency. Never use bare `try/except ImportError` as a substitute for declaring the dependency. When adding a new tool that imports a new package, add it to `pyproject.toml` and run `uv sync` in the same commit. Required packages currently in `pyproject.toml`: fastapi, uvicorn, pydantic, pydantic-settings, python-dotenv, httpx, pyperclip, plyer, pyobjc-framework-Quartz (macOS), pystray, pillow, asyncpg, aiosqlite, curl-cffi, beautifulsoup4, lxml, selectolax, cachetools, tldextract, markdownify, tabulate, PyMuPDF, pytesseract, matrx-utils, matrx-orm, matrx-ai, screeninfo, yt-dlp, imageio-ffmpeg, opencv-python, mss, playwright, psutil, zeroconf, sounddevice, numpy, watchfiles, websockets, pyyaml, concurrent-log-handler, pyinstaller, openwakeword, onnxruntime. **Optional extras:** `[transcription]` = openai-whisper; `[image-gen]` = torch, torchvision, diffusers, transformers, accelerate, sentencepiece, protobuf (install with `uv sync --extra image-gen`; NOT included in `all` due to multi-GB size). **Note:** kokoro-onnx and soundfile (TTS) are core dependencies — always installed, not optional.

---

## Task Tracking

**Two tracking files:**

1. **`AGENT_TASKS.md`** (project root) -- All bugs, issues, and improvement ideas. Update immediately when:
   - A new bug or issue is discovered
   - An existing task is resolved (check it off)
   - Investigation reveals new details about an existing task

2. **`.arman/ARMAN_TASKS.md`** -- Tasks for Arman to complete manually (Supabase config, env setup, deployments, etc.). Keep entries **simple and concise**: just a checkbox and brief direct instructions. No verbose explanations.

Never let a discovered issue go untracked. If we're in the middle of something else, add it to the right file and continue.

---

## Current State (as of 2026-03-26)

### What Works
- Python FastAPI engine with 79 tools (REST + WebSocket)
- Engine auto-discovery from React UI, tools page, scraping page
- Activity log with real-time WebSocket + structured access SSE
- Dashboard with live CPU/RAM/Disk/Battery gauges and user profile
- Tauri sidecar lifecycle (spawn/kill), auto-updater (background pre-download; see `use-auto-update.ts`)
- CORS, remote scraper proxy routes, SSE streaming
- Supabase OAuth 2.1 PKCE auth flow
- Cloud instance registration + settings sync
- Local-first notes/documents with optional Supabase sync
- Local HTTP proxy at `127.0.0.1:22180` with status + connectivity test
- Voice tab (Rust Whisper + wake word); settings include `transcription_auto_init`
- First-run / setup wizard + capability installs
- Local Models tab + llama-server sidecar (binaries via `scripts/download-llama-server.sh`; bundle in release pipeline)
- **Local LLM model catalog** — 22-tier system spanning Tiny→Server-grade; providers: Qwen, Llama, GPT-OSS, Gemma, DeepSeek, Mistral, Phi; multi-variant quant picker per model; server-grade collapsible section; uncensored model support; multi-category star ratings (Text/Code/Vision/Tools); knowledge cutoff column
- **Image generation engine** — Optional `[image-gen]` extra (`uv sync --extra image-gen`). Routes at `/image-gen/*`. Models: FLUX.1 Schnell, FLUX.1 Dev, HunyuanDiT v1.2, SDXL Turbo. 6 workflow presets (Portrait, Product, Concept Art, UI Mockup, Logo, Landscape). Full generate UI with prompt/steps/guidance sliders, image output, download. Graceful 503 when deps absent.
- **Text-to-Speech (Kokoro TTS)** — Core bundled feature (kokoro-onnx + soundfile are core dependencies). Routes at `/tts/*`. Kokoro-82M via ONNX Runtime (no PyTorch), 54 voices across 9 languages, 3-5x real-time on CPU, ~300 MB model auto-downloaded on first use. Full UI with voice selector, speed control, audio playback, voice preview, favorites. **Streaming synthesis** (`/tts/synthesize-stream`) splits text at sentence boundaries and yields WAV chunks for near-instant playback start. **Chat read-aloud** — read-aloud button on every assistant message in Chat; `useChatTts` hook bridges LLM streaming to TTS with sentence-boundary buffering + `parseMarkdownToText()` for clean speech. TTS state lives in `TtsContext` (singleton) — see React patterns section before touching this.
- Settings: hardware inventory tab, forbidden URL list (scraping), API Keys (incl. Hugging Face for GGUF + image-gen downloads)
- Platform context: `use-engine.ts` calls `initPlatformCtx()` after `getPlatformContext()`
- AiMatrx iframe tab with session handoff

### Known gaps / verify on device
- **Voice** — Confirm full record→transcribe UX on hardware you care about; see `AGENT_TASKS.md` P1.
- **matrx-ai ORM / server DB** — Treat as **P0 ship risk** until client-only path is verified (`AGENT_TASKS.md`).
- **Custom app icon** — Replace placeholder when branding is ready.
- **Image gen VRAM gating** — Model picker shows VRAM requirements but doesn't yet cross-reference detected GPU VRAM to mark incompatible models. See `AGENT_TASKS.md` P2.

### Key Integration Guides
- **Voice/Whisper:** `whisper-transcription-integration.md` — full Rust architecture, model catalog, download URLs, gotchas
- **Local LLM:** `local-llm-inference-integration.md` — sidecar architecture, Qwen3 tool calling, binary bundling, all gotchas
- **Image Generation:** `app/services/image_gen/models.py` (model catalog + workflow presets), `app/api/image_gen_routes.py` (API), `pyproject.toml` `[image-gen]` extra
- **Text-to-Speech:** `app/services/tts/models.py` (voice catalog, 54 voices × 9 langs), `app/services/tts/service.py` (Kokoro ONNX singleton), `app/api/tts_routes.py` (API)
- **Local storage:** `docs/local-storage-architecture.md`
- **Proxy:** `docs/proxy-integration-guide.md`, `docs/proxy-testing-guide.md`

---

## Development Commands

```bash
# Python engine (Terminal 1)
cd /path/to/matrx_local
uv sync
uv run python run.py

# React frontend (Terminal 2)
cd desktop
pnpm install
pnpm dev
# Open http://localhost:1420

# Tauri desktop (requires Rust)
cd desktop
pnpm tauri:dev
```

---

## File Locations

| What | Where |
|------|-------|
| Python entry point | `run.py` |
| FastAPI app | `app/main.py` |
| Tool implementations | `app/tools/tools/*.py` |
| Remote scraper client | `app/services/scraper/remote_client.py` |
| Remote scraper routes | `app/api/remote_scraper_routes.py` |
| Engine settings API | `app/api/settings_routes.py` |
| Proxy routes | `app/api/proxy_routes.py` |
| Cloud sync routes | `app/api/cloud_sync_routes.py` |
| Proxy server | `app/services/proxy/server.py` |
| Instance manager | `app/services/cloud_sync/instance_manager.py` |
| Settings sync engine | `app/services/cloud_sync/settings_sync.py` |
| Engine auth middleware | `app/api/auth.py` |
| Error boundary | `desktop/src/components/ErrorBoundary.tsx` |
| React entry | `desktop/src/App.tsx` |
| Scraping page | `desktop/src/pages/Scraping.tsx` |
| Settings page | `desktop/src/pages/Settings.tsx` |
| Engine API client | `desktop/src/lib/api.ts` |
| Auth hook | `desktop/src/hooks/use-auth.ts` |
| Engine hook | `desktop/src/hooks/use-engine.ts` |
| Theme hook | `desktop/src/hooks/use-theme.ts` |
| Settings persistence | `desktop/src/lib/settings.ts` |
| Sidecar / update utils | `desktop/src/lib/sidecar.ts` |
| CSS theme vars | `desktop/src/index.css` |
| Tailwind config | `desktop/tailwind.config.ts` |
| Tauri config | `desktop/src-tauri/tauri.conf.json` |
| Rust core | `desktop/src-tauri/src/lib.rs` |
| Scraper bridge | `app/services/scraper/engine.py` |
| Document manager | `app/services/documents/file_manager.py` |
| Document Supabase client | `app/services/documents/supabase_client.py` |
| Document sync engine | `app/services/documents/sync_engine.py` |
| Document API routes | `app/api/document_routes.py` |
| Document tools | `app/tools/tools/documents.py` |
| Documents page | `desktop/src/pages/Documents.tsx` |
| Document components | `desktop/src/components/documents/*.tsx` |
| Documents hook | `desktop/src/hooks/use-documents.ts` |
| Realtime sync hook | `desktop/src/hooks/use-realtime-sync.ts` |
| DB migration (docs) | `migrations/001_documents_schema.sql` |
| DB migration (instances) | `migrations/002_app_instances_settings.sql` |
| Proxy integration guide | `docs/proxy-integration-guide.md` |
| Proxy testing guide | `docs/proxy-testing-guide.md` |
| Local settings file | `~/.matrx/settings.json` |
| Instance ID file | `~/.matrx/instance.json` |
| Transcription module (Rust) | `desktop/src-tauri/src/transcription/*.rs` |
| Transcription types (TS) | `desktop/src/lib/transcription/types.ts` |
| Transcription hook | `desktop/src/hooks/use-transcription.ts` |
| Transcription context (singleton) | `desktop/src/contexts/TranscriptionContext.tsx` |
| Transcription sessions hook | `desktop/src/hooks/use-transcription-sessions.ts` |
| Transcription sessions persistence | `desktop/src/lib/transcription/sessions.ts` |
| Voice page | `desktop/src/pages/Voice.tsx` |
| Wake word hook | `desktop/src/hooks/use-wake-word.ts` |
| Wake word context | `desktop/src/contexts/WakeWordContext.tsx` |
| Wake word Python service | `app/services/wake_word/service.py` |
| Wake word Python routes | `app/api/wake_word_routes.py` |
| Wake word Python models | `app/services/wake_word/models.py` |
| Transcription config | `~/{app_data}/transcription.json` |
| Whisper models | `~/{app_data}/models/*.bin` |
| LLM module (Rust) | `desktop/src-tauri/src/llm/*.rs` |
| LLM model catalog (Rust) | `desktop/src-tauri/src/llm/model_selector.rs` |
| LLM types (TS) | `desktop/src/lib/llm/types.ts` |
| LLM API client (TS) | `desktop/src/lib/llm/api.ts` |
| LLM hook | `desktop/src/hooks/use-llm.ts` |
| Local Models page | `desktop/src/pages/LocalModels.tsx` |
| LLM config | `~/{app_data}/llm.json` |
| GGUF models | `~/{app_data}/models/*.gguf` |
| llama-server binaries | `desktop/src-tauri/binaries/llama-server-*` |
| Image gen service | `app/services/image_gen/service.py` |
| Image gen model catalog | `app/services/image_gen/models.py` |
| Image gen API routes | `app/api/image_gen_routes.py` |
| Image gen TS client | `desktop/src/lib/image-gen/api.ts` |
| Image gen TS types | `desktop/src/lib/image-gen/types.ts` |
| TTS service | `app/services/tts/service.py` |
| TTS voice catalog | `app/services/tts/models.py` |
| TTS API routes | `app/api/tts_routes.py` |
| TTS TS types | `desktop/src/lib/tts/types.ts` |
| TTS TS API client | `desktop/src/lib/tts/api.ts` |
| TTS hook | `desktop/src/hooks/use-tts.ts` |
| TTS context (singleton) | `desktop/src/contexts/TtsContext.tsx` |
| TTS page | `desktop/src/pages/TextToSpeech.tsx` |
| TTS models/voices | `~/.matrx/tts/` |
| Chat TTS bridge hook | `desktop/src/hooks/use-chat-tts.ts` |
| Markdown-to-speech parser | `desktop/src/lib/parse-markdown-for-speech.ts` |
| Architecture docs | `ARCHITECTURE.md` |
| Task tracker | `AGENT_TASKS.md` |
| Backlog | `BACKLOG.md` |
| Scraper service (source) | `/Users/armanisadeghi/Code/aidream-current/scraper-service` |

---

## Database & Remote Services

### Three external connections:

1. **Supabase Auth** -- The AI Matrx Supabase instance (`txzxabzwovsujtloxrus`). Desktop app uses **publishable key** (not deprecated anon key). All operations use user's JWT. Never use service role key.
2. **Remote Scraper Server** -- `scraper.app.matrxserver.com`. Accessed via REST API with `Authorization: Bearer <token>`. Now supports both API key and Supabase JWT auth. The scraper's PostgreSQL is **internal-only** -- no direct DB access.
3. **Local Scraper Engine** -- The in-process scraper (scraper-service subtree). Can optionally connect to a **local** PostgreSQL (on the user's machine) for persistent scrape cache via `DATABASE_URL`, but defaults to in-memory TTLCache. This is NOT the remote server's database.

### Env var mapping:
| Var | File | Purpose |
|-----|------|---------|
| `VITE_SUPABASE_URL` | `desktop/.env` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | `desktop/.env` | Supabase publishable key (safe to embed) |
| `API_KEY` | root `.env` | Local engine's own auth key |
| `SCRAPER_API_KEY` | root `.env` | Remote scraper server API key (Bearer token) |
| `SCRAPER_SERVER_URL` | root `.env` | Remote scraper server base URL |
| `DATABASE_URL` | root `.env` | Optional **local** PostgreSQL for scraper cache (user's machine, NOT remote server) |

### Shipping / Production Auth Strategy:

**Decided:** Use Supabase as OAuth Server (https://supabase.com/docs/guides/auth/oauth-server).

- **Supabase publishable key** -- Safe to embed in binary (RLS enforced, client-side by design).
- **Scraper server auth** -- JWT validation added via JWKS endpoint. Users authenticate with Supabase, get a JWT, and that JWT works directly with the scraper server. No embedded API keys needed.
- **JWKS endpoint:** `https://txzxabzwovsujtloxrus.supabase.co/auth/v1/.well-known/jwks.json`
- **Signing key:** ECC P-256 (ES256), Key ID `8a68756f-4254-41d7-9871-a7615685e38a`
- **Env var on scraper server:** `SUPABASE_JWKS_URL` (set in Coolify, deployed)

### Scraper Server Source:

The scraper-service source repo is at `/Users/armanisadeghi/Code/aidream-current/scraper-service`. Changes pushed to main deploy automatically via Coolify. Key files:
- Auth: `app/api/auth.py` (supports API key + JWT)
- Config: `app/config.py` (Pydantic Settings)
- Tests: `tests/integration/test_api_endpoints.py`

---

## Env Files

**Root `.env`** -- Python engine config (API_KEY, SCRAPER_API_KEY, etc.). Not committed.

**`desktop/.env`** -- Supabase client config (VITE_* vars only). Not committed.

When editing `.env` files: comment out values instead of deleting them, with a note for Arman to clean up.

---

## Database Migrations

**Rule: Never create a migration file without immediately applying it.**

Migrations live in `migrations/NNN_name.sql`. The Supabase MCP (`plugin-supabase-supabase`) is available and must be used to apply every migration in the same session it is written. The target project is `txzxabzwovsujtloxrus` (automation-matrix).

Workflow for any schema change:
1. Write the migration SQL file in `migrations/`.
2. Immediately call `apply_migration` via the Supabase MCP — never leave a migration unapplied.
3. Call `execute_sql` to verify the schema change landed (e.g. check `information_schema.columns`).
4. Mark the corresponding `.arman/ARMAN_TASKS.md` item as done (if one exists).
5. Update `AGENT_TASKS.md` to record the migration was applied.

A migration file that exists on disk but has not been applied to Supabase is a broken state — it causes runtime errors (like `PGRST204 column not found`) that are hard to trace. If you find an unapplied migration in `migrations/`, apply it immediately before doing anything else.

---

## React Patterns — Critical Rules (Read Before Writing Any Hook or Page)

These rules exist because violations have caused **production outages** (infinite API polling loops that flood the Python engine, causing health checks to time out and the entire app to report "engine offline"). Every rule here maps to a real bug that shipped.

### The `actions` object must always be stable

Every custom hook that returns `[state, actions]` **must** wrap the `actions` object in `useMemo`. A plain object literal `{}` is a new reference on every render. Any `useEffect` or `useCallback` that lists `actions` in its dependency array will re-fire on every render if `actions` is not memoized — creating an infinite loop.

```ts
// WRONG — new object reference every render, causes infinite loops
const actions: MyActions = {
  doThing,
  doOtherThing,
};

// CORRECT — stable reference, only changes when the callbacks themselves change
const actions: MyActions = useMemo(
  () => ({ doThing, doOtherThing }),
  [doThing, doOtherThing],
);
```

All existing hooks (`use-tts.ts`, `use-llm.ts`, `use-transcription.ts`) already follow this pattern. Any new hook returning an `actions` object must do the same.

### Never use an `actions` object as a `useEffect` dependency

Even with `useMemo`, listing the entire `actions` object in a `useEffect` dependency array is fragile and communicates the wrong intent. Always list the specific function you actually call.

```ts
// WRONG — depends on entire actions object; loops if actions ever changes
useEffect(() => {
  actions.refreshStatus();
  actions.refreshVoices();
}, [actions]);

// CORRECT — depends only on the stable callbacks actually called
useEffect(() => {
  refreshStatus();
  refreshVoices();
}, []); // mount-only: [] is correct when these are stable useCallback fns
```

### Initialization fetches belong in the hook, not the page

If a page triggers a data fetch on mount, it belongs in a `useEffect([])` inside the hook itself — not in the page component. If the page does it with `[actions]` as a dep, the fetch re-runs every time the hook re-renders, which is every time the fetch completes (state update → re-render → new actions ref → effect re-runs).

```ts
// WRONG — in the page component; loops because actions is unstable
useEffect(() => {
  actions.refreshStatus();
}, [actions]);

// CORRECT — in the hook; runs once at mount, never again
useEffect(() => {
  refreshStatus();
  refreshVoices();
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

### Persistent state belongs in a Context, not a local hook call

Any state that must survive tab switches, focus/blur events, or window visibility changes must live in a React Context Provider mounted at the app level — not in a per-page `useFoo()` call. A hook called directly in a page component re-initializes every time the page unmounts and remounts.

The pattern used in this codebase (see `LlmContext.tsx`, `TtsContext.tsx`):

```ts
// context/FooContext.tsx
export function FooProvider({ children }) {
  const foo = useFoo(); // hook runs ONCE here, at app startup
  return <FooContext.Provider value={foo}>{children}</FooContext.Provider>;
}
export function useFooApp() {
  const ctx = useContext(FooContext);
  if (!ctx) throw new Error("useFooApp must be used within FooProvider");
  return ctx;
}
```

Pages then call `useFooApp()` (reads from context) instead of `useFoo()` (creates new instance). The Provider is registered in `App.tsx`.

**Existing singletons:** `LlmProvider`, `TtsProvider`, `TranscriptionProvider`, `WakeWordProvider`, `TranscriptionSessionsProvider`, `PermissionsProvider`, `AudioDevicesProvider`, `DownloadManagerProvider`. Any new feature with persistent or shared state follows this same pattern.

### Polling intervals must be narrowly gated

A `setInterval` inside `useEffect` is only acceptable when:
1. It polls a genuinely changing condition (e.g. `is_downloading` status).
2. The effect dependency is the **specific boolean/value** being watched, not a broad object.
3. The cleanup (`return () => clearInterval(id)`) is always present.

```ts
// WRONG — restarts the interval every time actions changes (every render)
useEffect(() => {
  if (state.status?.is_downloading) {
    const id = setInterval(() => actions.refreshStatus(), 2000);
    return () => clearInterval(id);
  }
}, [state.status?.is_downloading, actions]); // actions here is the bug

// CORRECT — interval is controlled only by the boolean that gates it
useEffect(() => {
  if (!status?.is_downloading) return;
  const id = setInterval(() => void refreshStatus(), 2000);
  return () => clearInterval(id);
}, [status?.is_downloading, refreshStatus]); // stable deps only
```

### Focus/visibility handlers must be intentional

`window.addEventListener("focus", ...)` and `document.addEventListener("visibilitychange", ...)` are legitimate only when re-fetching data that the user is likely to have changed in another app (e.g. a HuggingFace token set in a browser). They must **never** be used to re-initialize state that is already alive or to trigger a full data reload. Re-initializing on focus is a common source of loops that are hard to reproduce in dev but happen constantly in production.

---

## Arman's Preferences

- Prefers working through issues systematically, one at a time
- Wants all discovered issues tracked immediately in AGENT_TASKS.md, even mid-conversation
- Values architecture docs staying accurate -- update docs when code changes
- Production-grade only -- no stubs, no TODOs, no placeholder logic
- Keep solutions simple; avoid over-engineering
- Tasks for Arman go in `.arman/ARMAN_TASKS.md` -- keep them simple checkbox items with direct instructions
- Prefers I keep going without stopping until done or stuck
- OK with me creating/editing .env files directly -- just comment out instead of deleting values
