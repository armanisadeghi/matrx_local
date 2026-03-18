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
from app.api.data_routes import router as data_router
from app.api.permissions_routes import router as permissions_router
from app.api.capabilities_routes import router as capabilities_router
from app.api.auth import AuthMiddleware, auth_router
from app.api.token_routes import router as token_router
from app.api.fetch_proxy_routes import router as fetch_proxy_router
from app.api.tunnel_routes import router as tunnel_router
from app.api.setup_routes import router as setup_router
from app.api.platform_routes import router as platform_router
from app.config import ALLOWED_ORIGINS, ALLOWED_ORIGIN_REGEX, MATRX_HOME_DIR, TUNNEL_ENABLED
from app.common.system_logger import get_logger
import app.common.access_log as access_log
from app.common.platform_ctx import refresh_capabilities
from app.services.scraper.engine import get_scraper_engine
from app.services.proxy.server import get_proxy_server
from app.services.tunnel.manager import get_tunnel_manager
from app.services.cloud_sync.settings_sync import get_settings_sync
from app.services.ai.engine import initialize_matrx_ai, load_tools_and_register, warm_jwt_cache
from app.services.local_db.database import get_db
from app.services.local_db.sync_engine import get_sync_engine
from app.tools.tools.scheduler import restore_scheduled_tasks
import app.services.scraper.retry_queue as retry_queue
from app.websocket_manager import WebSocketManager

logger = get_logger()
websocket_manager = WebSocketManager()


