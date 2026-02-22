import asyncio
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, WebSocket, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.api.tool_routes import router as tool_router
from app.api.remote_scraper_routes import router as remote_scraper_router
from app.api.settings_routes import router as settings_router
from app.api.document_routes import router as document_router
from app.api.proxy_routes import router as proxy_router
from app.api.cloud_sync_routes import router as cloud_sync_router
from app.api.chat_routes import router as chat_router
from app.api.auth import AuthMiddleware
from app.config import ALLOWED_ORIGINS
from app.common.system_logger import get_logger
import app.common.access_log as access_log
from app.services.scraper.engine import get_scraper_engine
from app.services.proxy.server import get_proxy_server
from app.services.cloud_sync.settings_sync import get_settings_sync
from app.tools.tools.scheduler import restore_scheduled_tasks
import app.services.scraper.retry_queue as retry_queue
from app.websocket_manager import WebSocketManager

logger = get_logger()
websocket_manager = WebSocketManager()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    engine = get_scraper_engine()
    try:
        await engine.start()
    except Exception:
        logger.error("Scraper engine failed to start — scraping tools will be unavailable", exc_info=True)

    restored = await restore_scheduled_tasks()
    if restored:
        logger.info("Scheduler: %d task(s) restored from previous session", restored)

    # Start HTTP proxy if enabled in settings
    settings_sync = get_settings_sync()
    if settings_sync.get("proxy_enabled", True):
        try:
            proxy = get_proxy_server()
            proxy_port = settings_sync.get("proxy_port", 22180)
            await proxy.start(port=proxy_port)
        except Exception:
            logger.error("HTTP proxy failed to start", exc_info=True)

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

    yield

    retry_queue.stop()
    heartbeat_task.cancel()
    try:
        await heartbeat_task
    except asyncio.CancelledError:
        pass

    # Stop proxy server
    try:
        proxy = get_proxy_server()
        await proxy.stop()
    except Exception:
        logger.error("HTTP proxy failed to stop cleanly", exc_info=True)

    try:
        await engine.stop()
    except Exception:
        logger.error("Scraper engine failed to stop cleanly", exc_info=True)


app = FastAPI(
    title="Matrx Local",
    description="Local companion service for AI Matrx — browser-to-filesystem bridge",
    version="0.2.0",
    lifespan=lifespan,
)

app.include_router(api_router)
app.include_router(tool_router, prefix="/tools", tags=["tools"])
app.include_router(remote_scraper_router)
app.include_router(settings_router)
app.include_router(document_router)
app.include_router(proxy_router)
app.include_router(cloud_sync_router)
app.include_router(chat_router)

app.add_middleware(AuthMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    import time as _time
    t0 = _time.monotonic()

    # Best-effort body preview for system logger (doesn't consume the stream).
    try:
        body = await request.json() if request.method in ["POST", "PUT", "PATCH"] else None
        logger.info(f"Request: {request.method} {request.url} | Body: {body}")
    except Exception:
        logger.info(f"Request: {request.method} {request.url}")

    response = await call_next(request)
    duration_ms = (_time.monotonic() - t0) * 1000

    logger.info(f"Response: {response.status_code} for {request.method} {request.url}")

    # Write structured access-log entry.
    access_log.record(
        method=request.method,
        path=request.url.path,
        query=str(request.url.query or ""),
        origin=request.headers.get("origin", ""),
        user_agent=request.headers.get("user-agent", ""),
        status=response.status_code,
        duration_ms=duration_ms,
    )

    return response


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    conn = await websocket_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await websocket_manager.handle_tool_message(conn, data)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        await websocket_manager.disconnect(websocket)
