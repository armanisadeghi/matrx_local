# Matrx Local -- Task Tracker

_Last updated: 2026-03-11_

> Living document. Every discovered bug, missing feature, or architectural issue gets logged here immediately.
> Check items off as they're resolved. Move completed items to the History section at the bottom.

---

## 🔴 AGENT PRIORITY QUEUE

> Pick tasks from top to bottom. Each is self-contained.

### P0 — Engine startup crash (blocks all features)
- [x] **`matrx_ai` package crashes on import** — Fixed. Moved `app.mount("/chat/ai", build_ai_sub_app())` from module-level in `app/main.py` into the lifespan handler (Phase 1b), after `initialize_matrx_ai()` registers the `supabase_automation_matrix` DB config. The ORM auto-fetch triggered by `matrx_ai` module-level imports now finds the config already registered.

### P1 — Local LLM Inference (llama-server sidecar)
- [x] **Rust LLM module created** — `src-tauri/src/llm/` with `mod.rs`, `config.rs`, `model_selector.rs`, `server.rs`, `commands.rs`. 10 Tauri commands registered for server lifecycle, model management, hardware detection, and setup status.
- [x] **Frontend integration** — `lib/llm/types.ts`, `lib/llm/api.ts` (chat completion, streaming, tool calling, structured output), `hooks/use-llm.ts`, `pages/LocalModels.tsx` with 5 admin tabs (Overview, Models, Server, Hardware, Test).
- [x] **Tauri config updated** — `binaries/llama-server` added to `externalBin`, `shell:allow-kill` permission added.
- [x] **Sidebar entry added** — "Local Models" with BrainCircuit icon at `/local-models`.
- [ ] **llama-server binaries not yet bundled** — Need to download pre-built binaries from llama.cpp releases and place in `src-tauri/binaries/` with Tauri triple naming convention (`llama-server-aarch64-apple-darwin`, `llama-server-x86_64-pc-windows-msvc.exe`, `llama-server-x86_64-unknown-linux-gnu`). See ARMAN_TASKS.
- [x] **Model download URLs fixed (2026-03-11)** — All 5 model URLs and filenames verified against live HuggingFace API + HEAD requests. Fixed: (1) `Phi-4-mini` repo didn't exist publicly — now uses `bartowski/microsoft_Phi-4-mini-instruct-GGUF` with correct filename `microsoft_Phi-4-mini-instruct-Q4_K_M.gguf`; (2) `Qwen2.5-14B` Q4_K_M single-file URL never existed — now downloads 3 split parts and concatenates them; (3) `Mistral-Small-3.1-24B` `bartowski` repo requires auth — now uses `lmstudio-community` (public, single file). Download command signature changed from `url: String` to `urls: Vec<String>` supporting both single and split models.
- [ ] **CDN mirror not set up** — GGUF models download directly from HuggingFace. Mirror to `assets.aimatrx.com` before production shipping.
- [ ] **Cloud capability exposure** — System info and available models should be synced to Supabase so the web app knows each device's local LLM capabilities.

### P0 — Fix broken core features (ship blockers)
- [x] **Auth was using wrong OAuth flow** — `signInWithOAuth({ provider: "google" })` used Supabase as a social auth passthrough (treating Supabase as the identity provider for THIS app), not our registered OAuth 2.1 client. Rewrote to use the proper OAuth 2.1 authorization code flow with PKCE: desktop app redirects user to `https://txzxabzwovsujtloxrus.supabase.co/auth/v1/oauth/authorize?client_id=af37ec97-3e0c-423c-a205-3d6c5adc5645&...`. User goes to our consent UI at `https://www.aimatrx.com/oauth/consent`, approves, and the code arrives at the registered redirect_uri. Token exchange is then done directly at the Supabase token endpoint — no provider credentials embedded in the binary. Affected files: `lib/oauth.ts` (new), `hooks/use-auth.ts`, `pages/OAuthPending.tsx`, `pages/AuthCallback.tsx`, `App.tsx`.
- [ ] **App icon is default purple box** — Replace placeholder icons in `desktop/src-tauri/icons/` with the AI Matrx logo.
- [ ] **Windows MSI installer looks outdated** — Investigate switching from WiX (.msi) to NSIS (.exe) for a modern installer experience.
- [ ] **Proxy `POST /system/open-folder` 500 Error** — Investigation needed into why this endpoint fails with 500 Internal Server Error when clicking "Open Logs/Data Folder".

### P0 — Cloud Instance Registration (partially fixed)

- [x] **409 on `register_instance` and `push_to_cloud`** — Root cause: PostgREST's `resolution=merge-duplicates` upsert requires an explicit `?on_conflict=col1,col2` parameter to identify which unique constraint to use; without it the upsert falls through to a plain INSERT which collides with the existing row. Fixed by adding `?on_conflict=user_id,instance_id` to both `register_instance` (app_instances) and `_push_to_cloud` (app_settings) URLs. Also added `hardware_uuid`, `serial_number`, and `board_id` to system info collection and registration payload; migration `005_hardware_identity.sql` adds the columns to `app_instances`.

