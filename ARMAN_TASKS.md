# Arman Tasks — Matrx Local

> Items that require Arman's manual action or decision. Agents cannot do these.

---

## Pending

### Auth & Integration
- [ ] **Restart the local engine** to pick up the auth fixes (new `/health`, `/version`, `/ports` endpoints + WebSocket auth)
- [ ] **Test web→local connection** from aimatrx.com after engine restart — verify 401 errors are gone

### Supabase & Database
- [ ] **Verify `app_settings` table exists** — In Supabase SQL Editor, run `SELECT * FROM app_settings LIMIT 1`. If missing, run `migrations/002_app_instances_settings.sql`. If exists, check RLS allows `auth.uid() = user_id`
- [ ] **Verify `note_folders` table + RLS** — New Folder / New Note fails silently. Run `SELECT * FROM note_folders LIMIT 1` in Supabase. If missing, run `migrations/001_documents_schema.sql`. Check RLS allows inserts for `auth.uid() = user_id`
- [ ] **Run migration 003** (`migrations/003_forbidden_urls.sql`) to enable cloud sync for forbidden URL list

### Configuration
- [ ] **Add `BRAVE_API_KEY`** to `.env` to enable web search tool
- [ ] **Confirm `MAIN_SERVER` URL** for the proxy test connection feature (e.g. `https://server.app.matrxserver.com`)
- [ ] **Add GitHub Actions secrets** for CI: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (from `desktop/.env`)

### Desktop App Polish
- [ ] **Replace placeholder app icon** — Generate/use AI Matrx logo for `desktop/src-tauri/icons/`
- [ ] **Test "Launch on Startup"** — Toggle on, quit app, log in to OS again, confirm auto-start
- [ ] **Test "Minimize to Tray"** — Toggle on, click close, confirm tray behavior, reopen

### CI / Release
- [ ] **Review PR #1** (`codex/create-user-friendly-ui-for-tools-tab`) — Tools UI improvements

---

## Completed
- [x] Run migration 001 (documents schema) ✓
- [x] Run migration 002 (app instances/settings) ✓
- [x] Enable Supabase Realtime on notes/folders/shares ✓
