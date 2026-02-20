from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, WebSocket, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.api.tool_routes import router as tool_router
from app.api.remote_scraper_routes import router as remote_scraper_router
from app.api.settings_routes import router as settings_router
from app.api.document_routes import router as document_router
from app.api.auth import AuthMiddleware
from app.config import ALLOWED_ORIGINS
from app.common.system_logger import get_logger
from app.services.scraper.engine import get_scraper_engine
from app.tools.tools.scheduler import restore_scheduled_tasks
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

    yield

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AuthMiddleware)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    try:
        body = await request.json() if request.method in ["POST", "PUT", "PATCH"] else None
        logger.info(f"Request: {request.method} {request.url} | Body: {body}")
    except Exception:
        logger.info(f"Request: {request.method} {request.url}")

    response = await call_next(request)
    logger.info(f"Response: {response.status_code} for {request.method} {request.url}")
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
