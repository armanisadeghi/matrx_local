# Matrx Extend ↔ Matrx Local Connection

> Where the Chrome extension meets the desktop engine. Living doc; update on every protocol change.

## Role

`matrx-local` is the Tauri v2 desktop engine that exposes a local OS surface
(filesystem, shell, Whisper transcription, llama-server, OpenWakeWord, the
unified scrape proxy, ~80 dispatcher tools) over a loopback FastAPI sidecar.
`matrx-extend` is the Chrome extension that drives a frontier browser-agent
harness. The extension wants to *invoke* the local OS surface (extension →
local) **and** receive engine-pushed events when local code needs to drive
the browser (local → extension). This document is the contract for both
directions, the auth model, and how to add new commands without breaking
the channel.

## Surface area

| File | What it does | Direction |
|---|---|---|
| `app/api/extension_routes.py` (lines 23-47) | The `POST /extension/rpc` endpoint. Currently inline-handles only `command == "health"`; everything else returns `Unknown command`. Will delegate to a registry in Phase 1. | extension → local |
| `app/api/extension_handlers.py` (Phase 1, planned) | The `HANDLERS` dict — `command → async def handler(payload, request) -> dict`. One canonical place for every RPC verb, including the generic `tool` command that delegates into the dispatcher. | extension → local |
| `app/tools/dispatcher.py` (`dispatch(tool_name, tool_input, session) -> ToolResult`) | The clean public function any RPC handler uses to invoke any of the ~80 tools. Already has session, error envelopes, and tool-level auth checks. | extension → local |
| `app/websocket_manager.py` (lines ~200-220) | `broadcast()` and `broadcast_notification()` — production-ready engine→client push primitives over the existing `/ws` channel. Currently used by other features; the extension does not yet subscribe. | local → extension |
| `app/api/extension_invoke.py` (Phase 2, planned) | `invoke_extension_tool(tool_name, args, *, timeout=30) -> dict` — the outbound RPC primitive. Sends an envelope over the dedicated `/extension/ws` reverse channel and awaits a correlated reply by `callId`. | local → extension |

The Phase 2 dedicated channel `/extension/ws` is a sibling of the existing
`/ws` rather than a reuse, so engine-internal broadcasts (downloads, model
loading, transcription progress) stay on `/ws` and the extension reverse
channel stays focused on tool calls. Both run through
`app/websocket_manager.py` for connection bookkeeping.

## Observability

Every call into `/extension/*` (HTTP RPC, the introspection endpoints
under `/extension/sessions|invoke|broadcast/*`, plus WebSocket lifecycle
on `/extension/ws`) is timed and counted by an in-memory ring in
`app/api/extension_metrics.py`. The data resets on engine restart by
design — these are diagnostics, not audit logs.

Endpoints (Bearer-JWT-gated like the rest of `/extension/*`):

  * `GET  /extension/metrics`         — JSON snapshot, one row per
    command name (`rpc.command` → `tool`, `bridge:invoke`,
    `bridge:sessions`, `ws:connect`, `ws:disconnect`, `ws:message`,
    etc.). Each row carries `count`, `error_count`,
    `last_n_latencies_ms` (deque of up to 100), `last_called_at` (unix
    ms), `last_error`.
  * `POST /extension/metrics/reset`   — drops every row. Idempotent.

Bounds: per-command latency ring caps at 100 samples; distinct command
names cap at 200 (a synthetic `_overflow` row appears in the snapshot
when that cap is hit so callers can warn).

The desktop **Bridge Test** page (Settings → Bridge Test) has a "Request
metrics" sub-section inside Panel 1 (Engine self-check) that polls these
endpoints every 2s while visible and renders count / errors / p50 / p95
per command, plus a Reset button. p50 / p95 are computed client-side
from the latency deque.

## Substrates

The engine is reachable via **two URLs** at any given time:

  1. **Local loopback (always)** — `http://127.0.0.1:<port>` and
     `ws://127.0.0.1:<port>/ws` on the FastAPI sidecar (`22140` by
     default; auto-scans `22140-22159`). Zero-cost path for any client
     on the same machine as the engine. Default for the extension.
  2. **Cloudflare tunnel (when active)** — a `https://<random>.trycloudflare.com`
     URL produced by the cloudflared subprocess, plus its
     `wss://...trycloudflare.com/ws` equivalent. Lets a client on a
     different network (or behind a corporate firewall that blocks
     loopback access) reach the same engine. Quick mode (default) gets
     a fresh URL on every restart; named mode (set
     `CLOUDFLARE_TUNNEL_TOKEN`) produces a stable URL.

Both URLs hit the same FastAPI app and the same routes — there is no
"tunnel-only" surface. Auth, middleware, and rate limiting are
identical regardless of which URL was dialed.

The substrates within those URLs:

