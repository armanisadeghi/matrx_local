# Database connections are no longer used directly in matrx-local.
# All scraper DB access goes through the scraper server REST API.
# This file is kept to avoid breaking any imports during the transition.


async def get_connection():
    raise RuntimeError(
        "Direct database connections are not supported. "
        "Use the scraper server API at /remote-scraper/* instead."
    )
