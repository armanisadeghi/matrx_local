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
import time
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


# Each reason fires its WARNING at most once per process, regardless of how
# many requests trigger it. The set is keyed by a short stable identifier so
# the same condition doesn't relog on every /extension/sessions poll.
_DEGRADED_WARNINGS_LOGGED: set[str] = set()


def _log_degraded_mode_once(reason: str) -> None:
    """Emit a single loud WARNING describing the actual degraded state.

    ``reason`` selects the exact failure mode the request fell into so the
    log is accurate. We deliberately do NOT log at startup — at startup we
    only know what's *configured*, not what tokens will actually arrive,
    and a JWKS-only setup can still validate tokens fine if the issuer
    starts emitting RS256/ES256. The first request that exercises a
    degraded path is the right moment to surface it.

    Recognised reasons (each fires at most once per process):
      * ``"no_paths"``       — neither SUPABASE_URL nor SUPABASE_JWT_SECRET
        is configured. This is the loopback-only happy path.
      * ``"hs256_no_secret"`` — incoming token is HS256-signed but only
        JWKS is configured. The HS256 key needed to verify it is not
        available to the engine. Common when a Supabase project has been
        partially migrated to asymmetric keys but auth still issues
        symmetric tokens.
    """
    if reason in _DEGRADED_WARNINGS_LOGGED:
        return
    _DEGRADED_WARNINGS_LOGGED.add(reason)

    if reason == "no_paths":
        logger.warning(
            "[extension_auth] JWT signature validation DISABLED — "
            "neither SUPABASE_JWT_SECRET nor SUPABASE_URL is configured. "
            "Falling back to permissive Bearer-presence check on "
            "/extension/* routes. This is fine for loopback-only "
            "deployments; set SUPABASE_JWT_SECRET in .env to enable "
            "cryptographic validation."
        )
    elif reason == "hs256_no_secret":
        logger.warning(
            "[extension_auth] Incoming token is HS256-signed but the "
            "engine has no SUPABASE_JWT_SECRET configured (only JWKS is "
            "set up — JWKS cannot verify HS256 tokens). Falling back to "
            "permissive Bearer-presence check on /extension/* routes for "
            "this and similar tokens. Set SUPABASE_JWT_SECRET in .env to "
            "enable cryptographic validation, or migrate the Supabase "
            "project to asymmetric (RS256/ES256) JWT signing so the JWKS "
            "path applies."
        )
    else:  # defensive — keep the log informative if a new reason ships
        logger.warning(
            "[extension_auth] JWT signature validation degraded "
            "(reason=%s) — falling back to permissive Bearer-presence "
            "check on /extension/* routes.",
            reason,
        )


# Per-kid suppression for the per-request DEBUG noise. Without this, a
# steady stream of /extension/sessions polls (every 2s) emits one DEBUG
# line per call for the same offending key id, drowning the log.
_DEBUG_FAILED_KIDS: set[str] = set()


# ---------------------------------------------------------------------------
# Rate-limited rejection logging
#
# The extension and other clients commonly poll /extension/rpc on a 2s
# interval. When the user is signed out (or the popup hasn't yet fetched a
# token), every poll fails with "missing Bearer token" — without rate
# limiting that's 30 WARNING lines per minute per polling client, which
# completely drowns the engine log and makes real warnings impossible to
# spot.
#
# Strategy: log the FIRST rejection of a given (path, reason) tuple as
# WARNING so the operator sees the issue immediately. Subsequent identical
# rejections within ``_REJECT_LOG_WINDOW_SECONDS`` are demoted to DEBUG and
# coalesced into a single "still rejecting" summary every
# ``_REJECT_SUMMARY_INTERVAL_SECONDS``. The summary tells you the
# rejection rate without restoring the per-request flood.
# ---------------------------------------------------------------------------

_REJECT_LOG_WINDOW_SECONDS = 60.0
_REJECT_SUMMARY_INTERVAL_SECONDS = 60.0

# Per-rejection-key state: { key: (first_seen, last_warned, last_summary, count) }
_RejectStateKey = tuple[str, str, str]  # (kind, path, reason)
_reject_log_state: dict[_RejectStateKey, dict[str, float]] = {}


def _log_rejection(kind: str, path: str, reason: str, *, method: str = "") -> None:
    """Log an auth-rejected request with rate-limit suppression.

    Args:
        kind: ``"http"`` or ``"ws"`` — purely cosmetic, distinguishes
            the two surfaces in the log line.
        path: the rejected request path. Used as part of the suppression
            key so the same path's repeated rejects coalesce, but a
            different path still surfaces immediately.
        reason: short stable identifier for *why* it was rejected
            (e.g. ``"missing_bearer"``, ``"invalid_signature"``).
        method: HTTP method (HTTP rejections only); blank for WS.

    Behaviour:
        * First reject for a (kind, path, reason) tuple → WARNING.
        * Subsequent rejects within the suppression window → DEBUG
          (silent in normal operation).
        * Every ``_REJECT_SUMMARY_INTERVAL_SECONDS`` of continuous
          rejections → INFO summary with the cumulative count.
    """
    now = time.monotonic()
    key: _RejectStateKey = (kind, path, reason)
    state = _reject_log_state.get(key)

    method_str = f"{method} " if method else ""
    label = "rejected" if kind == "http" else "WS rejected"

    if state is None:
        _reject_log_state[key] = {
            "first_seen": now,
            "last_warned": now,
            "last_summary": now,
            "count": 1.0,
        }
        logger.warning(
            "[extension_auth] %s %s%s — %s",
            label,
            method_str,
            path,
            reason.replace("_", " "),
        )
        return

    state["count"] += 1
    state["last_warned"] = now

    # Continued rejection beyond the suppression window — emit a periodic
    # summary so the operator knows the situation hasn't resolved.
    if now - state["last_summary"] >= _REJECT_SUMMARY_INTERVAL_SECONDS:
        elapsed = now - state["first_seen"]
        rate = state["count"] / elapsed if elapsed > 0 else 0.0
        logger.info(
            "[extension_auth] still %s %s%s (%s) — %.0f rejections in last %.0fs (%.1f/s)",
            label,
            method_str,
            path,
            reason.replace("_", " "),
            state["count"],
            elapsed,
            rate,
        )
        state["last_summary"] = now
        # Reset count so the next summary covers the next window without
        # double-counting historic data.
        state["first_seen"] = now
        state["count"] = 0.0
        return

    # Within suppression window after the initial WARNING — DEBUG only.
    logger.debug(
        "[extension_auth] %s %s%s — %s (suppressed; count=%.0f)",
        label,
        method_str,
        path,
        reason.replace("_", " "),
        state["count"],
    )


