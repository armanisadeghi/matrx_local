from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import asyncpg
from cachetools import TTLCache

logger = logging.getLogger(__name__)


class PageCache:
    def __init__(self, pool: asyncpg.Pool, max_size: int = 1000, ttl_seconds: int = 1800) -> None:
        self._pool = pool
        self._memory: TTLCache[str, dict[str, Any]] = TTLCache(maxsize=max_size, ttl=ttl_seconds)

    async def get(self, page_name: str) -> Optional[dict[str, Any]]:
        if page_name in self._memory:
            logger.debug("Cache HIT (memory): %s", page_name)
            return self._memory[page_name]

        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT content, url, domain, scraped_at, content_type, char_count
                FROM scrape_parsed_page
                WHERE page_name = $1 AND validity = 'active' AND expires_at > NOW()
                LIMIT 1
            """, page_name)

        if row:
            content = row["content"]
            if isinstance(content, str):
                content = json.loads(content)
            data = {
                "content": content,
                "url": row["url"],
                "domain": row["domain"],
                "scraped_at": row["scraped_at"].isoformat() if row["scraped_at"] else None,
                "content_type": row["content_type"],
                "char_count": row["char_count"],
            }
            self._memory[page_name] = data
            logger.debug("Cache HIT (db): %s", page_name)
            return data

        logger.debug("Cache MISS: %s", page_name)
        return None

    async def set(
        self,
        page_name: str,
        url: str,
        domain: str,
        content: dict[str, Any],
        content_type: str,
        char_count: int,
        ttl_days: int = 30,
    ) -> None:
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(days=ttl_days)
        content_json = json.dumps(content, default=str)

        async with self._pool.acquire() as conn:
            await conn.execute("""
                UPDATE scrape_parsed_page
                SET validity = 'stale'
                WHERE page_name = $1 AND validity = 'active'
            """, page_name)

            await conn.execute("""
                INSERT INTO scrape_parsed_page
                    (page_name, url, domain, scraped_at, expires_at, validity, content, char_count, content_type)
                VALUES ($1, $2, $3, $4, $5, 'active', $6::jsonb, $7, $8)
            """, page_name, url, domain, now, expires_at, content_json, char_count, content_type)

        data = {
            "content": content,
            "url": url,
            "domain": domain,
            "scraped_at": now.isoformat(),
            "content_type": content_type,
            "char_count": char_count,
        }
        self._memory[page_name] = data
        logger.debug("Cache SET: %s (expires %s)", page_name, expires_at.isoformat())

    async def invalidate(self, page_name: str) -> None:
        self._memory.pop(page_name, None)
        async with self._pool.acquire() as conn:
            await conn.execute("""
                UPDATE scrape_parsed_page
                SET validity = 'invalid'
                WHERE page_name = $1 AND validity = 'active'
            """, page_name)
