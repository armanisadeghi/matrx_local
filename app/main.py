from fastapi import FastAPI, WebSocket, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.api.tool_routes import router as tool_router
from app.config import ALLOWED_ORIGINS
from app.common.system_logger import get_logger
from app.websocket_manager import WebSocketManager

logger = get_logger()
websocket_manager = WebSocketManager()

app = FastAPI(
    title="Matrx Local",
    description="Local companion service for AI Matrx — browser-to-filesystem bridge",
    version="0.2.0",
)

app.include_router(api_router)
app.include_router(tool_router, prefix="/tools", tags=["tools"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
