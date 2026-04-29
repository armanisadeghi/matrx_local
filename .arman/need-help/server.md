# Scraper Server Integration — Status

> Updated: 2026-04-29 by matrx-local (Python engine)
> Server: `scraper.app.matrxserver.com`
>
> **Server-side auth enforcement is now LIVE (2026-04-29).** Every
> `/api/scraper/*` route returns `401 {"detail":{"error":"token_required",...}}`
> if `Authorization: Bearer <supabase_jwt>` is missing or invalid. `/health`
> and `/health/ready` stay public. The desktop app already forwards JWTs
> after the lockstep migration, so this should not change desktop behavior
> — but if you do see new 401s after sign-in, the JWT either expired or
> wasn't fetched from `TokenRepo`.

---

## ✅ Migration to new contract complete (server-side + Python client)

The standalone scraper service was rewritten in the `aidream-current` monorepo
as `packages/matrx-scraper`. It is **the same package** that aidream-server
mounts internally — the standalone microservice and the embedded routes share
one codebase. This was deployed and verified live on 2026-04-28.

### What changed on the server

| Concern             | Before                              | After                                     |
| ------------------- | ----------------------------------- | ----------------------------------------- |
| Base path           | `/api/v1/*`                         | `/api/scraper/*`                          |
| Health (liveness)   | `/api/v1/health`                    | `/health`                                 |
| Health (readiness)  | n/a                                 | `/health/ready`                           |
| Auth                | `X-API-Key: <org_key>` OR Bearer    | `Authorization: Bearer <supabase_jwt>` only |
| `scrape` (sync)     | `POST /api/v1/scrape`               | `POST /api/scraper/batch`                 |
| `research` (sync)   | `POST /api/v1/research`             | `POST /api/scraper/search-and-scrape` with `{"options":{"fast":true}}` |
| Page response field | `page.status == "success"`          | `page.success: bool`                      |
| Page error field    | `page.error`                        | `page.failure_reason`                     |
| Save content        | `POST /api/v1/content/save`         | `POST /api/scraper/content/save`          |
| Queue endpoints     | `/api/v1/queue/*`                   | `/api/scraper/queue/*`                    |

### What changed in matrx-local (already pushed)

- `app/services/scraper/remote_client.py`
  - All hardcoded `/api/v1/*` paths swapped to `/api/scraper/*`
  - `health()` now hits `/health/ready`
  - `scrape()` calls `/batch` (non-streaming)
  - `research()` remapped to `search-and-scrape` with `fast=True`
  - Docstrings updated for new response field names (`success`, `failure_reason`)

- `app/api/remote_scraper_routes.py`
  - Same path swap for the local FastAPI proxy used by the desktop UI

- **`app/services/scraper/auth_helper.py` (new)**
  - `get_active_user_token()` — pulls a non-expired Supabase JWT from the local
    `TokenRepo` so background tasks can attribute writes to a real user.

- `app/services/scraper/retry_queue.py`
  - `_poll_once()` now fetches the active user JWT once per cycle and forwards
    it on every server call (`get_pending`, `claim_items`, `submit_result`,
    `save_content`, `report_failure`). If no user is signed in, the cycle is a
    no-op.

- `app/services/scraper/scrape_store.py`
  - `_push_one_to_cloud()` now fetches the active user JWT before pushing.
    If no user is signed in, the row stays `pending` (not failed) so it will
    sync after sign-in.

- `app/tools/tools/scraper.py`
  - Already takes `auth_token` as a param; comment + docstring updated to point
    at `/api/scraper/content/save`.

---

## 🔲 What still needs verification on a real desktop

The server side has been smoke-tested with an admin JWT — `/health`,
`/health/ready`, `/api/scraper/queue/stats`, `/api/scraper/queue/pending`, and
`POST /api/scraper/quick-scrape` all return 200. What can't be tested from the
server is **JWT retrieval from a logged-in user's local SQLite**.

To verify end-to-end on a desktop:

1. Sign in to the desktop app (so `TokenRepo` has a fresh Supabase JWT).
2. Watch the desktop logs for the next retry-queue cycle. You should see
   `RetryQueue: ...` lines without the previous `401 Unauthorized` errors.
3. Run a local scrape from the UI — the cloud sync log should say
   `[scrape_store] Cloud sync OK: ...` instead of being deferred.

If you sign out, expect the new `RetryQueue: no active user token; skipping
cycle` debug log every poll interval — that's the new safe default, not a bug.

---

## API quick reference (current)

```
GET  /health                                # liveness
GET  /health/ready                          # readiness (used by Coolify HC)
GET  /api/scraper/queue/pending?tier=desktop&limit=10
POST /api/scraper/queue/claim
POST /api/scraper/queue/submit
POST /api/scraper/queue/fail
GET  /api/scraper/queue/stats
POST /api/scraper/content/save
POST /api/scraper/batch                     # was /scrape
POST /api/scraper/search-and-scrape         # also serves the old `research` use case
POST /api/scraper/quick-scrape
```

All require `Authorization: Bearer <supabase_jwt>`.

---

## Routing logic (unchanged)

1. Try remote first (faster, proxy pool, persistent cache)
2. If `CLOUDFLARE_BLOCK` or `BLOCKED` → retry locally (residential IP)
3. If both fail → queue for Chrome extension (future)
