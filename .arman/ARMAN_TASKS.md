# Arman Tasks — Matrx Local

_Last updated: 2026-03-25_

> Secrets, accounts, CDN, OS-only steps. Code work → `AGENT_TASKS.md`.

---

## Active

- [ ] **Train “Hey Matrix” OWW model** — [`docs/wake-word-training.md`](../docs/wake-word-training.md)
- [ ] **Windows EV code-signing cert** — Before broad public launch (SmartScreen).
- [ ] **`MAIN_SERVER` URL** — For a future “real” proxy proof test (callback from server). Pick canonical production base URL.
- [ ] **CDN: GGUF mirrors** — `assets.aimatrx.com/llm-models/` (per prior plan).
- [ ] **CDN: llama-server binaries** — `assets.aimatrx.com/llama-server/`.
- [ ] **CDN: Whisper `.bin` models** — `assets.aimatrx.com/whisper-models/`.
- [ ] **Image gen: FLUX.1 Dev HF gate** — Accept license at `https://huggingface.co/black-forest-labs/FLUX.1-dev` with your HF account so downloads work for gated users.

**GitHub Actions secrets** (if anything missing on new fork): `AIDREAM_SERVER_URL_LIVE`, `VITE_SUPABASE_*`.

---

## Future

- [ ] **AIDream AI relay** — JWT-authenticated endpoint so desktop can run cloud models without user API keys.
- [ ] **Scraper rate limits** — Per-user on remote server.
- [ ] **Wake-on-LAN / home APIs** — Backlog.
- [ ] **Reverse tunnel product** — Backlog.
- [ ] **Personal Cloudflare tunnel cleanup** — Optional; see old notes in repo if still applicable.

---

## Review queue (doc / backlog audit 2026-03-24)

_Skim and check off or delete files._

| Item | Note |
|------|------|
| [`AGENT_TASKS.md`](../AGENT_TASKS.md) — “Doc hygiene → candidates” table | Delete or archive the two `.arman/.../INITIAL.md` drafts? Trim [`PLATFORM_AUDIT.md`](../PLATFORM_AUDIT.md)? |
| [`PLATFORM_AUDIT.md`](../PLATFORM_AUDIT.md) | Says `initPlatformCtx` never called — **wrong**; `use-engine.ts` wires it. Either delete or rewrite Phase 1. |
| [`.arman/pending/ui-overhaul/INITIAL.md`](pending/ui-overhaul/INITIAL.md) | 600+ line draft UI overhaul; partially superseded by real Tools work. |
| [`.arman/in-progress/proxy/INITIAL.md`](in-progress/proxy/INITIAL.md) | Generic proxy research; safe to delete if you agree. |
| [`local-llm-inference-integration.md`](../local-llm-inference-integration.md) | Long operational doc — keep; update when LLM packaging changes. |
| [`whisper-transcription-integration.md`](../whisper-transcription-integration.md) | Same for voice. |
| [`docs/react-migration-notes-api.md`](../docs/react-migration-notes-api.md) | Still valid for external clients (`/documents` → `/notes`). |

**Suggested tickets to spawn (your call):**

1. **ORM / matrx-ai safety review** — Decide what “client-only” means for shipping; track in AGENT P0.
2. **App store assets** — Icon + screenshots when branding final.
3. **Production Supabase health** — If any user still sees `app_settings` 404, RLS/project mismatch; SQL verify on `txzxabzwovsujtloxrus`.

---

## Done

- [x] Apple Developer / notarization path live.
- [x] Supabase OAuth redirect `aimatrx://auth/callback`.
- [x] `app_settings` / `note_folders` verified in Supabase + RLS (historical session).
- [x] Migrations 003 `forbidden_urls`, 005 hardware columns, 006–008 hardware/tunnel (`per prior sessions`).
- [x] llama-server binaries downloaded via `scripts/download-llama-server.sh` (per ARMAN note 2026).
- [x] GitHub secrets: `AIDREAM_SERVER_URL_LIVE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY`.
- [x] Windows installer NSIS + hooks.
- [x] First-run / setup wizard shipped in app (`FirstRunScreen` + wizard).

