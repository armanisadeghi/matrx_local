# Web Client → Matrx Local Engine Integration Guide

> For React developers integrating `aimatrx.com` with the user's local desktop engine.

## Architecture Overview

The desktop companion runs a FastAPI server on `127.0.0.1` (localhost only). The web app
communicates with it over HTTP/WebSocket. Both systems authenticate via the **same Supabase
instance** — the web app's existing JWT is the auth token.

```
Browser (aimatrx.com)                    Desktop Engine (127.0.0.1:22140)
┌─────────────────────┐                  ┌──────────────────────────┐
│ Supabase JWT        │ ──Bearer token──►│ Auth middleware          │
│ (from web login)    │ ◄── response ─── │ (checks token exists)    │
└─────────────────────┘                  └──────────────────────────┘
```

---

## 1. Engine Discovery

The engine listens on port **22140** by default, but may use 22141–22159 if the default
is occupied. Two discovery methods:

### Option A: File-based (Tauri/Electron apps only)
Read `~/.matrx/local.json`:
```json
{ "port": 22140, "host": "127.0.0.1", "url": "http://127.0.0.1:22140", "ws": "ws://127.0.0.1:22140/ws" }
```

### Option B: Port scanning (web apps)
Scan ports 22140–22159, hitting the public `/tools/list` endpoint:
```typescript
async function discoverEngine(): Promise<string | null> {
  for (let port = 22140; port < 22160; port++) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/tools/list`, {
        signal: AbortSignal.timeout(500),
      });
      if (resp.ok) return `http://127.0.0.1:${port}`;
    } catch { continue; }
  }
  return null;
}
```

---

## 2. Authentication

### Public endpoints (no auth required)
These can be called without any `Authorization` header:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Root status |
| GET | `/health` | Health check |
| GET | `/version` | Engine version |
| GET | `/ports` | Engine & proxy ports |
| GET | `/tools/list` | List available tools |
| GET | `/docs` | OpenAPI docs |
| GET | `/devices/*` | Device & permission status |

### Protected endpoints (Bearer token required)
All other endpoints require the Supabase JWT:

```typescript
const { data: { session } } = await supabase.auth.getSession();

const resp = await fetch('http://127.0.0.1:22140/tools/invoke', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
  },
  body: JSON.stringify({ tool: 'Scrape', input: { urls: ['https://example.com'] } }),
});
```

For **SSE/EventSource** connections (which can't set headers), pass the token as a query param:
```
http://127.0.0.1:22140/logs/stream?token=<jwt>
```

---

## 3. CORS

The engine allows requests from these origins:
- `https://aimatrx.com`, `https://www.aimatrx.com`
- `http://localhost:3000–3002`, `http://localhost:5173`
- `tauri://localhost`

Custom origins can be set via the `ALLOWED_ORIGINS` env var.

---

## 4. Key Endpoints

### Tools
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/tools/list` | No | List available tool names |
| POST | `/tools/invoke` | **Yes** | Invoke a tool: `{ "tool": "Scrape", "input": {...} }` |

### Scraping
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/remote-scraper/scrape` | **Yes** | Scrape via remote server |
| POST | `/remote-scraper/scrape/stream` | **Yes** | SSE stream of scrape results |

### Cloud Sync
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/cloud/configure` | **Yes** | Configure sync with JWT + user_id |
| POST | `/cloud/heartbeat` | No | Update last_seen timestamp |
| POST | `/cloud/sync` | **Yes** | Trigger bidirectional sync |

### Files & System
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/system/info` | **Yes** | System information |
| GET | `/files` | **Yes** | List files in a directory |
| POST | `/screenshot` | **Yes** | Capture a screenshot |

---

## 5. WebSocket

Connect to `ws://127.0.0.1:{port}/ws` for persistent, stateful tool sessions.
WebSocket messages are JSON:

```json
// Request
{ "id": "req-1", "tool": "Shell", "input": { "command": "ls -la" } }

// Response
{ "id": "req-1", "type": "success", "output": "..." }
```

---

## 6. Error Handling

| Status | Meaning |
|--------|---------|
| 401 | Missing or invalid Bearer token — get a fresh Supabase session |
| 404 | Endpoint doesn't exist — check engine version |
| 500 | Server error — check engine logs at `GET /logs` |
| Connection refused | Engine not running — prompt user to start the desktop app |
