# Arman Tasks

## Completed

- [x] Copy `desktop/.env.example` to `desktop/.env` with Supabase publishable key
- [x] Ensure OAuth redirect URLs are in Supabase Dashboard
- [x] Ensure Google, GitHub, and Apple providers are enabled
- [x] Copy root `.env.example` to `.env` and set `API_KEY`
- [x] Create root `.env` file with API_KEY, SCRAPER_API_KEY, SCRAPER_SERVER_URL
- [x] Do NOT set `DATABASE_URL` -- scraper DB is internal-only, all via REST API
- [x] Add `SUPABASE_JWKS_URL` to scraper server's Coolify env vars
- [x] Push scraper-service changes to main (JWT auth, PyJWT dependency)
- [x] Register matrx_local as OAuth application in Supabase (Client ID: `af37ec97-3e0c-423c-a205-3d6c5adc5645`)

## Current

- [ ] Set up GitHub Actions for signed Tauri builds. The signing private key is at `~/.tauri/matrx-local.key`. Set these as GitHub Actions secrets:
  - `TAURI_SIGNING_PRIVATE_KEY` -- contents of `~/.tauri/matrx-local.key`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` -- empty string (no password)
- [ ] Create first GitHub Release to test auto-updater flow

## Notes

- The scraper server now supports dual auth: API key (existing) AND Supabase JWT (new). Both work simultaneously.
- OAuth app registered: Client ID `af37ec97-3e0c-423c-a205-3d6c5adc5645`, type `public`.
- For shipping: desktop app users authenticate via Supabase OAuth, get a JWT, and that JWT works directly with the scraper server.
- No need to embed API keys in the desktop binary.