- **HTTP REST** — `POST /extension/rpc` for the synchronous primitives
  the extension uses (health, version, capabilities, the generic `tool`
  passthrough). Single request/response, JSON in / JSON out.
- **WebSocket (engine → client push)** — `/ws` is the existing broadcast
  channel for download progress, model lifecycle, transcription events, etc.
  Production-ready and unused by the extension today.
- **WebSocket (extension reverse channel)** — `/extension/ws` is the
  dedicated bidirectional channel where the engine asks the extension
  to run a browser tool. Envelope:
  - request: `{ "type": "extension.invoke", "callId": "<uuid>", "toolName": "...", "args": { ... } }`
  - reply: `{ "type": "extension.result", "callId": "<uuid>", "ok": true, "result": { ... } }`
    or `{ "type": "extension.result", "callId": "<uuid>", "ok": false, "error": "..." }`
  Default timeout 30 seconds; `invoke_extension_tool` rejects with a
  `TimeoutError` after that and the engine resumes whatever path called it.
- **Future fallback — Supabase Broadcast** — when extension and engine
  cannot reach either of the two URLs above (e.g. cloudflared blocked,
  user on a captive portal), both sides subscribe to channel
  `matrx-local-bridge:<userId>` over Supabase Realtime. Not implemented
  yet; design slot reserved.

### Discovery primitives

- **`~/.matrx/local.json` (on-disk, public)** — the bootstrap discovery
  file. Always contains `port`, `host`, `url`, `ws`, `pid`, `version`.
  When the Cloudflare tunnel is active, also contains `tunnel_url` and
  `tunnel_ws`. This is what un-authenticated clients read to learn how
  to reach the engine before they can present a token.
- **`GET /extension/tunnel/status` (HTTP, authenticated)** — the
  runtime introspection counterpart. Same data plus `active` (live
  state from the tunnel manager singleton), the engine's `local_url`,
  the `mode` (`quick` / `named`), `uptime_seconds`, and a `preferred`
  hint (`"local"` / `"tunnel"`) telling the extension which URL it
  *should* use right now. The hint flips to `"tunnel"` only when the
  tunnel is up *and* the engine was started with
  `MATRX_PREFER_TUNNEL=true` — otherwise the engine recommends the
  cheaper loopback path. Backed by the in-memory singleton in
  `app/api/tunnel_state.py`; updates flow from `run.py`'s discovery-file
  writers and `app/api/tunnel_routes.py`'s start/stop handlers.

## Auth model

- Bearer token in `Authorization: Bearer <token>` header on REST calls and
  in the `?token=<token>` query param on the WebSocket handshake (Chrome's
  WebSocket constructor cannot set headers; query param is the standard
  workaround).
- Token may be either a Supabase JWT issued by the same project the
  extension uses (`txzxabzwovsujtloxrus`) — JWTs are reusable across
  surfaces — or the local `API_KEY` (auto-generated on first engine boot,
  written into `~/.matrx/local.json`). The extension prefers the Supabase
  JWT so user identity flows end-to-end; the local API key is the offline
  fallback.
- **JWT validation on `/extension/*` (production-grade).** Every request
  to `/extension/*` (HTTP and WebSocket) goes through
  `app/api/extension_auth.py::validate_extension_principal`, which
  cryptographically verifies the Supabase JWT and rejects expired tokens.
  Two verification paths are tried in order:
    1. **JWKS / asymmetric (preferred).** Whenever `SUPABASE_URL` is set,
       the engine fetches `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`
       and verifies with the advertised algorithm (Supabase uses ES256
       today). Same pattern the remote scraper-service uses. Keys are
       cached for one hour by `jwt.PyJWKClient`.
    2. **HS256 / shared secret (fallback).** When `SUPABASE_JWT_SECRET`
       is set (Supabase dashboard → Settings → API → "JWT Secret"), the
       engine verifies the signature with that secret. Useful when the
       JWKS endpoint is unreachable (offline, locked-down network).
  Failures (missing token, invalid signature, expired token) return HTTP
  401 / WS close 1008. The validated principal (`user_id`, `email`,
  `is_anon`, `verified`) is stashed on `request.state.principal`.
- **Graceful degradation.** When neither `SUPABASE_URL` nor
  `SUPABASE_JWT_SECRET` is configured, the engine logs a loud one-time
  WARNING and falls back to the existing permissive Bearer-presence
  check. The loopback-only happy path keeps working unchanged for users
  who haven't configured the secret yet — the warning is the signal to
  upgrade once the engine is exposed beyond loopback. Set
  `SUPABASE_JWT_SECRET` in `.env` (or rely on the default `SUPABASE_URL`
  in `app/config.py`) to enable cryptographic validation.
- **Other engine routes are unchanged.** `/ws`, `/tools/*`, `/chat/*`,
  etc. continue to use the upstream `AuthMiddleware` (Bearer presence
  only). The user trusts their own desktop UI / CLI on those surfaces;
  the second layer is specific to `/extension/*` because that's the
  surface the Chrome extension drives.
