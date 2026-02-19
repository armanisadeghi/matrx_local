import asyncpg
from app.config import DATABASE_URL


async def get_connection():
    if not DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL is not configured. "
            "Set it in .env to enable database features."
        )
    return await asyncpg.connect(DATABASE_URL)