async def _ensure_playwright_browsers() -> None:
    """Install Playwright browsers if they are not already present.

    Browsers are NOT bundled inside the PyInstaller sidecar binary to avoid
    macOS codesign failures with Chrome's nested framework structure.
    This function auto-installs them to PLAYWRIGHT_BROWSERS_PATH on first
    startup (runs in the background so it does not block the server).
    """
    import os

    # The default path here must match the one set by hooks/runtime_hook.py
    # for the frozen binary. In development the env var is usually unset, so
    # we default to ~/.matrx/playwright-browsers and write it into os.environ
    # so every subsequent Playwright call (including ScraperEngine.start())
    # uses the same path — Playwright reads PLAYWRIGHT_BROWSERS_PATH at
    # import time, so the env var must be set before any playwright import.
    browsers_path = os.environ.get(
        "PLAYWRIGHT_BROWSERS_PATH",
        str(MATRX_HOME_DIR / "playwright-browsers"),
    )
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = browsers_path

    # Quick check: skip install if at least one versioned browser directory exists.
    browser_markers = ("chromium-", "firefox-", "webkit-", "chromium_headless_shell-")
    if os.path.isdir(browsers_path) and any(
        e.startswith(m)
        for m in browser_markers
        for e in os.listdir(browsers_path)
    ):
        logger.debug(
            "[app/main.py] Playwright browsers already present at %s", browsers_path
        )
        return

    logger.info(
        "[app/main.py] Playwright browsers not found — installing to %s (this may take a minute)...",
        browsers_path,
    )
    os.makedirs(browsers_path, exist_ok=True)

    # Build the install command.  compute_driver_executable() returns a
    # (node_binary, cli.js) tuple — str()-ing it produces a broken path string.
    # Fall back to `sys.executable -m playwright install` for frozen binaries
    # where the driver directory is not bundled.
    import sys

    try:
        from playwright._impl._driver import compute_driver_executable  # type: ignore[import]
        node_exe, cli_js = compute_driver_executable()
        # Verify the node binary actually exists; if not, use the Python fallback
        if not os.path.isfile(node_exe):
            raise FileNotFoundError(f"Playwright node binary not found: {node_exe}")
        cmd = [node_exe, cli_js, "install", "chromium", "firefox", "webkit"]
    except Exception as exc:
        logger.info(
            "[app/main.py] Playwright driver binary not available (%s) — "
            "falling back to `python -m playwright install`",
            exc,
        )
        cmd = [sys.executable, "-m", "playwright", "install", "chromium", "firefox", "webkit"]

    env = {**os.environ, "PLAYWRIGHT_BROWSERS_PATH": browsers_path}

    async def _install() -> None:
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                env=env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            stdout, _ = await proc.communicate()
            if proc.returncode == 0:
                logger.info("[app/main.py] Playwright browsers installed successfully")
            else:
                logger.warning(
                    "[app/main.py] Playwright browser install exited %d: %s",
                    proc.returncode,
                    (stdout or b"").decode("utf-8", errors="replace")[:500],
                )
        except Exception:
            logger.warning(
                "[app/main.py] Playwright browser install task failed", exc_info=True
            )

    # Run in background so the server starts immediately; keep a reference to
    # prevent the task from being garbage-collected before it finishes.
    _browser_install_task = asyncio.create_task(_install())
    _browser_install_task.add_done_callback(lambda _: None)  # suppress GC warning


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

    # Phase 0a: Open local SQLite database (offline-first data store).
    # This MUST be the first phase — all data reads come from SQLite.
    # The database lives at ~/.matrx/matrx.db (outside the app folder) so it
    # survives reinstalls and updates.
    print("[phase:database] Opening local database...", flush=True)
    logger.info("[app/main.py] Phase 0a: Opening local database...")
    try:
        local_db = get_db()
        await local_db.connect()
        logger.info("[app/main.py] Phase 0a: Local database ready ✓ (%s)", local_db.path)
        print("[phase:database] Local database ready", flush=True)
    except Exception:
        logger.error(
            "[app/main.py] Phase 0a: Local database FAILED — data endpoints will use fallbacks",
            exc_info=True,
        )
        print("[phase:database] Local database FAILED (fallbacks active)", flush=True)

    # Phase 0a (post): Warm the in-memory JWT cache from SQLite so matrx-ai has
    # the user's token available immediately on first authenticated API call.
    try:
        await warm_jwt_cache()
    except Exception:
        logger.warning("[app/main.py] Phase 0a: JWT cache warm failed (non-fatal)", exc_info=True)

    # Phase 0b: Ensure Playwright browsers are installed (auto-installs if missing).
    # Browsers are NOT bundled in the PyInstaller binary (bundling causes macOS
    # codesign failures with Chrome's nested framework structure). They are
    # downloaded on first startup to PLAYWRIGHT_BROWSERS_PATH (~/.matrx/playwright-browsers
    # when running as a frozen binary, or the default Playwright cache in development).
    print("[phase:browsers] Checking browser engine...", flush=True)
    logger.info("[app/main.py] Phase 0b: Checking Playwright browsers...")
    try:
        await _ensure_playwright_browsers()
        logger.info("[app/main.py] Phase 0b: Playwright browsers ready ✓")
        print("[phase:browsers] Browser engine ready", flush=True)
    except Exception:
        logger.warning(
            "[app/main.py] Phase 0b: Playwright browser check failed — browser automation may not work",
            exc_info=True,
        )
        print("[phase:browsers] Browser engine check failed (scraping limited)", flush=True)

    # Phase 0c: Probe hardware/permission capabilities once at startup.
    # Populates CAPABILITIES in platform_ctx (mic, GPU, screen capture, etc.)
    # so /platform/context returns fully-populated data from the first request.
    logger.info("[app/main.py] Phase 0c: Probing platform capabilities...")
    try:
        await refresh_capabilities()
        logger.info("[app/main.py] Phase 0c: Platform capabilities probed ✓")
    except Exception:
        logger.warning(
            "[app/main.py] Phase 0c: Capability probe failed — some flags will be null",
            exc_info=True,
        )

    # Phase 1: Initialize matrx-ai (loads env, registers DB if credentials present)
    # This MUST run before build_ai_sub_app() is called — the matrx_ai imports
    # inside that function try to access the DB config registered here.
    print("[phase:ai] Initializing AI engine...", flush=True)
    logger.info("[app/main.py] Phase 1: Initializing matrx-ai engine...")
    try:
        initialize_matrx_ai()
        logger.info("[app/main.py] Phase 1: matrx-ai initialized ✓")
        print("[phase:ai] AI engine initialized", flush=True)
    except Exception:
        logger.error(
            "[app/main.py] Phase 1: matrx-ai initialization FAILED — AI endpoints will not work. "
            "Check SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env",
            exc_info=True,
        )
        print("[phase:ai] AI engine init FAILED", flush=True)

    # Phase 1b: Mount the matrx-ai sub-app now that the DB config is registered.
    # This must happen after initialize_matrx_ai() because the matrx_ai module-level
    # imports (agent router → resolver → cache → definition → executor → persistence →
    # ai_model_manager_instance) trigger an auto-fetch that requires 'supabase_automation_matrix'
    # to already be registered in the ORM config registry.
    logger.info("[app/main.py] Phase 1b: Mounting matrx-ai sub-app...")
    try:
        app.mount("/chat/ai", build_ai_sub_app())
        logger.info("[app/main.py] Phase 1b: matrx-ai sub-app mounted at /chat/ai ✓")
    except Exception:
        logger.error(
            "[app/main.py] Phase 1b: matrx-ai sub-app mount FAILED — AI chat/agent endpoints will be unavailable",
            exc_info=True,
        )

    # Phase 2: Load tool registry from DB and register all local OS tools.
    print("[phase:tools] Loading tool registry...", flush=True)
    logger.info("[app/main.py] Phase 2: Loading tool registry...")
    try:
        await load_tools_and_register()
        logger.info("[app/main.py] Phase 2: Tool registry loaded ✓")
        print("[phase:tools] Tool registry loaded", flush=True)
    except Exception:
        logger.error(
            "[app/main.py] Phase 2: Tool registration FAILED — AI may not have tool access",
            exc_info=True,
        )
        print("[phase:tools] Tool registry FAILED", flush=True)

    # Phase 2b: Start background sync engine (cloud → local SQLite).
    # This pulls models, agents, and tools from Supabase into the local DB
    # so all /data/* endpoints respond instantly from SQLite.
    logger.info("[app/main.py] Phase 2b: Starting background data sync...")
    try:
        sync_engine = get_sync_engine()
        sync_engine.start()
        logger.info("[app/main.py] Phase 2b: Background sync started ✓")
    except Exception:
        logger.error(
            "[app/main.py] Phase 2b: Background sync FAILED to start — local data may be stale",
            exc_info=True,
        )

    # Phase 3: Start scraper engine
    print("[phase:scraper] Starting scraper engine...", flush=True)
    logger.info("[app/main.py] Phase 3: Starting scraper engine...")
    engine = get_scraper_engine()
    try:
        await engine.start()
        logger.info("[app/main.py] Phase 3: Scraper engine started ✓")
        print("[phase:scraper] Scraper engine ready", flush=True)
    except Exception:
        logger.error(
            "[app/main.py] Phase 3: Scraper engine FAILED to start — scraping tools will be unavailable",
            exc_info=True,
        )
        print("[phase:scraper] Scraper engine FAILED (scraping unavailable)", flush=True)

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
        print("[phase:proxy] Starting local HTTP proxy...", flush=True)
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
            print(f"[phase:proxy] HTTP proxy ready on port {proxy_port}", flush=True)
        except OSError as exc:
            logger.error(
                "[app/main.py] Phase 4: HTTP proxy FAILED to start — port %d is already in use. "
                "Another process is holding this port. Kill it with: lsof -ti:%d | xargs kill -9  "
                "Error: %s",
                settings_sync.get("proxy_port", 22180),
                settings_sync.get("proxy_port", 22180),
                exc,
            )
            print("[phase:proxy] HTTP proxy FAILED (port in use)", flush=True)
        except Exception:
            logger.error(
                "[app/main.py] Phase 4: HTTP proxy FAILED to start", exc_info=True
            )
            print("[phase:proxy] HTTP proxy FAILED", flush=True)

    # Phase 5: Start Cloudflare tunnel (quick tunnel for all users — no account needed).
    # Each instance gets a unique random URL from Cloudflare's trycloudflare.com pool.
    # The URL is pushed to Supabase so mobile/web can discover it via app_instances lookup.
    # Users with a CLOUDFLARE_TUNNEL_TOKEN get a stable named tunnel URL instead.
    tunnel_enabled = settings_sync.get("tunnel_enabled", TUNNEL_ENABLED)
    logger.info("[app/main.py] Phase 5: Tunnel enabled=%s", tunnel_enabled)
    if tunnel_enabled:
        print("[phase:tunnel] Starting Cloudflare tunnel...", flush=True)
        try:
            from app.services.tunnel.manager import get_tunnel_manager as _get_tm
            _tm = _get_tm()
            _tunnel_url = await _tm.start(port=22140)
            if _tunnel_url:
                logger.info("[app/main.py] Phase 5: Tunnel active ✓ → %s", _tunnel_url)
                print(f"[phase:tunnel] Tunnel active: {_tunnel_url}", flush=True)
                try:
                    from app.services.cloud_sync.instance_manager import get_instance_manager as _get_im
                    await _get_im().update_tunnel_url(_tunnel_url, active=True)
                except Exception:
                    pass
            else:
                logger.warning("[app/main.py] Phase 5: Tunnel started but no URL captured within timeout")
                print("[phase:tunnel] Tunnel started but no URL captured", flush=True)
        except Exception:
            logger.error("[app/main.py] Phase 5: Tunnel FAILED to start", exc_info=True)
            print("[phase:tunnel] Tunnel FAILED to start", flush=True)

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
    print(f"[phase:ready] Engine ready in {elapsed:.1f}s", flush=True)

    yield

    logger.info(
        "[app/main.py] ── Matrx Local shutdown ────────────────────────────────────"
    )
    # Stop background sync
    try:
        get_sync_engine().stop()
    except Exception:
        pass

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
        tm = get_tunnel_manager()
        if tm.running:
            await tm.stop()
            logger.info("[app/main.py] Tunnel stopped ✓")
            # Clear tunnel_active in Supabase so remote devices don't try a dead URL
            try:
                from app.services.cloud_sync.instance_manager import get_instance_manager as _get_im
                await _get_im().update_tunnel_url(None, active=False)
            except Exception:
                pass
    except Exception:
        logger.error("[app/main.py] Tunnel failed to stop cleanly", exc_info=True)

    try:
        await engine.stop()
        logger.info("[app/main.py] Scraper engine stopped ✓")
    except Exception:
        logger.error(
            "[app/main.py] Scraper engine failed to stop cleanly", exc_info=True
        )

    # Close any open Playwright browser instances from browser_automation tools.
    # Without this, the chromium child processes stay alive after SIGTERM and
    # hold open port bindings / file handles — especially problematic on Windows.
    try:
        from app.tools.tools.browser_automation import (
            _browser_instances,
            _browser_contexts,
            _playwright_instance,
        )
        import asyncio as _asyncio

        for bt, browser in list(_browser_instances.items()):
            try:
                await _asyncio.wait_for(browser.close(), timeout=3.0)
            except Exception:
                pass
        _browser_instances.clear()
        _browser_contexts.clear()

        if _playwright_instance is not None:
            try:
                await _asyncio.wait_for(_playwright_instance.stop(), timeout=3.0)
            except Exception:
                pass

        logger.info("[app/main.py] Browser automation contexts closed ✓")
    except Exception:
        logger.debug("[app/main.py] Browser automation cleanup skipped (no active contexts)")

    # Close local SQLite database
    try:
        await get_db().close()
    except Exception:
        pass


