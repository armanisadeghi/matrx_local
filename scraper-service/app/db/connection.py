from __future__ import annotations

import logging
from typing import AsyncGenerator

import asyncpg

logger = logging.getLogger(__name__)


async def create_pool(database_url: str, min_size: int = 2, max_size: int = 10) -> asyncpg.Pool:
    logger.info("Creating database connection pool")
    pool = await asyncpg.create_pool(
        database_url,
        min_size=min_size,
        max_size=max_size,
    )
    if pool is None:
        raise RuntimeError("Failed to create database connection pool")
    logger.info("Database connection pool created (min=%d, max=%d)", min_size, max_size)
    return pool


async def close_pool(pool: asyncpg.Pool) -> None:
    logger.info("Closing database connection pool")
    await pool.close()
    logger.info("Database connection pool closed")
