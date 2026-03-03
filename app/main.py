import asyncio
import re
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, WebSocket, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.api.tool_routes import router as tool_router
from app.api.remote_scraper_routes import router as remote_scraper_router
from app.api.settings_routes import router as settings_router
from app.api.document_routes import router as document_router  # notes — local-first
from app.api.proxy_routes import router as proxy_router
from app.api.cloud_sync_routes import router as cloud_sync_router
from app.api.chat_routes import router as chat_router, build_ai_sub_app
from app.api.permissions_routes import router as permissions_router
from app.api.capabilities_routes import router as capabilities_router
from app.api.auth import AuthMiddleware, auth_router
from app.config import ALLOWED_ORIGINS, ALLOWED_ORIGIN_REGEX
from app.common.system_logger import get_logger
import app.common.access_log as access_log
from app.services.scraper.engine import get_scraper_engine
from app.services.proxy.server import get_proxy_server
from app.services.cloud_sync.settings_sync import get_settings_sync
from app.services.ai.engine import initialize_matrx_ai, load_tools_and_register
from app.tools.tools.scheduler import restore_scheduled_tasks
import app.services.scraper.retry_queue as retry_queue
from app.websocket_manager import WebSocketManager

logger = get_logger()
websocket_manager = WebSocketManager()

# JWT truncation for verbose request logging (show first/last parts only)
_JWT_HEAD = 20
_JWT_TAIL = 12


def _truncate_jwt(val: str) -> str:
    """Truncate JWT-like strings for logging: first N + ... + last M chars."""
    if len(val) < 60:
        return val
    parts = val.split(".")
    if len(parts) != 3:
        # Check if it's a long string that looks like a token even if not 3 parts
        if len(val) > 100:
            return f"{val[:_JWT_HEAD]}...{val[-_JWT_TAIL:]}"
        return val
    if not all(re.match(r"^[A-Za-z0-9_-]+$", p) for p in parts):
        return val
    return f"{val[:_JWT_HEAD]}...{val[-_JWT_TAIL:]}"


def _sanitize_url(url: str | object) -> str:
    """Hide sensitive query params like 'token' in URLs for logging."""
    url_str = str(url)
    # Simple regex to find token=... and truncate it
    return re.sub(
        r"([?&]token=)([^&]+)",
        lambda m: m.group(1) + _truncate_jwt(m.group(2)),
        url_str,
    )


