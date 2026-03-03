"""Auth middleware and OAuth callback route for the local engine.

Since the engine runs on localhost, we don't validate JWTs here — that happens
on the remote scraper server. We just ensure callers provide a Bearer token
(the Supabase JWT or the local API key) to prevent unauthorized access from
other processes on the machine.

Public routes (health, discovery, and the OAuth callback) are excluded from
the auth check. The OAuth callback MUST be public because the external browser
delivers it with no auth token — it's the result of an OAuth flow, not an
authenticated API call.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.common.system_logger import get_logger

logger = get_logger()

# Routes that don't require auth (health checks, discovery, read-only metadata).
_PUBLIC_PATHS = frozenset(
    {
        "/",
        "/tools/list",
        "/remote-scraper/status",
        "/proxy/status",
        "/chat/tools",
        "/chat/tools/by-category",
        "/chat/tools/anthropic",
        "/chat/models",  # read-only model list, no user data
        "/remote-scraper/queue/poller-stats",
        "/docs",
        "/openapi.json",
        "/redoc",
        # Discovery & health — the web app needs these before it can send auth.
        "/health",
        "/version",
        "/ports",
        "/cloud/heartbeat",
        # OAuth callback — the external browser delivers this with no token.
        # Auth is completed inside the Tauri webview after the code is forwarded.
        "/auth/callback",
    }
)


# ---------------------------------------------------------------------------
# OAuth callback router
# ---------------------------------------------------------------------------

auth_router = APIRouter(tags=["auth"])

_SUCCESS_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI Matrx — Signed In</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      min-height:100vh;display:flex;align-items:center;justify-content:center;
      background:#09090b;color:#fafafa;
    }
    .card{
      text-align:center;max-width:340px;padding:2.5rem 2rem;
      background:#18181b;border:1px solid #27272a;border-radius:1.25rem;
      box-shadow:0 25px 50px -12px rgba(0,0,0,.6);
    }
    .icon{
      width:56px;height:56px;margin:0 auto 1.25rem;
      border-radius:.875rem;background:rgba(132,204,22,.12);
      display:flex;align-items:center;justify-content:center;
    }
    h1{font-size:1.25rem;font-weight:600;margin-bottom:.5rem;}
    p{font-size:.875rem;color:#a1a1aa;line-height:1.5;margin-bottom:1.5rem;}
    .close-hint{
      font-size:.75rem;color:#52525b;
      border-top:1px solid #27272a;padding-top:1rem;margin-top:1rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#84cc16"
           stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </div>
    <h1>Signed in successfully!</h1>
    <p>You're being returned to AI&nbsp;Matrx now.<br>This tab will close automatically.</p>
    <div class="close-hint">You can also close this tab manually.</div>
  </div>
  <script>
    // Attempt to close the tab automatically after a short delay.
    // This works in most browsers when the tab was opened programmatically.
    setTimeout(() => { try { window.close(); } catch(_) {} }, 2000);
  </script>
</body>
</html>
"""


@auth_router.get("/auth/callback", response_class=HTMLResponse)
async def oauth_callback(request: Request):
    """
    OAuth redirect target for the Tauri desktop app.

    Supabase completes authentication in the user's external browser and then
    redirects to this local URL.  We capture whichever parameters Supabase
    included (PKCE ``code``, or implicit ``access_token`` / ``refresh_token``
    in the URL fragment — though fragments are never sent to the server, so
    for implicit flow the frontend must parse them itself from the redirected
    page URL).

    Once the parameters are captured we broadcast them to every connected
    WebSocket client so the Tauri webview can complete the session exchange
    without any page navigation.
    """
    # Import here to avoid a circular import with main.py
    from app.main import websocket_manager  # type: ignore[attr-defined]

    params = dict(request.query_params)
    logger.info("[oauth_callback] received params: %s", list(params.keys()))

    # Broadcast whichever parameters arrived so the webview can handle them.
    # The frontend checks for `code` (PKCE) first, then falls back to
    # `access_token` + `refresh_token` (implicit).
    payload: dict = {"type": "oauth-callback"}

    if "code" in params:
        payload["code"] = params["code"]
        logger.info("[oauth_callback] PKCE code received, broadcasting to webview")
    elif "access_token" in params:
        payload["access_token"] = params["access_token"]
        payload["refresh_token"] = params.get("refresh_token", "")
        logger.info(
            "[oauth_callback] implicit tokens received, broadcasting to webview"
        )
    else:
        logger.warning(
            "[oauth_callback] unexpected params — forwarding raw: %s",
            list(params.keys()),
        )
        payload["raw"] = params

    # Broadcast to all connected WebSocket clients (the Tauri webview is one).
    for conn in websocket_manager.connections.values():
        await websocket_manager._send(conn, payload)

    return HTMLResponse(_SUCCESS_HTML)


# ---------------------------------------------------------------------------
# Auth middleware (unchanged)
# ---------------------------------------------------------------------------


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path.rstrip("/") or "/"

        # Skip auth for public routes, device status, fetch-proxy (iframe nav), and OPTIONS.
        if (
            path in _PUBLIC_PATHS
            or path.startswith("/devices/")
            or path.startswith("/fetch-proxy")
            or request.method == "OPTIONS"
        ):
            return await call_next(request)

        # Extract Bearer token — prefer Authorization header, fall back to
        # ?token query param (required for EventSource / SSE connections that
        # cannot set custom request headers).
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:]
        else:
            token = request.query_params.get("token") or None

        if not token:
            return JSONResponse(
                status_code=401,
                content={"detail": "Authorization header required"},
            )

        # Store token on request state for downstream forwarding.
        request.state.user_token = token

        return await call_next(request)
