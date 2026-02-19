from __future__ import annotations

from fastapi import Depends, HTTPException, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings

_bearer_scheme = HTTPBearer()


async def require_api_key(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Security(_bearer_scheme),
) -> str:
    settings: Settings = request.app.state.settings
    if credentials.credentials != settings.API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return credentials.credentials
