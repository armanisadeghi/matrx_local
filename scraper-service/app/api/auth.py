from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import HTTPException, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings

logger = logging.getLogger(__name__)

_bearer_scheme = HTTPBearer()
_jwk_client: Any = None


def _get_jwk_client(jwks_url: str) -> Any:
    global _jwk_client
    if _jwk_client is None:
        import jwt

        _jwk_client = jwt.PyJWKClient(jwks_url, cache_keys=True, lifespan=3600)
    return _jwk_client


def _validate_jwt_sync(token: str, jwks_url: str) -> dict[str, Any]:
    import jwt

    jwk_client = _get_jwk_client(jwks_url)
    signing_key = jwk_client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["ES256", "RS256", "HS256"],
        options={"verify_aud": False},
    )


async def require_api_key(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Security(_bearer_scheme),
) -> str:
    settings: Settings = request.app.state.settings
    token = credentials.credentials

    if token == settings.API_KEY:
        return token

    if settings.SUPABASE_JWKS_URL:
        try:
            payload = await asyncio.to_thread(
                _validate_jwt_sync, token, settings.SUPABASE_JWKS_URL
            )
            request.state.user = payload
            return token
        except Exception as e:
            logger.debug("JWT validation failed: %s", e)

    raise HTTPException(status_code=401, detail="Invalid credentials")