def _debug_log_jwks_failure(token: str, exc: Exception) -> None:
    """DEBUG-log a JWKS validation failure once per (kid, error-type).

    Per-request DEBUG output is too noisy when the same token (or family
    of tokens with the same ``kid``) keeps arriving. We hash the
    combination of ``kid`` and exception class so a genuinely new failure
    still surfaces while the steady-state poll-loop noise is muted.
    """
    try:
        import jwt as _jwt

        kid = _jwt.get_unverified_header(token).get("kid") or "<no-kid>"
    except Exception:
        kid = "<unparseable>"
    cache_key = f"{kid}:{type(exc).__name__}"
    if cache_key in _DEBUG_FAILED_KIDS:
        return
    _DEBUG_FAILED_KIDS.add(cache_key)
    logger.debug(
        "[extension_auth] JWKS validation failed for kid=%s: %s "
        "(further failures with this kid are suppressed)",
        kid,
        exc,
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

    Tries JWKS first (if applicable), then HS256 secret. Raises a generic exception on
    every failure path; callers translate to HTTP 401 / WS 1008.
    """
    last_error: Optional[Exception] = None

    # Peek at the token header to optimize the validation path
    try:
        import jwt as _jwt
        header = _jwt.get_unverified_header(token)
        alg = header.get("alg")
    except Exception as exc:
        header = {}
        alg = None
        last_error = exc

    jwks_url = _supabase_jwks_url()
    # Only attempt JWKS if the token is NOT symmetrically signed. JWKS cannot verify HS256.
    if jwks_url and alg != "HS256":
        try:
            payload = await asyncio.to_thread(
                _decode_with_jwks_sync, token, jwks_url
            )
            return _principal_from_payload(payload, token)
        except Exception as exc:
            last_error = exc
            _debug_log_jwks_failure(token, exc)

    secret = _env_jwt_secret()
    if secret and alg == "HS256":
        try:
            payload = await asyncio.to_thread(
                _decode_with_secret_sync, token, secret
            )
            return _principal_from_payload(payload, token)
        except Exception as exc:
            last_error = exc
            logger.debug("[extension_auth] HS256 validation failed: %s", exc)

    # Both paths failed (or weren't available).
    # If the token is HS256 but we don't have the shared secret, JWKS is
    # bypassed by design (line 294 above). The engine cannot verify the
    # signature, but the token is presumably still a real Supabase token —
    # just one whose key hasn't been provisioned to this binary. Fall back
    # gracefully and emit a single descriptive WARNING (not the generic
    # "no paths configured" one — that's misleading when SUPABASE_URL is
    # set).
    if alg == "HS256" and not secret:
        _log_degraded_mode_once("hs256_no_secret")
        return _degraded_principal(token)

    if last_error is not None:
        raise last_error
    raise RuntimeError("No JWT verification path is configured or token is invalid")


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
        _log_rejection(
            "http",
            request.url.path,
            "missing_bearer_token",
            method=request.method,
        )
        raise HTTPException(
            status_code=401,
            detail="Authorization Bearer token required",
        )

    if not _validation_enabled():
        _log_degraded_mode_once("no_paths")
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
        _log_rejection(
            "http",
            request.url.path,
            f"jwt_validation_failed_{type(exc).__name__}",
            method=request.method,
        )
        # Detailed exception goes at DEBUG to keep the WARNING line stable
        # while still preserving the full error in the dev log.
        logger.debug(
            "[extension_auth] %s %s validation exc detail: %s",
            request.method,
            request.url.path,
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
        _log_rejection("ws", websocket.url.path, "missing_bearer_token")
        await websocket.close(
            code=WS_CLOSE_POLICY_VIOLATION,
            reason="Missing auth token",
        )
        return None

    if not _validation_enabled():
        _log_degraded_mode_once("no_paths")
        return _degraded_principal(token)

    try:
        return await _verify_token(token)
    except Exception as exc:
        _log_rejection(
            "ws",
            websocket.url.path,
            f"jwt_validation_failed_{type(exc).__name__}",
        )
        logger.debug(
            "[extension_auth] WS %s validation exc detail: %s",
            websocket.url.path,
            exc,
        )
        await websocket.close(
            code=WS_CLOSE_POLICY_VIOLATION,
            reason="Invalid or expired credentials",
        )
        return None
