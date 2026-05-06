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

## Substrates

- **HTTP REST** — `POST /extension/rpc` on the FastAPI sidecar
  (`127.0.0.1:22140` by default; auto-scans `22140-22159`). Single
  request/response, JSON in / JSON out. Used for every extension-initiated
  command.
- **WebSocket (engine → client push)** — `/ws` is the existing broadcast
  channel for download progress, model lifecycle, transcription events, etc.
  Production-ready and unused by the extension today.
- **WebSocket (extension reverse channel, planned)** — `/extension/ws` is
  the dedicated bidirectional channel where the engine asks the extension
  to run a browser tool. Envelope:
  - request: `{ "type": "extension.invoke", "callId": "<uuid>", "toolName": "...", "args": { ... } }`
  - reply: `{ "type": "extension.result", "callId": "<uuid>", "ok": true, "result": { ... } }`
    or `{ "type": "extension.result", "callId": "<uuid>", "ok": false, "error": "..." }`
  Default timeout 30 seconds; `invoke_extension_tool` rejects with a
  `TimeoutError` after that and the engine resumes whatever path called it.
- **Future fallback — Supabase Broadcast** — when extension and engine
  cannot reach the same loopback (different machine, locked-down corp net),
  both sides subscribe to channel `matrx-local-bridge:<userId>` over
  Supabase Realtime. Not implemented yet; design slot reserved.

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
- The FastAPI app binds to `127.0.0.1` only. Phase 1 stays loopback-only;
  the cross-machine path (Supabase Broadcast) is a separate future PR.
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
