"""Active-user JWT lookup for background scraper calls.

The retry-queue poller, scrape-store cloud push, and dual-write tool
persistence all run in the background — they don't have access to an
incoming HTTP request's `request.state.user_token`. They need to fetch
the currently-logged-in user's JWT from local storage and forward it to
`RemoteScraperClient`.

Without this, those calls go out with only `SCRAPER_API_KEY` (typically
empty for end users), so the server can't attribute the writes to a
real user — and once auth is enforced server-side, every queue/save
call would 401.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


async def get_active_user_token() -> str | None:
    """Return the currently logged-in user's Supabase JWT, or None.

    Returns None when:
      - No user is logged in (no token row stored)
      - The stored token is expired
      - The local DB is unavailable for any reason

    Background callers should treat None as "skip this remote call" — the
    user isn't authenticated, so writes can't be attributed and would be
    rejected by the server.
    """
    try:
        from app.services.local_db.repositories import TokenRepo

        repo = TokenRepo()
        row = await repo.get()
        if not row:
            return None
        if repo.is_expired(row):
            logger.debug("[scraper-auth] stored JWT is expired; skipping remote call")
            return None
        token = row.get("access_token")
        if not token:
            return None
        return str(token)
    except Exception as exc:
        logger.warning("[scraper-auth] failed to load user token: %s", exc)
        return None