app = FastAPI(
    title="Matrx Local",
    description="Local companion service for AI Matrx — browser-to-filesystem bridge",
    version="0.2.0",
    lifespan=lifespan,
)

app.include_router(auth_router)  # OAuth callback — must be before AuthMiddleware
app.include_router(token_router)  # Token sync — React pushes JWT to Python
app.include_router(api_router)
app.include_router(tool_router, prefix="/tools", tags=["tools"])
app.include_router(remote_scraper_router)
app.include_router(settings_router)
app.include_router(document_router, prefix="/notes")
app.include_router(proxy_router)
app.include_router(cloud_sync_router)
app.include_router(chat_router)
app.include_router(data_router)
app.include_router(permissions_router)
app.include_router(capabilities_router)
app.include_router(fetch_proxy_router)
app.include_router(tunnel_router)
app.include_router(setup_router)
app.include_router(platform_router)

# NOTE: app.mount("/chat/ai", build_ai_sub_app()) is called in the lifespan handler
# (Phase 1b) AFTER initialize_matrx_ai() registers the DB config. Calling it here
# at module level would crash because matrx_ai imports trigger an ORM auto-fetch
# before the 'supabase_automation_matrix' config is registered.

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

    # High-frequency polling routes and CORS preflights — log at DEBUG to keep
    # the terminal readable.  Only genuinely interesting one-off requests stay at INFO.
    _SILENT_PATHS = frozenset({
        "/health",
        "/tools/list",
        "/cloud/heartbeat",
        "/ports",
        "/version",
        "/logs/access",
        # Setup/dashboard polling (fires every 2-5s)
        "/setup/status",
        # Device monitoring polling (fires every 2-10s)
        "/devices/system",
        "/devices/permissions",
        "/devices/audio",
        # Notes polling
        "/notes/tree",
        "/notes/notes",
        "/notes/sync/status",
        # Settings reads (fetched on every page mount)
        "/settings/paths",
        "/settings/forbidden-urls",
        # Status endpoints polled by Settings page
        "/proxy/status",
        "/tunnel/status",
        "/cloud/instance",
        "/cloud/instances",
        "/capabilities",
    })

    # OPTIONS preflights are always silent — they carry no data.
    is_options = request.method == "OPTIONS"
    log = logger.debug if (path in _SILENT_PATHS or is_options) else logger.info

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
        # WebSocketDisconnect with code 1012 = "Service Restart" — this is the
        # normal close code sent when the old engine is killed during a restart.
        # Logging it as ERROR creates noise in every update/restart cycle.
        # Any other unexpected exception is a genuine error worth surfacing.
        from starlette.websockets import WebSocketDisconnect
        if isinstance(e, WebSocketDisconnect) and e.code == 1012:
            logger.info(
                f"WebSocket closed for service restart (1012): {url}"
            )
        else:
            logger.error(
                f"WebSocket error: {e} | {url} | Headers: {dict(websocket.headers)}"
            )
    finally:
        await websocket_manager.disconnect(websocket)