- [ ] **Verify registrations now succeed** — Start engine, log in, hit `GET /cloud/debug`. Confirm `is_orphan=false` and `last_registration_result="ok"`.
  - **If still failing:** The remaining cause is likely RLS. The app uses Supabase OAuth (the desktop OAuth flow), which issues a JWT for the user. However, `auth.uid()` in Supabase RLS only resolves correctly when the JWT `sub` claim matches the `auth.users` table. If the OAuth app is registered as a separate provider or the JWT `aud` claim doesn't match the Supabase project, RLS returns 0 rows silently or a 401/403.
  - **Investigation steps:**
    1. Hit `GET /cloud/debug` after login — copy `last_error` verbatim from the response.
    2. If error is `HTTP 401` → JWT is being rejected outright (wrong key, expired, or wrong `aud`).
    3. If error is `HTTP 403` or empty 2xx body → RLS is blocking. Go to Supabase SQL Editor and run: `SELECT auth.uid()` with the user's JWT to confirm it resolves. Also check that the `app_instances` INSERT policy uses `auth.uid() = user_id` and that the JWT `sub` equals the `user_id` being sent.
    4. If error is `HTTP 200` but empty → RLS is silently filtering the upsert result. The `Prefer: resolution=merge-duplicates` upsert may need `auth.uid()` to match the row being written.
  - **Workaround if RLS can't be fixed:** Add a service-role API route on the engine that writes to `app_instances` server-side using the service key (never exposed to the client). This bypasses RLS entirely and is safe because the engine already authenticates the user via JWT.
  - **Frontend impact:** `GET /cloud/instances` now returns `is_orphan: true` and `this_instance_id` when the instance isn't registered. The frontend must surface a prominent (non-blocking) warning when `is_orphan` is true.

- [ ] **Frontend: Surface orphan instance warning in the UI.**
  - When `GET /cloud/instances` returns `is_orphan: true`, show a persistent banner on the Settings page (and ideally the Dashboard) saying the device is not registered with the cloud.
  - Include a "Retry Registration" button that calls `POST /cloud/configure` again with the current session JWT.
  - Must be non-blocking — the app works fully locally even when orphaned.

- [ ] **`forbidden_urls` Supabase table (migration 003) is dead code.**
  - The table exists in Supabase but nothing reads from or writes to it.
  - Currently forbidden URLs are stored in the local settings JSON blob via `settings_routes.py`.
  - This means a user's blocked URLs do NOT sync across devices.
  - This table is for the scraper — it blocks certain domains from being scraped.
  - Decision needed: wire it up to Supabase (so it syncs) or leave it local-only.
  - If wiring up: `settings_routes.py` should read/write `forbidden_urls` table when `sync.is_configured`, fall back to local blob otherwise.

### P1 — UX & Settings (needed before public beta)
- [ ] **Tools UI is not user-friendly** — PR #1 (`codex/create-user-friendly-ui-for-tools-tab`) exists. Pull and review.
- [ ] **Verify "Launch on Startup" & "Minimize to Tray"** — Confirm OS-level behavior actually matches the toggles in Settings.
- [ ] **Proxy Test Connection** — Waiting on Arman to confirm `MAIN_SERVER` URL for real round-trip test.

### P2 — Features & Polish
- [ ] **First-run setup wizard** — Sign in → Engine health → optional capabilities install → done.
- [ ] **Rate limiting** — Implement per-user rate limiting on the remote scraper server.
- [ ] **Job queue** — For cloud-assigned scrape jobs.
- [ ] **Wake-on-LAN & Smart device control protocols**.

---

## 🟡 OPEN ISSUES & BUGS (Organized by Feature)

### Devices / Permissions
- [x] **Screen Recording permission prompt keeps re-appearing** — Fixed. See History section for details.

### Dashboard
- [ ] Status indicators can sometimes lag behind actual engine state.

### Notes / Documents
- [ ] **Notes page:** UI still calls `/documents/*` — may need to be updated to `/notes/*` if React code is not using the `engine.docRequest` helper in `api.ts`.
- [ ] Conflict resolution UI needs testing with real simultaneous edits after local-first rewrite.
- [ ] Run `migrations/001_documents_schema.sql` on Supabase if cloud sync is desired (not required for local-first operation).

### Tools Page
- [ ] PR #1 for user-friendly UI needs review.
- [ ] Some tools lack descriptive error messages for missing dependencies.

### Settings
- [ ] **General:** "Engine Port" reconnect/restart reliability needs testing.
- [ ] **Proxy:** Test button is currently a placeholder for a real round-trip test.

