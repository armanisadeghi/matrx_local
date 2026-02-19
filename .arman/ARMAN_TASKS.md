# Arman Tasks

- [X] Copy `desktop/.env.example` to `desktop/.env` and fill in your Supabase project URL and anon key (from AI Matrx Supabase Dashboard > Settings > API)
    - ARMAN: USED Updated supabase "Publishable key" and updated supabase client implementation
- [X] Ensure these OAuth redirect URLs are in Supabase Dashboard > Auth > URL Configuration > Redirect URLs:
  - `http://localhost:1420/auth/callback`
  - `tauri://localhost/auth/callback`
- [x] Ensure Google, GitHub, and Apple providers are enabled in Supabase Dashboard > Auth > Providers
- [x] Copy `.env.example` to `.env` at project root and set `API_KEY` (any value for local dev)
    - ARMAN: Generated using: openssl rand -hex 32
    Or do we need the actual api key? 
- [ ] Optionally set `DATABASE_URL` in `.env` to the dedicated scrape server PostgreSQL connection string
    - see for all info: /Users/armanisadeghi/Code/matrx_local/.arman/scraper-api-refernce.md
