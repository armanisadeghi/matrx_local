"""Token sync routes — React pushes the Supabase JWT to Python for persistence.

Endpoints:
  POST /auth/token   — store a new JWT (called after login / token refresh)
  GET  /auth/token   — retrieve the current stored token (for Python-internal use)
  DELETE /auth/token — clear the stored token (called on logout)

These endpoints are intentionally listed in _PUBLIC_PATHS in auth.py because they
bootstrap the auth state — the JWT is the credential being *given* to Python, not
one it can validate beforehand.
"""

from __future__ import annotations

import time
from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.common.system_logger import get_logger
from app.services.local_db.repositories import TokenRepo
from app.services.ai.engine import clear_jwt_cache, set_jwt_cache

logger = get_logger()
router = APIRouter(prefix="/auth", tags=["auth-token"])


class TokenRequest(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    user_id: str
    expires_in: Optional[float] = None


class TokenResponse(BaseModel):
    access_token: str
    user_id: str
    expires_at: Optional[int] = None
    is_expired: bool = False


@router.post("/token")
async def save_token(req: TokenRequest) -> dict[str, Any]:
    """Store the user's JWT so Python can use it across restarts.

    Called by the React frontend after every successful auth (login, token refresh,
    initial session restore).  Python reads it on startup and whenever it needs to
    make authenticated API calls (e.g. SyncEngine fetching user prompts).
    """
    expires_at: Optional[int] = None
    if req.expires_in:
        expires_at = int(time.time()) + int(req.expires_in)

    repo = TokenRepo()
    await repo.save(
        access_token=req.access_token,
        user_id=req.user_id,
        refresh_token=req.refresh_token,
        expires_at=expires_at,
    )
    # Keep the in-memory cache hot so matrx-ai picks up the new token immediately.
    set_jwt_cache(req.access_token)
    logger.info(
        "[token_routes] JWT saved for user_id=%s expires_at=%s",
        req.user_id,
        expires_at,
    )
    return {"status": "ok", "user_id": req.user_id}


@router.get("/token")
async def get_token() -> dict[str, Any]:
    """Return the currently stored token.

    Used internally by the sync engine and any Python service that needs the
    current user JWT.  React should never call this — it has its own Supabase
    session.  Returns 404-style empty dict if no token is stored.
    """
    repo = TokenRepo()
    row = await repo.get()
    if not row:
        return {"present": False}

    is_expired = repo.is_expired(row)
    return {
        "present": True,
        "user_id": row.get("user_id"),
        "expires_at": row.get("expires_at"),
        "is_expired": is_expired,
        "access_token": row.get("access_token"),
    }


@router.delete("/token")
async def clear_token() -> dict[str, Any]:
    """Clear the stored JWT on logout."""
    repo = TokenRepo()
    await repo.clear()
    clear_jwt_cache()
    logger.info("[token_routes] JWT cleared (logout)")
    return {"status": "ok"}