### CI/CD & Shipping
- [ ] v1.0.0 fix verification (Windows venv path detection, extra all packages).

---

## ✅ HISTORY OF COMPLETED TASKS

### Permission Check Bug Fix (2026-03-05)
- [x] **Screen Recording re-prompt bug** — `check_screen_recording()` called `screencapture -x -t png <tmp>` as a liveness probe. macOS TCC permission is bound to the **process identity** (bundle ID / code signature), not the user. The Python sidecar has a different identity than the Tauri `.app` bundle, so macOS fires the consent notification on every check even after the user has granted permission. Fixed by replacing the probe with `Quartz.CGPreflightScreenCaptureAccess()` from `pyobjc-framework-Quartz`, which reads the TCC database directly without performing any capture and without triggering the prompt. Added `pyobjc-framework-Quartz; sys_platform == 'darwin'` to `pyproject.toml`.

### Local-First Architecture Implementation (2026-03-03)
- [x] **config.py:** Added `MATRX_USER_DIR`, `MATRX_NOTES_DIR`, `MATRX_FILES_DIR`, `MATRX_CODE_DIR`, `MATRX_WORKSPACES_DIR`, `MATRX_DATA_DIR`. All user-visible content now lives under `~/Documents/Matrx/` (OS-native Documents folder). Engine internals stay in `~/.matrx/`.
- [x] **file_manager.py:** Updated to use `MATRX_NOTES_DIR`. Startup now creates all required directories (Notes, Files, Code, workspaces, data) in one pass.
- [x] **document_routes.py:** Fully rewritten. Every CRUD operation reads/writes local filesystem first. Supabase is only touched in background fire-and-forget tasks — a failed network never blocks or errors a request. Folder tree is now built from local filesystem scan (no Supabase needed).
- [x] **sync_engine.py:** Architecture already correct (local write before Supabase). Updated docstring to clarify local-first contract.
- [x] **session.py / `_build_alias_map()`:** Added `@notes`, `@files`, `@code`, `@workspaces`, `@agentdata`, `@user` aliases. Old `@docs` kept as deprecated alias.
- [x] **main.py:** Router registered under `/notes` (canonical) and `/documents` (backward-compat alias, hidden from schema).
- [x] **api.ts:** `docRequest` updated to call `/notes`. `EnginePaths` interface updated with all new path fields.
- [x] **routes.py / GET /system/paths:** Returns all new paths so React can discover them.
- [x] **docs/local-storage-architecture.md:** Authored, documenting the golden rules and directory structure.
- [x] **docs/path-resolution-guide.md:** Authored, explaining aliases for the React team.

### Recently Fixed (2026-03-02)
- [x] Fixed 401 Unauthorized on web→local API calls.
- [x] Replaced raw pip commands with "Fix It" messages and capability IDs.
- [x] Fixed blank screen in production builds (HashRouter + CI env vars).
- [x] Dashboard: Added user profile card with avatar and sign-out.
- [x] Dashboard: Fixed Browser Engine status label and installation button.
- [x] Dashboard: Added live CPU/RAM/Disk/Battery resource gauges.
- [x] Documents: Wired sync bar to real trigger; verified backend/frontend logic.
- [x] Scraping: Overhauled UX with flat list, history tab, and auto-prefixing.
- [x] Scraping: Implemented persistence (localStorage) and forbidden URL list.
- [x] Activity: Implemented real-time HTTP and system log streaming.
- [x] Tools: Added monitoring sparklines, improved browser control, and notify fallbacks.
- [x] CI/CD: Wired GitHub Actions for 4-platform builds and releases.
- [x] Verification: Confirmed File picker, Installed Apps persistence, and Scheduler persistence.

### Core Infrastructure & Infrastructure (2026-02)
- [x] Architecture: Unified database strategy using `DATABASE_URL`.
- [x] Auth: Implemented JWT auth on scraper server (dual-auth with API keys).
- [x] Auth: Forwarded JWT from engine to scraper server via bearer token.
- [x] Engine: Fixed lifespan hang when `DATABASE_URL` leaks from shell.
- [x] Desktop: Created `supabase.ts` and `.env` for production builds.
- [x] Settings: Implemented theme switching and native settings persistence.
- [x] Settings: Added "Launch on Startup" and "Minimize to Tray" (Rust side).
- [x] Remote: Created `remote_client.py` and `/remote-scraper/*` proxy routes.
- [x] SSE: Implemented real-time log and scrape result streaming.

### Module Specifics
- [x] **Tools:** Registered 79 tools across 10 categories (Media, Network, Browser, etc.).
- [x] **Documents:** Full sync engine with conflict detection and file watcher.
- [x] **Chat:** Implemented collapsible sidebar and streaming tool-call UI.
- [x] **Proxy:** Developed async HTTP proxy server with CONNECT tunneling.
- [x] **Activity:** Created two-tab real-time viewer for HTTP and System logs.
