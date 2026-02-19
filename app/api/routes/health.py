from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check(request: Request) -> dict[str, str]:
    pool = request.app.state.db_pool
    try:
        async with pool.acquire() as conn:
            result = await conn.fetchval("SELECT 1")
        db_status = "connected" if result == 1 else "error"
    except Exception:
        db_status = "disconnected"

    status = "ok" if db_status == "connected" else "degraded"
    return {"status": status, "db": db_status}
