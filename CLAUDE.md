# CLAUDE.md -- Matrx Local Project Instructions

> Project-specific instructions for AI assistants working on this codebase.
> This supplements the global `/Users/armanisadeghi/Code/CLAUDE.md`.

---

## Project Overview

Matrx Local is a **Tauri v2 desktop app** (Rust shell + React UI) with a **Python/FastAPI backend engine** that runs as a sidecar. It exposes 23 tools (filesystem, shell, scraping, etc.) via REST and WebSocket for the AI Matrx cloud platform.

**This is NOT a Next.js project.** The global CLAUDE.md's Next.js/Vercel rules do not apply here. This project uses:
- **Desktop:** Tauri v2 (Rust) + React 19 + TypeScript 5.7 + Vite 6
- **Styling:** Tailwind CSS 3.4 + shadcn/ui (Radix UI) -- `darkMode: "class"` strategy
- **Backend:** Python 3.13+ / FastAPI / Uvicorn
- **Auth:** Supabase Auth (OAuth + email)
- **DB:** PostgreSQL via Supabase (optional, graceful degradation to in-memory)
- **Scraping:** Integrated scraper-service (git subtree, read-only)
- **Package Managers:** npm (desktop), uv (Python)

---

## Key Architecture Rules

1. **scraper-service/ is read-only** -- It's a git subtree from the `ai-dream` repo. Never edit files there directly. Use `./scripts/update-scraper.sh` to pull updates.
2. **Module isolation** -- The scraper's `app/` is aliased as `scraper_app/` via `sys.modules` in `app/services/scraper/engine.py`. Do not create naming conflicts.
3. **Graceful degradation** -- The engine works without PostgreSQL (memory cache), Playwright (curl-cffi fallback), or Brave API (search disabled). Never make these hard dependencies.
4. **Port 22140** -- Default engine port. Auto-scans 22140-22159. Discovery file at `~/.matrx/local.json`.

---

## Task Tracking

**Two tracking files:**

1. **`TASKS.md`** (project root) -- All bugs, issues, and improvement ideas. Update immediately when:
   - A new bug or issue is discovered
   - An existing task is resolved (check it off)
   - Investigation reveals new details about an existing task

2. **`.arman/ARMAN_TASKS.md`** -- Tasks for Arman to complete manually (Supabase config, env setup, etc.). Keep entries **simple and concise**: just a checkbox and brief direct instructions. No verbose explanations.

Never let a discovered issue go untracked. If we're in the middle of something else, add it to the right file and continue.

---

## Current State (as of 2026-02-19)

### What Works
- Python FastAPI engine with 23 tools (REST + WebSocket)
- Engine auto-discovery from React UI
- Tool browser and invocation (Tools page)
- Scraping interface (Scraping page)
- Activity log with real-time WebSocket events
- Dashboard with live system info and browser detection
- Tauri sidecar lifecycle (spawn/kill)
- CORS configuration

### Recently Fixed
- **`supabase.ts` created** -- Auth client singleton with env-based config
- **Theme switching works** -- `use-theme.ts` hook manages `.dark` class, persists to localStorage, supports system detection
- **Settings persisted** -- `lib/settings.ts` with localStorage backend
- **Button handlers wired** -- Open Logs/Data via `OpenPath` tool, Restart Engine via sidecar stop/start
- **`database.py` fixed** -- Uses `DATABASE_URL` from config, no more hardcoded credentials
- **Health endpoint mismatch fixed** -- `sidecar.ts` now uses `/tools/list` consistently
- **Stale closure fixed** -- `use-engine.ts` health check uses ref pattern

### Still Needs Work
- **No auth validation** on Python endpoints (security)
- **Launch on Startup / Minimize to Tray** -- Persisted locally but not wired to OS/Tauri
- **Scraping settings not sent to engine** -- Headless mode and request delay need engine API endpoint
- **No error boundary** -- App crashes entirely on unhandled errors
- **Version hardcoded** in Settings About section
- **Arman tasks** -- Needs to create `.env` files with actual credentials (see `.arman/ARMAN_TASKS.md`)

---

## Development Commands

```bash
# Python engine (Terminal 1)
cd /path/to/matrx_local
uv sync --extra browser
uv run python run.py

# React frontend (Terminal 2)
cd desktop
npm install
npm run dev
# Open http://localhost:1420

# Tauri desktop (requires Rust)
cd desktop
npm run tauri:dev
```

---

## File Locations

| What | Where |
|------|-------|
| Python entry point | `run.py` |
| FastAPI app | `app/main.py` |
| Tool implementations | `app/tools/tools/*.py` |
| React entry | `desktop/src/App.tsx` |
| Settings page | `desktop/src/pages/Settings.tsx` |
| Engine API client | `desktop/src/lib/api.ts` |
| Auth hook | `desktop/src/hooks/use-auth.ts` |
| Engine hook | `desktop/src/hooks/use-engine.ts` |
| CSS theme vars | `desktop/src/index.css` |
| Tailwind config | `desktop/tailwind.config.ts` |
| Tauri config | `desktop/src-tauri/tauri.conf.json` |
| Rust core | `desktop/src-tauri/src/lib.rs` |
| Scraper bridge | `app/services/scraper/engine.py` |
| Architecture docs | `ARCHITECTURE.md` |
| Task tracker | `TASKS.md` |
| Backlog | `BACKLOG.md` |

---

## Database Architecture

Three separate database concerns:

1. **Scrape Server** -- Dedicated PostgreSQL server for the scraping system. Connected via `DATABASE_URL` env var. Used for scrape cache, domain configs, failure logs. Runs on its own server, not Supabase.
2. **Main App Supabase** -- The AI Matrx platform's Supabase instance. This desktop app communicates with it **strictly using the client auth token** (anon key + user JWT). Never use the service role key from this app.
3. **In-Memory Cache** -- Default when no `DATABASE_URL` is set. Graceful fallback.

**Important:** The desktop app must never bypass Supabase RLS. All Supabase operations go through the client with the user's auth token only.

---

## Arman's Preferences

- Prefers working through issues systematically, one at a time
- Wants all discovered issues tracked immediately in TASKS.md, even mid-conversation
- Values architecture docs staying accurate -- update docs when code changes
- Production-grade only -- no stubs, no TODOs, no placeholder logic
- Keep solutions simple; avoid over-engineering
- Tasks for Arman go in `.arman/ARMAN_TASKS.md` -- keep them simple checkbox items with direct instructions
- Prefers I keep going without stopping until done or stuck
