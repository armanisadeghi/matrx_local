from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID

import asyncpg

logger = logging.getLogger(__name__)

RETRYABLE_REASONS = frozenset({
    "cloudflare_block",
    "blocked",
    "bad_status",
    "request_error",
    "proxy_error",
})


async def enqueue_retry(
    pool: asyncpg.Pool,
    target_url: str,
    failure_reason: str,
    failure_log_id: Optional[UUID] = None,
    tier: str = "desktop",
    request_context: Optional[dict[str, Any]] = None,
) -> Optional[UUID]:
    if failure_reason not in RETRYABLE_REASONS:
        return None

    async with pool.acquire() as conn:
        existing = await conn.fetchval(
            """SELECT id FROM scrape_retry_queue
               WHERE target_url = $1 AND status IN ('pending', 'claimed')
               LIMIT 1""",
            target_url,
        )
        if existing:
            logger.debug("URL already queued: %s", target_url)
            return existing

        import json
        ctx = json.dumps(request_context or {})
        row_id = await conn.fetchval(
            """INSERT INTO scrape_retry_queue
                   (target_url, domain_name, failure_log_id, failure_reason, tier, request_context)
               VALUES ($1, (SELECT COALESCE(
                   (SELECT domain_name FROM scrape_failure_log WHERE id = $2),
                   split_part(split_part($1, '://', 2), '/', 1)
               )), $2, $3, $4, $5::jsonb)
               RETURNING id""",
            target_url, failure_log_id, failure_reason, tier, ctx,
        )
        logger.info("Enqueued retry: %s (tier=%s, reason=%s)", target_url, tier, failure_reason)
        return row_id


async def get_pending(
    pool: asyncpg.Pool,
    tier: str = "desktop",
    limit: int = 10,
    domain: Optional[str] = None,
) -> list[dict[str, Any]]:
    async with pool.acquire() as conn:
        await _expire_stale_claims(conn)

        if domain:
            rows = await conn.fetch(
                """SELECT id, target_url, domain_name, failure_reason, tier, created_at
                   FROM scrape_retry_queue
                   WHERE status = 'pending' AND tier = $1 AND domain_name = $2
                   ORDER BY created_at ASC
                   LIMIT $3""",
                tier, domain, limit,
            )
        else:
            rows = await conn.fetch(
                """SELECT id, target_url, domain_name, failure_reason, tier, created_at
                   FROM scrape_retry_queue
                   WHERE status = 'pending' AND tier = $1
                   ORDER BY created_at ASC
                   LIMIT $2""",
                tier, limit,
            )

        total = await conn.fetchval(
            "SELECT COUNT(*) FROM scrape_retry_queue WHERE status = 'pending' AND tier = $1",
            tier,
        )

    return [
        {
            "id": str(r["id"]),
            "target_url": r["target_url"],
            "domain_name": r["domain_name"],
            "failure_reason": r["failure_reason"],
            "tier": r["tier"],
            "created_at": r["created_at"].isoformat(),
            "total_pending": total,
        }
        for r in rows
    ]


async def claim_items(
    pool: asyncpg.Pool,
    item_ids: list[str],
    client_id: str,
    claim_ttl_minutes: int = 10,
) -> dict[str, list[str]]:
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=claim_ttl_minutes)
    claimed: list[str] = []
    already_claimed: list[str] = []

    async with pool.acquire() as conn:
        for item_id in item_ids:
            result = await conn.execute(
                """UPDATE scrape_retry_queue
                   SET status = 'claimed', claimed_by = $2, claimed_at = $3, claim_expires_at = $4
                   WHERE id = $1::uuid AND status = 'pending'""",
                item_id, client_id, now, expires,
            )
            if result == "UPDATE 1":
                claimed.append(item_id)
            else:
                already_claimed.append(item_id)

    return {"claimed": claimed, "already_claimed": already_claimed}


async def submit_result(
    pool: asyncpg.Pool,
    queue_item_id: str,
) -> bool:
    now = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        result = await conn.execute(
            """UPDATE scrape_retry_queue
               SET status = 'completed', completed_at = $2, attempt_count = attempt_count + 1
               WHERE id = $1::uuid AND status = 'claimed'""",
            queue_item_id, now,
        )
    return result == "UPDATE 1"


async def fail_item(
    pool: asyncpg.Pool,
    queue_item_id: str,
    error: str,
    promote_to_extension: bool = False,
) -> bool:
    async with pool.acquire() as conn:
        if promote_to_extension:
            result = await conn.execute(
                """UPDATE scrape_retry_queue
                   SET status = 'pending', tier = 'extension',
                       last_error = $2, attempt_count = attempt_count + 1,
                       claimed_by = NULL, claimed_at = NULL, claim_expires_at = NULL
                   WHERE id = $1::uuid AND status = 'claimed' AND tier = 'desktop'""",
                queue_item_id, error,
            )
        else:
            result = await conn.execute(
                """UPDATE scrape_retry_queue
                   SET status = 'failed', last_error = $2, attempt_count = attempt_count + 1
                   WHERE id = $1::uuid AND status = 'claimed'""",
                queue_item_id, error,
            )
    return result == "UPDATE 1"


async def get_queue_stats(pool: asyncpg.Pool) -> dict[str, Any]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT status, tier, COUNT(*) as count
               FROM scrape_retry_queue
               GROUP BY status, tier
               ORDER BY status, tier""",
        )
    stats: dict[str, Any] = {"total": 0, "by_status": {}, "by_tier": {}}
    for r in rows:
        s, t, c = r["status"], r["tier"], r["count"]
        stats["total"] += c
        stats["by_status"][s] = stats["by_status"].get(s, 0) + c
        stats["by_tier"].setdefault(t, {})[s] = c
    return stats


async def _expire_stale_claims(conn: asyncpg.Connection) -> None:
    now = datetime.now(timezone.utc)
    await conn.execute(
        """UPDATE scrape_retry_queue
           SET status = 'pending', claimed_by = NULL, claimed_at = NULL, claim_expires_at = NULL
           WHERE status = 'claimed' AND claim_expires_at < $1""",
        now,
    )
