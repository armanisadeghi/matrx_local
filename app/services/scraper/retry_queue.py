"""Retry queue background service.

The remote scraper server automatically enqueues URLs it failed to scrape
(Cloudflare blocks, IP bans, etc.) for the desktop app to retry using the
user's residential IP.

This module runs a background asyncio task that:
  1. Polls GET /api/v1/queue/pending every 30s
  2. Claims items (10-min TTL)
  3. Scrapes each URL locally via the ScraperEngine
  4. On success → POST /api/v1/queue/submit  (content stored in server DB)
     On success → also save_content() directly (belt-and-suspenders)
  5. On failure → POST /api/v1/queue/fail    (promotes to Chrome ext tier)
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from app.services.scraper.remote_client import get_remote_scraper

logger = logging.getLogger(__name__)

# Stable client ID for this machine (generates once per engine run)
_CLIENT_ID = str(uuid.uuid4())

_POLL_INTERVAL = 30          # seconds between polls
_BATCH_LIMIT   = 5           # max items to claim per poll
_CLAIM_TIMEOUT = 9 * 60      # 9 min — safely inside the server's 10-min TTL

_task: asyncio.Task[None] | None = None
_running = False
_stats: dict[str, int] = {"polled": 0, "claimed": 0, "submitted": 0, "failed": 0}


def get_stats() -> dict[str, Any]:
    return {**_stats, "running": _running, "client_id": _CLIENT_ID}


async def _scrape_locally(url: str) -> dict[str, Any] | None:
    """Try to scrape a URL using the local ScraperEngine.

    Returns a content dict suitable for save_content() / queue/submit,
    or None if scraping failed.
    """
    try:
        # Import here to avoid circular imports; engine is already running
        from app.services.scraper.engine import get_scraper_engine
        engine = get_scraper_engine()
        if not engine.is_ready:
            return None

        result = await engine.orchestrator.scrape(
            urls=[url],
            use_cache=False,
            output_mode="rich",
            get_links=True,
            get_overview=True,
        )

        if not result or not result.get("results"):
            return None

        page = result["results"][0]
        if page.get("status") != "success":
            return None

        content = page.get("content", {})
        # Normalise to the server's expected content schema
        return {
            "text_data": content.get("text_data") or content.get("text") or "",
            "ai_research_content": content.get("ai_research_content") or "",
            "overview": content.get("overview"),
            "links": content.get("links"),
        }
    except Exception as exc:
        logger.debug("RetryQueue: local scrape of %s raised: %s", url, exc)
        return None


async def _poll_once() -> None:
    """Single poll cycle: fetch → claim → scrape → submit/fail."""
    client = get_remote_scraper()
    if not client.is_configured:
        return

    try:
        resp = await client.get_pending(tier="desktop", limit=_BATCH_LIMIT)
        items: list[dict[str, Any]] = resp.get("items", [])
    except Exception as exc:
        logger.debug("RetryQueue: get_pending failed: %s", exc)
        return

    if not items:
        return

    _stats["polled"] += len(items)
    ids = [item["id"] for item in items]

    try:
        await client.claim_items(
            item_ids=ids,
            client_id=_CLIENT_ID,
            client_type="desktop",
        )
        _stats["claimed"] += len(ids)
    except Exception as exc:
        logger.warning("RetryQueue: claim_items failed: %s", exc)
        return

    for item in items:
        item_id: str = item["id"]
        url: str = item.get("target_url", "")
        if not url:
            continue

        logger.info("RetryQueue: retrying %s locally", url)
        content = await _scrape_locally(url)

        if content and (content.get("text_data") or content.get("ai_research_content")):
            char_count = len(content.get("text_data", "") + content.get("ai_research_content", ""))
            try:
                await client.submit_result(
                    queue_item_id=item_id,
                    url=url,
                    content=content,
                    content_type="html",
                    char_count=char_count,
                )
                _stats["submitted"] += 1
                logger.info("RetryQueue: submitted %s (chars=%d)", url, char_count)

                # Belt-and-suspenders: also save directly
                try:
                    await client.save_content(
                        url=url,
                        content=content,
                        content_type="html",
                        char_count=char_count,
                    )
                except Exception:
                    pass  # submit_result already stored it; this is just a backup

            except Exception as exc:
                logger.warning("RetryQueue: submit_result failed for %s: %s", url, exc)
                _stats["failed"] += 1
        else:
            reason = f"local scrape returned no content for {url}"
            logger.info("RetryQueue: local scrape failed for %s, promoting to extension", url)
            try:
                await client.report_failure(
                    queue_item_id=item_id,
                    error=reason,
                    promote_to_extension=True,
                )
                _stats["failed"] += 1
            except Exception as exc:
                logger.debug("RetryQueue: report_failure failed: %s", exc)


async def _loop() -> None:
    global _running
    _running = True
    logger.info("RetryQueue: background poller started (interval=%ds)", _POLL_INTERVAL)
    try:
        while True:
            try:
                await _poll_once()
            except Exception:
                logger.exception("RetryQueue: unexpected error in poll cycle")
            await asyncio.sleep(_POLL_INTERVAL)
    except asyncio.CancelledError:
        logger.info("RetryQueue: poller stopped")
    finally:
        _running = False


def start() -> None:
    """Start the background retry queue poller. Call once on engine startup."""
    global _task
    if _task is not None and not _task.done():
        return
    _task = asyncio.create_task(_loop(), name="retry-queue-poller")


def stop() -> None:
    """Cancel the background poller. Call on engine shutdown."""
    global _task
    if _task and not _task.done():
        _task.cancel()
        _task = None
