from __future__ import annotations

import logging
from typing import Optional

import asyncpg

from app.models.enums import FAILURE_CATEGORY_MAP, FailureReason
from app.utils.url import extract_domain

logger = logging.getLogger(__name__)


async def log_failure(
    pool: asyncpg.Pool,
    target_url: str,
    failure_reason: FailureReason,
    status_code: Optional[int] = None,
    error_log: Optional[str] = None,
    proxy_used: bool = False,
    proxy_type: Optional[str] = None,
    attempt_count: int = 1,
) -> None:
    domain_name = extract_domain(target_url)
    failure_category = FAILURE_CATEGORY_MAP.get(failure_reason)

    try:
        async with pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO scrape_failure_log
                    (target_url, domain_name, failure_reason, failure_category,
                     status_code, error_log, proxy_used, proxy_type, attempt_count)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """,
                target_url,
                domain_name,
                failure_reason.value,
                failure_category,
                status_code,
                error_log,
                proxy_used,
                proxy_type,
                attempt_count,
            )
    except Exception:
        logger.exception("Failed to log scrape failure for %s", target_url)