- **Tunnel mode preserves the same auth posture.** Cloudflare relays
  requests to `127.0.0.1:<port>` over an outbound tunnel — every
  request still hits the FastAPI app, still walks the upstream
  `AuthMiddleware`, and `/extension/*` requests still go through
  `validate_extension_principal` for the JWT signature + expiry check.
  There is no auth bypass on the tunnel path; remote callers must
  present a valid Supabase JWT just like local callers do. The FastAPI
  app continues to bind `127.0.0.1` only, so no port is exposed to the
  public internet directly — the public URL is reachable only through
  the cloudflared subprocess that proxies inbound traffic to loopback.
- Port discovery: the engine writes the actual chosen port to
  `~/.matrx/local.json` after startup. The extension reads that file (via
  the desktop bridge it already maintains) instead of hardcoding a port.

## Adding a command inbound (extension → matrx-local)

Goal: a new verb the extension can call over `POST /extension/rpc`.

1. **Pick a name.** Lowercase, dotted if it has a domain — e.g.
   `fs.list_directory`, `clipboard.read`, `tool` (the generic dispatcher
   passthrough). Stable; renaming is a breaking change for the extension.
2. **Write the handler.** In `app/api/extension_handlers.py` (will be
   created in Phase 1) add an entry to the `HANDLERS` dict. Signature:
   ```python
   async def fs_list_directory(payload: dict, request: Request) -> dict:
       path = payload.get("path")
       # Validate, run, return a JSON-serialisable dict.
       return {"entries": [...]}
   HANDLERS["fs.list_directory"] = fs_list_directory
   ```
3. **For tool invocations, use the generic `tool` command.** Don't add one
   handler per tool. The single handler below makes every dispatcher tool
   reachable to the extension without further wiring:
   ```python
   from app.tools.dispatcher import dispatch
   async def tool_handler(payload: dict, request: Request) -> dict:
       result = await dispatch(
           tool_name=payload["tool_name"],
           tool_input=payload.get("tool_input", {}),
           session=request.state.session,
       )
       return result.model_dump()
   HANDLERS["tool"] = tool_handler
   ```
4. **Update the dispatch line in `extension_routes.py`** to look up the
   command in `HANDLERS` and fall through to the existing
   `Unknown command` error if missing. The `health` branch stays inline
   for backward compatibility.
5. **Auth and validation** — handlers receive the already-authenticated
   `Request`. Re-validate any path / shell-command / tool-name input
   against the allowlist for that surface. Never trust `payload`.
6. **Errors** — raise structured errors the wrapper turns into
   `DesktopRpcResponse(ok=False, error=str(e))`. Don't return half-states.
7. **Test with curl** (replace token / port from `~/.matrx/local.json`):
   ```bash
   curl -s -X POST http://127.0.0.1:22140/extension/rpc \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"command":"fs.list_directory","args":{"path":"/Users/me"}}'
   ```

## Calling the extension outbound (matrx-local → extension)

Goal: engine-side code drives a browser tool (open a tab, read a page,
take a screenshot) on the user's currently-connected extension.

1. **Confirm the extension is connected.** `app/websocket_manager.py`
   tracks live `/extension/ws` sessions per user. If none exist, fall back
   to `broadcast_notification` over `/ws` so the user sees a "no extension
   attached" toast and you fail the call cleanly.
2. **Build the envelope.** Phase 2 will add
   `app/api/extension_invoke.py::invoke_extension_tool`:
   ```python
   from app.api.extension_invoke import invoke_extension_tool
   result = await invoke_extension_tool(
       tool_name="take_screenshot",
       args={"tab_id": 47},
       timeout=30,
   )
   ```
3. **Internals.** The function generates a `callId`, sends
   `{"type":"extension.invoke","callId":...,"toolName":...,"args":...}`,
   parks an `asyncio.Future` keyed by `callId`, and resolves on the matching
   `extension.result` reply. 30 s default timeout; configurable per call.
4. **Errors.** Three failure modes the caller must handle: no extension
   attached, timeout, extension-side error (`ok: false, error: ...`).
   Treat all three as soft failures — never crash the engine because the
   browser disconnected.
5. **Idempotency.** The reverse channel does not retry on its own. If you
   need at-least-once semantics, the caller is responsible for retry +
   deduplication.

## Pointer to the master cross-repo doc

`/Users/armanisadeghi/code/matrx-extend/.claude/worktrees/exciting-moser-4b984f/docs/CROSS_REPO_INTEGRATION.md`

That file is the source of truth for which repo owns which side of the
contract; this file is the local view from inside `matrx-local`.

## Pointer to the local skill

`./.cursor/skills/connect-matrx-extend/SKILL.md` — the agent skill that
loads when work touches this connection.
