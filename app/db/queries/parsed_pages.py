from __future__ import annotations

import asyncpg


async def mark_stale_expired(pool: asyncpg.Pool) -> int:
    async with pool.acquire() as conn:
        result = await conn.execute("""
            UPDATE scrape_parsed_page
            SET validity = 'stale'
            WHERE validity = 'active' AND expires_at < NOW()
        """)
        count = int(result.split()[-1]) if result else 0
        return count
