from __future__ import annotations

import asyncio
import logging
from typing import Optional

import asyncpg

from app.db.queries.domain_config import load_all_domains, load_base_config
from app.models.domain import BaseConfigRule, DomainConfig
from app.models.enums import ProxyType
from app.utils.url import extract_domain, match_path

logger = logging.getLogger(__name__)

REFRESH_INTERVAL_SECONDS = 300


class DomainConfigStore:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool
        self._domains: dict[str, DomainConfig] = {}
        self._base_config: list[BaseConfigRule] = []
        self._refresh_task: Optional[asyncio.Task[None]] = None

    async def start(self) -> None:
        await self._refresh()
        self._refresh_task = asyncio.create_task(self._periodic_refresh())
        logger.info("DomainConfigStore started (%d domains, %d base config rules)",
                     len(self._domains), len(self._base_config))

    async def stop(self) -> None:
        if self._refresh_task and not self._refresh_task.done():
            self._refresh_task.cancel()
            try:
                await self._refresh_task
            except asyncio.CancelledError:
                pass
        logger.info("DomainConfigStore stopped")

    async def _refresh(self) -> None:
        try:
            domains = await load_all_domains(self._pool)
            base_config = await load_base_config(self._pool)

            self._domains = {d.url: d for d in domains}
            self._base_config = base_config
            logger.debug("DomainConfigStore refreshed: %d domains, %d rules",
                         len(self._domains), len(self._base_config))
        except Exception:
            logger.exception("Failed to refresh DomainConfigStore")

    async def _periodic_refresh(self) -> None:
        while True:
            await asyncio.sleep(REFRESH_INTERVAL_SECONDS)
            await self._refresh()

    def get_domain(self, url: str) -> Optional[DomainConfig]:
        domain_name = extract_domain(url)
        return self._domains.get(domain_name)

    def is_scrape_allowed(self, url: str) -> bool:
        config = self.get_domain(url)
        if config is None:
            return True
        return config.scrape_allowed

    def get_proxy_type(self, url: str) -> ProxyType:
        config = self.get_domain(url)
        if config is None or config.settings is None:
            return ProxyType.DATACENTER
        return config.settings.proxy_type

    def get_overrides_for_path(self, url: str, path: str) -> dict[str, list[dict[str, object]]]:
        config = self.get_domain(url)
        if config is None or not config.path_patterns:
            return {}

        patterns = [pp.pattern for pp in config.path_patterns]
        matched = match_path(path, patterns)
        if matched is None:
            return {}

        for pp in config.path_patterns:
            if pp.pattern == matched:
                result: dict[str, list[dict[str, object]]] = {
                    "content_filter": [],
                    "main_content": [],
                }
                for override in pp.overrides:
                    if not override.is_active:
                        continue
                    result[override.config_type].append({
                        "selector_type": override.selector_type,
                        "match_type": override.match_type,
                        "action": override.action,
                        "values": override.values,
                    })
                return result
        return {}

    @property
    def base_config(self) -> list[BaseConfigRule]:
        return self._base_config

    @property
    def all_domains(self) -> list[DomainConfig]:
        return list(self._domains.values())
