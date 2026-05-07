"""Production-grade Supabase JWT validation for the /extension/* surface.

Background
----------
The engine's existing ``AuthMiddleware`` (``app/api/auth.py``) only checks
that *some* Bearer token is present on protected requests — it does not
verify the signature. That posture is acceptable for the loopback-only
boundary the engine binds to today (``127.0.0.1`` + Tauri/extension as the
only callers), but it does not scale: as soon as the engine is reachable
over a Cloudflare tunnel, a corp-network bridge, or any future remote-access
substrate, an unsigned-but-non-empty Bearer is no defence at all.

This module adds a second, production-grade layer specifically for the
``/extension/*`` routes — the surface the Chrome extension calls into.
Other engine routes (``/ws``, ``/tools/*``, etc.) are unchanged: they keep
the permissive Bearer check, since the user trusts their own desktop UI
and CLI clients.

Verification strategy (in priority order)
-----------------------------------------
1. **JWKS / asymmetric (preferred).** Supabase publishes its signing keys
   at ``<SUPABASE_URL>/auth/v1/.well-known/jwks.json``. We use
   ``jwt.PyJWKClient`` to fetch + cache them and verify with the
   advertised algorithm (typically ``ES256`` / ``RS256``). No secret on the
   engine. This matches the pattern already used by ``scraper-service``
   (see ``scraper-service/app/api/auth.py``) and is the recommended modern
   approach for Supabase. Whenever ``SUPABASE_URL`` is set we attempt this
   path first.
2. **HS256 / shared secret (fallback).** If ``SUPABASE_JWT_SECRET`` is
   configured (Supabase dashboard → Settings → API → "JWT Secret"), we
   verify the signature with that secret. This is useful when the engine
   cannot reach the JWKS endpoint (offline / locked-down network) but
   still needs to validate user tokens.
3. **Loopback fallback (graceful degradation).** If neither path is
   available — no ``SUPABASE_URL``, no ``SUPABASE_JWT_SECRET`` — we
   preserve the engine's existing permissive-Bearer behaviour, but log a
   loud ``WARNING`` once at module import so the operator knows JWT
   validation is disabled. This keeps the loopback-only happy path
   working unchanged for users who haven't configured the secret yet.

The fallback is *only* about signature verification. Token presence is
always required; missing-token requests are rejected with ``401`` /
WebSocket close ``1008`` regardless of configuration.

Public API
----------
``ExtensionPrincipal`` — dataclass returned by both validators.
``validate_extension_principal(request)`` — FastAPI HTTP dependency.
``validate_extension_principal_ws(websocket)`` — async helper for the
    ``/extension/ws`` and ``/extension/bridge-events`` upgrades, where
    FastAPI's ``Depends`` machinery does not apply.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any, Optional

from fastapi import HTTPException, Request, WebSocket

from app.common.system_logger import get_logger
from app.config import SUPABASE_URL

logger = get_logger()


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def _env_jwt_secret() -> str:
    """Read SUPABASE_JWT_SECRET fresh on every call.

    Read at call-time (not import-time) so a ``.env`` reload or an in-process
    setting flip via the engine's settings UI takes effect immediately
    without a restart.
    """
    return os.getenv("SUPABASE_JWT_SECRET", "").strip()


def _supabase_jwks_url() -> Optional[str]:
    """Derive the well-known JWKS URL from ``SUPABASE_URL``.

    Returns ``None`` when ``SUPABASE_URL`` is empty, which lets the caller
    cleanly skip the JWKS path without raising.
    """
    base = (SUPABASE_URL or "").rstrip("/")
    if not base:
        return None
    return f"{base}/auth/v1/.well-known/jwks.json"


def _validation_enabled() -> bool:
    """Whether *any* signature-verification path is currently available.

    When this returns ``False`` we fall back to permissive Bearer-presence
    checking. We log a loud one-time WARNING in that case so operators
    notice the degraded posture.
    """
    return bool(_env_jwt_secret()) or bool(_supabase_jwks_url())


_DEGRADED_WARNING_LOGGED = False


def _maybe_log_degraded_mode_once() -> None:
    """Emit a single loud WARNING when no verification path is configured.

    Idempotent — only fires the first time the engine actually serves a
    request that *would* have been verified. Logging at startup is too
    noisy (the engine may never see an extension request); logging on
    every request would spam the log. Once-per-process is the right
    middle ground.
    """
    global _DEGRADED_WARNING_LOGGED
    if _DEGRADED_WARNING_LOGGED:
        return
    _DEGRADED_WARNING_LOGGED = True
    logger.warning(
        "[extension_auth] JWT signature validation DISABLED — "
        "neither SUPABASE_JWT_SECRET nor SUPABASE_URL is configured. "
        "Falling back to permissive Bearer-presence check on /extension/* "
        "routes. This is fine for loopback-only deployments; set "
        "SUPABASE_JWT_SECRET in .env to enable cryptographic validation."
    )


# ---------------------------------------------------------------------------
# Principal
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ExtensionPrincipal:
    """Validated identity for an inbound /extension/* request.

    Attributes:
        user_id: JWT ``sub`` claim. For Supabase, this is the auth user UUID.
            Empty string in degraded-fallback mode (when validation is
            disabled and we accept the token unverified).
        email: JWT ``email`` claim if present, otherwise ``None``.
        is_anon: ``True`` when the JWT carries ``role: 'anon'`` or
            ``is_anonymous: true`` (Supabase guest sessions). Always
            ``False`` in degraded-fallback mode.
        raw_token: Original token string, for downstream forwarding to the
            scraper / aidream backends that may need to re-authenticate
            the same user.
        verified: ``True`` when the signature was cryptographically
            verified, ``False`` when this principal came from the
            degraded-fallback path. Lets handlers branch on trust level
            without re-checking config state.
    """

    user_id: str
    email: Optional[str]
    is_anon: bool
    raw_token: str
    verified: bool


# ---------------------------------------------------------------------------
# JWKS path (preferred)
# ---------------------------------------------------------------------------

# Cached PyJWKClient — the client itself caches signing keys with a TTL,
# but constructing it does an HTTP fetch the first time, so we hold one
# per process keyed by JWKS URL.
_jwks_client_cache: dict[str, Any] = {}


def _get_jwks_client(jwks_url: str) -> Any:
    """Return a cached ``jwt.PyJWKClient`` for the given URL.

    The PyJWKClient caches signing keys for one hour; we re-use the same
    client object so that cache survives across requests.
    """
    cached = _jwks_client_cache.get(jwks_url)
    if cached is not None:
        return cached
    # Lazy import — keep ``jwt`` out of the module-import cycle so the
    # catalog regen / tooling that touches this file works without a
    # mandatory PyJWT runtime.
    import jwt as _jwt

    client = _jwt.PyJWKClient(jwks_url, cache_keys=True, lifespan=3600)
    _jwks_client_cache[jwks_url] = client
    return client


def _decode_with_jwks_sync(token: str, jwks_url: str) -> dict[str, Any]:
    """Verify ``token`` against Supabase JWKS. Synchronous (run in a thread).

    PyJWT's ``decode`` is CPU-bound (signature verification) and the JWKS
    client's first call is blocking I/O — both warrant ``asyncio.to_thread``.

    ``verify_aud=False``: Supabase tokens carry ``aud="authenticated"``
    which we don't pin since we accept any authenticated user. ``verify_exp``
    stays default-on, so expired tokens are rejected.
    """
    import jwt as _jwt

    client = _get_jwks_client(jwks_url)
    signing_key = client.get_signing_key_from_jwt(token)
    return _jwt.decode(
        token,
        signing_key.key,
        algorithms=["ES256", "RS256"],
        options={"verify_aud": False},
    )


# ---------------------------------------------------------------------------
# HS256 path (fallback shared-secret)
# ---------------------------------------------------------------------------


def _decode_with_secret_sync(token: str, secret: str) -> dict[str, Any]:
    """Verify ``token`` with the project's HS256 ``SUPABASE_JWT_SECRET``."""
    import jwt as _jwt

    return _jwt.decode(
        token,
        secret,
        algorithms=["HS256"],
        options={"verify_aud": False},
    )


# ---------------------------------------------------------------------------
# Token extraction
# ---------------------------------------------------------------------------


def _extract_bearer(request: Request) -> Optional[str]:
    """Extract a Bearer token from ``Authorization`` header or ``?token=``."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        candidate = auth[7:].strip()
        if candidate:
            return candidate
    qp_token = request.query_params.get("token")
    if isinstance(qp_token, str) and qp_token.strip():
        return qp_token.strip()
    return None


def _extract_bearer_ws(websocket: WebSocket) -> Optional[str]:
    """Extract a Bearer token from a WebSocket upgrade request.

    Same precedence as the HTTP path. Browsers cannot set custom headers on
    a WS upgrade so the ``?token=`` query param is the canonical channel
    for the extension; the header path stays available for non-browser
    clients (curl, the desktop test panel).
    """
    auth = websocket.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        candidate = auth[7:].strip()
        if candidate:
            return candidate
    qp_token = websocket.query_params.get("token")
    if isinstance(qp_token, str) and qp_token.strip():
        return qp_token.strip()
    return None


# ---------------------------------------------------------------------------
# Core verification
# ---------------------------------------------------------------------------


async def _verify_token(token: str) -> ExtensionPrincipal:
    """Verify ``token`` and return a populated principal.

    Tries JWKS first, then HS256 secret. Raises a generic exception on
    every failure path; callers translate to HTTP 401 / WS 1008.
    """
    last_error: Optional[Exception] = None

    jwks_url = _supabase_jwks_url()
    if jwks_url:
        try:
            payload = await asyncio.to_thread(
                _decode_with_jwks_sync, token, jwks_url
            )
            return _principal_from_payload(payload, token)
        except Exception as exc:
            # JWKS may legitimately reject a stale-but-valid HS256 token
            # if Supabase has rotated to asymmetric keys but a client
            # still holds an old HS-signed JWT. Fall through to the
            # secret path before giving up.
            last_error = exc
            logger.debug("[extension_auth] JWKS validation failed: %s", exc)

    secret = _env_jwt_secret()
    if secret:
        try:
            payload = await asyncio.to_thread(
                _decode_with_secret_sync, token, secret
            )
            return _principal_from_payload(payload, token)
        except Exception as exc:
            last_error = exc
            logger.debug("[extension_auth] HS256 validation failed: %s", exc)

    # Both paths failed (or weren't available). Re-raise the most recent
    # error so the 401 surface includes a useful detail in dev logs while
    # still presenting a generic message to the client.
    if last_error is not None:
        raise last_error
    raise RuntimeError("No JWT verification path is configured")


def _principal_from_payload(
    payload: dict[str, Any], raw_token: str
) -> ExtensionPrincipal:
    """Construct a principal from a verified JWT payload."""
    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub:
        # A signature-valid token without a ``sub`` claim is not actionable;
        # treat it as a hard failure rather than silently empty.
        raise ValueError("JWT missing 'sub' claim")

    email_raw = payload.get("email")
    email = email_raw if isinstance(email_raw, str) and email_raw else None

    role = payload.get("role")
    is_anon = role == "anon" or bool(payload.get("is_anonymous"))

    return ExtensionPrincipal(
        user_id=sub,
        email=email,
        is_anon=is_anon,
        raw_token=raw_token,
        verified=True,
    )


def _degraded_principal(token: str) -> ExtensionPrincipal:
    """Construct a fallback principal when no verification path is configured.

    Used only when the engine is running without JWT-secret + JWKS — the
    loopback-only happy path. The principal is marked ``verified=False``
    so any downstream code that wants to gate on real identity can do so.
    """
    return ExtensionPrincipal(
        user_id="",
        email=None,
        is_anon=False,
        raw_token=token,
        verified=False,
    )


# ---------------------------------------------------------------------------
# Public — HTTP dependency
# ---------------------------------------------------------------------------


async def validate_extension_principal(request: Request) -> ExtensionPrincipal:
    """FastAPI dependency: verify the inbound Bearer token, return principal.

    Raises:
        HTTPException(401): missing token, invalid signature, or expired
        token. The detail message intentionally stays generic ("Invalid
        or missing credentials") to avoid leaking which leg of the
        verification failed.

    Returns:
        ExtensionPrincipal — ``verified=True`` on a real signature check,
        ``verified=False`` in graceful-degradation mode.
    """
    token = _extract_bearer(request)
    if not token:
        logger.warning(
            "[extension_auth] rejected %s %s — missing Bearer token",
            request.method,
            request.url.path,
        )
        raise HTTPException(
            status_code=401,
            detail="Authorization Bearer token required",
        )

    if not _validation_enabled():
        _maybe_log_degraded_mode_once()
        principal = _degraded_principal(token)
        # Stash on request.state for symmetry with the verified path —
        # downstream code can read ``request.state.principal`` regardless
        # of mode. The existing ``request.state.user_token`` field set by
        # the upstream AuthMiddleware is left intact.
        request.state.principal = principal
        return principal

    try:
        principal = await _verify_token(token)
    except Exception as exc:
        logger.warning(
            "[extension_auth] rejected %s %s — JWT validation failed (%s: %s)",
            request.method,
            request.url.path,
            type(exc).__name__,
            exc,
        )
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired credentials",
        ) from exc

    request.state.principal = principal
    return principal


# ---------------------------------------------------------------------------
# Public — WebSocket helper
# ---------------------------------------------------------------------------


# WS close codes — RFC 6455 / RFC 7235 align with these conventions:
WS_CLOSE_POLICY_VIOLATION = 1008  # Auth failures (missing/invalid token)


async def validate_extension_principal_ws(
    websocket: WebSocket,
) -> Optional[ExtensionPrincipal]:
    """Verify the inbound WS upgrade. Closes the socket on failure.

    FastAPI's ``Depends`` machinery only runs *after* ``websocket.accept()``
    has resolved, which means a dependency-raised ``HTTPException`` would
    bubble up *post-handshake* and result in a confused client. The
    correct pattern for WS auth is to validate inline before ``accept()``
    and close with code ``1008`` on rejection — that's what this helper
    does.

    Returns:
        ExtensionPrincipal on success, or ``None`` if the socket was
        already closed (caller should ``return`` immediately on ``None``).
    """
    token = _extract_bearer_ws(websocket)
    if not token:
        logger.warning(
            "[extension_auth] WS rejected %s — missing Bearer token",
            websocket.url.path,
        )
        await websocket.close(
            code=WS_CLOSE_POLICY_VIOLATION,
            reason="Missing auth token",
        )
        return None

    if not _validation_enabled():
        _maybe_log_degraded_mode_once()
        return _degraded_principal(token)

    try:
        return await _verify_token(token)
    except Exception as exc:
        logger.warning(
            "[extension_auth] WS rejected %s — JWT validation failed (%s: %s)",
            websocket.url.path,
            type(exc).__name__,
            exc,
        )
        await websocket.close(
            code=WS_CLOSE_POLICY_VIOLATION,
            reason="Invalid or expired credentials",
        )
        return None
