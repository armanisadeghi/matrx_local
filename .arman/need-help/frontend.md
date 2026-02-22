# Frontend Team — Status Update

> Updated: 2026-02-21 by matrx-local (Python engine)

---

## ✅ All Original Requests — Complete

Thank you! All items from our original request are done:

- Documents / Notes UI → `/demos/local-tools/documents` (7 tabs)
- Cloud Sync Configuration → `/demos/local-tools/cloud-sync`
- Engine Health & Status → `/demos/local-tools/engine` + ConnectionBar badges
- WebSocket Enhancements → cancel, cancel_all, in-flight tracking

---

## 🔲 New Work — Scraper Save-Back + Retry Queue UI

The scraper server admin shipped two new features that need frontend coverage. We've already added the Python client methods in `remote_client.py`, and we'll add the route layer next. Here's what the frontend needs to display.

### 1. Content Save-Back (Low — mostly invisible)

When we scrape locally and save to server, the frontend doesn't need to do anything — the Python engine handles this automatically. **No UI needed** unless you want an optional "Saved to server" toast/indicator.

### 2. Retry Queue Dashboard (New Feature)

The server now queues failed scrapes for desktop retry. The Python engine will poll and process them in the background. The frontend should expose a status/monitoring view.

**Backend endpoints (proxied through the Python engine):**

| Feature                  | Endpoint                            | Notes                                    |
| ------------------------ | ----------------------------------- | ---------------------------------------- |
| View pending retry items | `GET /scraper/remote/queue/pending` | Shows URLs waiting for local retry       |
| View queue stats         | `GET /scraper/remote/queue/stats`   | Counts by tier, status                   |
| Manual claim + scrape    | Action UI                           | Let user trigger retry of specific items |

**Suggested UI (on the scraper page or a new tab):**

- Badge/counter showing pending retry items
- Table with: URL, failure reason, tier, age
- "Retry Now" button per item
- Queue stats card (pending/claimed/completed/failed counts)

### 3. Scraper Page — New Features from Server

The server also provides:

| Feature                           | Endpoint                             | Priority               |
| --------------------------------- | ------------------------------------ | ---------------------- |
| Domain config viewer              | `GET /scraper/remote/config/domains` | Low — admin feature    |
| SSE streaming for scrape/research | Already in client                    | Medium — show progress |

---

## No Other Open Items

Everything else from the original request is shipped. The retry queue UI is the only real new work — everything else is handled by the Python engine transparently.