def _sanitize_body_for_log(obj):
    """Recursively sanitize body for logging: truncate JWTs only."""
    if isinstance(obj, dict):
        return {k: _sanitize_body_for_log(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_body_for_log(v) for v in obj]
    if isinstance(obj, str):
        return _truncate_jwt(obj)
    return obj


def _format_request_details(request: Request, body=None) -> str:
    """Format request headers and other metadata for detailed error logging."""
    headers = dict(request.headers)
    # Sanitize Authorization header
    if "authorization" in headers:
        auth = headers["authorization"]
        if auth.lower().startswith("bearer "):
            headers["authorization"] = f"Bearer {_truncate_jwt(auth[7:])}"
        else:
            headers["authorization"] = _truncate_jwt(auth)

    # Filter out other sensitive headers if any (already handled standard ones)
    return f"Method: {request.method} | URL: {_sanitize_url(request.url)} | Headers: {headers} | Body: {body}"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    import time as _startup_time

    _t0 = _startup_time.monotonic()
    logger.info(
        "[app/main.py] ── Matrx Local startup ─────────────────────────────────────"
    )

    # Phase 1: Initialize matrx-ai (loads env, registers DB if credentials present)
    logger.info("[app/main.py] Phase 1: Initializing matrx-ai engine...")
    try:
        initialize_matrx_ai()
        logger.info("[app/main.py] Phase 1: matrx-ai initialized ✓")
    except Exception:
        logger.error(
            "[app/main.py] Phase 1: matrx-ai initialization FAILED — AI endpoints will not work. "
            "Check SUPABASE_MATRIX_* vars in .env",
            exc_info=True,
        )

    # Phase 2: Load tool registry from DB and register all local OS tools.
    logger.info("[app/main.py] Phase 2: Loading tool registry...")
    try:
        await load_tools_and_register()
        logger.info("[app/main.py] Phase 2: Tool registry loaded ✓")
    except Exception:
        logger.error(
            "[app/main.py] Phase 2: Tool registration FAILED — AI may not have tool access",
            exc_info=True,
        )

    # Phase 3: Start scraper engine
    logger.info("[app/main.py] Phase 3: Starting scraper engine...")
    engine = get_scraper_engine()
    try:
        await engine.start()
        logger.info("[app/main.py] Phase 3: Scraper engine started ✓")
    except Exception:
        logger.error(
            "[app/main.py] Phase 3: Scraper engine FAILED to start — scraping tools will be unavailable",
            exc_info=True,
        )

    restored = await restore_scheduled_tasks()
    if restored:
        logger.info(
            "[app/main.py] Scheduler: %d task(s) restored from previous session",
            restored,
        )

    # Phase 4: Start HTTP proxy if enabled in settings
    settings_sync = get_settings_sync()
    proxy_enabled = settings_sync.get("proxy_enabled", True)
    logger.info("[app/main.py] Phase 4: HTTP proxy enabled=%s", proxy_enabled)
    if proxy_enabled:
        try:
            proxy = get_proxy_server()
            proxy_port = settings_sync.get("proxy_port", 22180)
            logger.info(
                "[app/main.py] Phase 4: Starting proxy on 127.0.0.1:%d...", proxy_port
            )
            await proxy.start(port=proxy_port)
            logger.info(
                "[app/main.py] Phase 4: HTTP proxy started ✓ on port %d", proxy_port
            )
        except OSError as exc:
            logger.error(
                "[app/main.py] Phase 4: HTTP proxy FAILED to start — port %d is already in use. "
                "Another process is holding this port. Kill it with: lsof -ti:%d | xargs kill -9  "
                "Error: %s",
                settings_sync.get("proxy_port", 22180),
                settings_sync.get("proxy_port", 22180),
                exc,
            )
        except Exception:
            logger.error(
                "[app/main.py] Phase 4: HTTP proxy FAILED to start", exc_info=True
            )

    # Background heartbeat: updates last_seen and retries failed syncs
    async def _heartbeat_loop() -> None:
        while True:
            await asyncio.sleep(300)  # 5 minutes
            sync = get_settings_sync()
            if not sync.is_configured:
                continue
            try:
                await sync.heartbeat()
            except Exception:
                logger.debug("Heartbeat failed", exc_info=True)

    heartbeat_task = asyncio.create_task(_heartbeat_loop())

    # Start retry queue poller (polls remote server for failed scrapes to retry locally)
    retry_queue.start()

    elapsed = _startup_time.monotonic() - _t0
    logger.info(
        "[app/main.py] ── Startup complete in %.1fs — scraper=%s, proxy=%s ──────────────",
        elapsed,
        engine.is_ready,
        get_proxy_server().running,
    )

    yield

    logger.info(
        "[app/main.py] ── Matrx Local shutdown ────────────────────────────────────"
    )
    retry_queue.stop()
    heartbeat_task.cancel()
    try:
        await heartbeat_task
    except asyncio.CancelledError:
        pass

    try:
        proxy = get_proxy_server()
        await proxy.stop()
        logger.info("[app/main.py] HTTP proxy stopped ✓")
    except Exception:
        logger.error("[app/main.py] HTTP proxy failed to stop cleanly", exc_info=True)

    try:
        await engine.stop()
        logger.info("[app/main.py] Scraper engine stopped ✓")
    except Exception:
        logger.error(
            "[app/main.py] Scraper engine failed to stop cleanly", exc_info=True
        )


app = FastAPI(
    title="Matrx Local",
    description="Local companion service for AI Matrx — browser-to-filesystem bridge",
    version="0.2.0",
    lifespan=lifespan,
)

app.include_router(auth_router)  # OAuth callback — must be before AuthMiddleware
app.include_router(api_router)
app.include_router(tool_router, prefix="/tools", tags=["tools"])
app.include_router(remote_scraper_router)
app.include_router(settings_router)
app.include_router(document_router, prefix="/notes")
app.include_router(proxy_router)
app.include_router(cloud_sync_router)
app.include_router(chat_router)
app.include_router(permissions_router)
app.include_router(capabilities_router)

# Mount the matrx-ai engine as a sub-application.
# It has its own AuthMiddleware (sets AppContext + StreamEmitter per request).
# Effective AI endpoint paths:
#   POST /chat/ai/api/ai/chat
#   POST /chat/ai/api/ai/agents/{agent_id}
#   POST /chat/ai/api/ai/conversations/{conversation_id}
#   POST /chat/ai/api/ai/cancel/{request_id}
app.mount("/chat/ai", build_ai_sub_app())

app.add_middleware(AuthMiddleware)

# CORS middleware must be registered AFTER AuthMiddleware so that Starlette
# places it as the outer wrapper (add_middleware is processed in reverse order).
# It handles OPTIONS preflights before AuthMiddleware ever sees them.
#
# allow_origins:       exact origins (localhost, production domains)
# allow_origin_regex:  wildcard subdomains (*.aimatrx.com, Vercel previews, etc.)
# allow_headers:       explicit list — "*" is invalid when allow_credentials=True
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-User-Id", "X-API-Key", "Accept"],
    max_age=600,
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    import json as _json
    import time as _time

    t0 = _time.monotonic()
    path = request.url.path
    query = str(request.url.query) if request.url.query else ""
    display_path = f"{path}?{query}" if query else path

    # Health checks are noisy — log at DEBUG so they don't flood INFO output.
    is_health = path in ("/health", "/tools/list")
    log = logger.debug if is_health else logger.info

    # Read body for mutating methods (doesn't consume the ASGI stream).
    body = None
    try:
        if request.method in ("POST", "PUT", "PATCH"):
            body = await request.json()
            if body is not None:
                body = _sanitize_body_for_log(body)
    except Exception:
        pass

    # ── Request line ──────────────────────────────────────────────────────────
    if body is not None:
        body_str = _json.dumps(body, indent=2, ensure_ascii=False)
        log("→ %s %s\n%s", request.method, display_path, body_str)
    else:
        log("→ %s %s", request.method, display_path)

    response = await call_next(request)
    duration_ms = (_time.monotonic() - t0) * 1000

    # ── Response line ─────────────────────────────────────────────────────────
    if response.status_code >= 500:
        logger.error(
            "← %d %s %s  (%.0fms)",
            response.status_code,
            request.method,
            display_path,
            duration_ms,
        )
        logger.error("  %s", _format_request_details(request, body))
    elif response.status_code >= 400:
        logger.warning(
            "← %d %s %s  (%.0fms)",
            response.status_code,
            request.method,
            display_path,
            duration_ms,
        )
        logger.warning("  %s", _format_request_details(request, body))
    else:
        log("← %d %s  (%.0fms)", response.status_code, request.method, duration_ms)

    # Write structured access-log entry (unchanged — consumed by UI).
    access_log.record(
        method=request.method,
        path=path,
        query=_sanitize_url(query),
        origin=request.headers.get("origin", ""),
        user_agent=request.headers.get("user-agent", ""),
        status=response.status_code,
        duration_ms=duration_ms,
    )

    return response


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # Auth check — BaseHTTPMiddleware does NOT intercept WebSocket upgrades.
    # We validate the token here manually.
    url = _sanitize_url(websocket.url)
    logger.info(f"WebSocket connecting: {url}")

    token = websocket.query_params.get("token")
    if not token:
        logger.warning(
            f"WebSocket rejected - missing token: {url} | Headers: {dict(websocket.headers)}"
        )
        await websocket.close(code=1008, reason="Missing auth token")
        return

    # Store token for downstream forwarding.
    websocket.state.user_token = token

    conn = await websocket_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await websocket_manager.handle_tool_message(conn, data)
    except Exception as e:
        logger.error(
            f"WebSocket error: {e} | {url} | Headers: {dict(websocket.headers)}"
        )
    finally:
        await websocket_manager.disconnect(websocket)
