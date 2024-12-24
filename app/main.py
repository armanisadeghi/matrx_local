from fastapi import FastAPI, WebSocket, Request
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router as api_router
from app.websocket_manager import WebSocketManager
from app.config import ALLOWED_ORIGINS
from app.common.system_logger import get_logger

# Initialize logger
logger = get_logger()

# Initialize WebSocket manager
websocket_manager = WebSocketManager()

# Create the FastAPI app instance
app = FastAPI()

# Add API routes
app.include_router(api_router)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Middleware to log all requests and responses
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """
    Middleware to log all incoming requests and responses.
    """
    try:
        body = await request.json() if request.method in ["POST", "PUT", "PATCH"] else None
        logger.info(f"Request: {request.method} {request.url} | Body: {body}")
    except Exception:
        logger.info(f"Request: {request.method} {request.url} | Body could not be parsed")

    response = await call_next(request)
    logger.info(f"Response: {response.status_code} for {request.method} {request.url}")
    return response

# WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await websocket_manager.send_message(f"Received: {data}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        await websocket_manager.disconnect(websocket)
