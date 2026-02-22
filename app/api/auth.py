"""Auth middleware for the local engine.

Since the engine runs on localhost, we don't validate JWTs here — that happens
on the remote scraper server. We just ensure callers provide a Bearer token
(the Supabase JWT or the local API key) to prevent unauthorized access from
other processes on the machine.

Public routes (health, discovery) are excluded from the check.
"""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

# Routes that don't require auth (health checks, discovery, read-only metadata).
_PUBLIC_PATHS = frozenset({
    "/", "/tools/list", "/remote-scraper/status",
    "/proxy/status",
    "/chat/tools", "/chat/tools/by-category", "/chat/tools/anthropic",
    "/remote-scraper/queue/poller-stats",
    "/docs", "/openapi.json", "/redoc",
})


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path.rstrip("/") or "/"

        # Skip auth for public routes and OPTIONS (CORS preflight).
        if path in _PUBLIC_PATHS or request.method == "OPTIONS":
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
