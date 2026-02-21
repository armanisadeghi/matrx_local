"""Proxy management API routes.

Endpoints for starting/stopping the local HTTP proxy, checking its status,
and testing connectivity through it.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.proxy.server import get_proxy_server

router = APIRouter(prefix="/proxy", tags=["proxy"])


class ProxyStatus(BaseModel):
    running: bool
    port: int
    proxy_url: str
    request_count: int
    bytes_forwarded: int
    active_connections: int
    uptime_seconds: float


class ProxyStartRequest(BaseModel):
    port: int = 0  # 0 = auto-select


class ProxyTestResult(BaseModel):
    success: bool
    status_code: int | None = None
    body: str | None = None
    error: str | None = None
    proxy_url: str


@router.get("/status", response_model=ProxyStatus)
async def proxy_status() -> ProxyStatus:
    """Get the current proxy server status."""
    server = get_proxy_server()
    stats = server.stats
    return ProxyStatus(
        running=stats["running"],
        port=stats["port"],
        proxy_url=f"http://127.0.0.1:{stats['port']}" if stats["running"] else "",
        request_count=stats["request_count"],
        bytes_forwarded=stats["bytes_forwarded"],
        active_connections=stats["active_connections"],
        uptime_seconds=stats["uptime_seconds"],
    )


@router.post("/start", response_model=ProxyStatus)
async def proxy_start(req: ProxyStartRequest | None = None) -> ProxyStatus:
    """Start the HTTP proxy server."""
    server = get_proxy_server()
    port = await server.start(port=req.port if req else 0)
    stats = server.stats
    return ProxyStatus(
        running=True,
        port=port,
        proxy_url=f"http://127.0.0.1:{port}",
        request_count=stats["request_count"],
        bytes_forwarded=stats["bytes_forwarded"],
        active_connections=stats["active_connections"],
        uptime_seconds=stats["uptime_seconds"],
    )


@router.post("/stop")
async def proxy_stop() -> dict:
    """Stop the HTTP proxy server."""
    server = get_proxy_server()
    await server.stop()
    return {"status": "stopped"}


@router.post("/test", response_model=ProxyTestResult)
async def proxy_test() -> ProxyTestResult:
    """Test proxy connectivity by making a request through it."""
    server = get_proxy_server()
    if not server.running:
        return ProxyTestResult(
            success=False,
            error="Proxy server is not running",
            proxy_url="",
        )

    result = await server.test_connectivity()
    return ProxyTestResult(
        success=result["success"],
        status_code=result.get("status_code"),
        body=result.get("body"),
        error=result.get("error"),
        proxy_url=result["proxy_url"],
    )
