"""ScraperEngine — bridge between matrx_local and the scraper-service package.

The scraper-service uses `app.*` imports internally, which collide with
matrx_local's own `app/` package.  We solve this by temporarily swapping
sys.modules and sys.path during import so the scraper-service's `app`
package loads under `scraper_app.*` in the module registry.

Lifecycle:
    engine = ScraperEngine()
    await engine.start()     # called once during app lifespan
    ...
    await engine.stop()      # called on shutdown
"""

from __future__ import annotations

import importlib
import logging
import os
import sys
from pathlib import Path
from types import ModuleType
from typing import Any, Optional

logger = logging.getLogger(__name__)

SCRAPER_SERVICE_ROOT = Path(__file__).resolve().parent.parent.parent.parent / "scraper-service"

_scraper_modules: dict[str, Any] = {}
_bootstrap_done = False


def _bootstrap_scraper_package() -> None:
    """One-time setup: register scraper-service/app as 'scraper_app' in sys.modules.

    This lets all internal `from app.xxx import yyy` inside the scraper-service
    resolve correctly by aliasing every `app.*` sub-module to `scraper_app.*`.
    """
    global _bootstrap_done
    if _bootstrap_done:
        return

    scraper_root = str(SCRAPER_SERVICE_ROOT)

    matrx_app = sys.modules.get("app")
    matrx_app_children = {
        k: v for k, v in sys.modules.items()
        if k == "app" or k.startswith("app.")
    }

    for k in matrx_app_children:
        del sys.modules[k]

    sys.path.insert(0, scraper_root)
    try:
        scraper_app = importlib.import_module("app")

        snapshot: dict[str, ModuleType] = {}
        for k, v in list(sys.modules.items()):
            if k == "app" or k.startswith("app."):
                snapshot[k] = v

        for k, v in snapshot.items():
            alias = "scraper_app" + k[3:]  # "app.foo" → "scraper_app.foo"
            sys.modules[alias] = v

        sys.modules["scraper_app"] = scraper_app
    finally:
        sys.path.remove(scraper_root)

        for k in list(sys.modules.keys()):
            if k == "app" or k.startswith("app."):
                if k not in matrx_app_children:
                    del sys.modules[k]

        sys.modules.update(matrx_app_children)

    _bootstrap_done = True


def _import_scraper(module_path: str) -> Any:
    """Import a module from the scraper-service package.

    Translates `app.foo.bar` → `scraper_app.foo.bar` and loads it
    with proper sys.path/sys.modules isolation.
    """
    aliased = "scraper_app" + module_path[3:] if module_path.startswith("app.") else module_path

    if aliased in _scraper_modules:
        return _scraper_modules[aliased]

    _bootstrap_scraper_package()

    if aliased in sys.modules:
        _scraper_modules[aliased] = sys.modules[aliased]
        return sys.modules[aliased]

    scraper_root = str(SCRAPER_SERVICE_ROOT)

    matrx_app_children = {
        k: v for k, v in sys.modules.items()
        if k == "app" or k.startswith("app.")
    }

    scraper_app_children = {
        k: v for k, v in sys.modules.items()
        if k == "scraper_app" or k.startswith("scraper_app.")
    }
    for k, v in scraper_app_children.items():
        original = "app" + k[11:]  # "scraper_app.foo" → "app.foo"
        sys.modules[original] = v
    for k in matrx_app_children:
        if k not in {("app" + sk[11:]) for sk in scraper_app_children}:
            if k in sys.modules:
                del sys.modules[k]

    sys.path.insert(0, scraper_root)
    try:
        original_path = "app" + module_path[3:] if module_path.startswith("app.") else module_path
        mod = importlib.import_module(original_path)

        for k, v in list(sys.modules.items()):
            if k == "app" or k.startswith("app."):
                alias = "scraper_app" + k[3:]
                sys.modules[alias] = v
    finally:
        sys.path.remove(scraper_root)

        for k in list(sys.modules.keys()):
            if k == "app" or k.startswith("app."):
                if k not in matrx_app_children:
                    del sys.modules[k]
        sys.modules.update(matrx_app_children)

    _scraper_modules[aliased] = mod
    return mod


class ScraperEngine:
    """Manages the scraper-service orchestrator and its dependencies.

    Designed to degrade gracefully: if DATABASE_URL is missing or the DB
    is unreachable, the engine still starts with in-memory-only caching
    (no persistent page cache or domain config, but scraping works).
    """

    def __init__(self) -> None:
        self._orchestrator: Any = None
        self._fetcher: Any = None
        self._browser_pool: Any = None
        self._db_pool: Any = None
        self._page_cache: Any = None
        self._domain_config_store: Any = None
        self._search_client: Any = None
        self._settings: Any = None
        self._started = False

    @property
    def is_ready(self) -> bool:
        return self._started and self._orchestrator is not None

    @property
    def orchestrator(self) -> Any:
        return self._orchestrator

    @property
    def search_client(self) -> Any:
        return self._search_client

    @property
    def has_database(self) -> bool:
        return self._db_pool is not None

    async def start(self) -> None:
        """Initialize scraper-service components.

        Order: settings → DB pool (optional) → browser pool → fetcher →
               domain config → page cache → search client → orchestrator.
        """
        if self._started:
            return

        logger.info("ScraperEngine: starting")

        config_mod = _import_scraper("app.config")
        settings_cls = config_mod.Settings

        env_overrides: dict[str, str] = {}
        if not os.environ.get("API_KEY"):
            env_overrides["API_KEY"] = "local-scraper"
        if not os.environ.get("DATABASE_URL"):
            env_overrides["DATABASE_URL"] = ""

        for k, v in env_overrides.items():
            os.environ.setdefault(k, v)

        try:
            self._settings = settings_cls()  # type: ignore[call-arg]
        except Exception:
            logger.exception("ScraperEngine: failed to load settings")
            return

        db_pool = None
        if self._settings.DATABASE_URL:
            try:
                conn_mod = _import_scraper("app.db.connection")
                db_pool = await conn_mod.create_pool(self._settings.DATABASE_URL, min_size=1, max_size=5)
                logger.info("ScraperEngine: database connected")
            except Exception:
                logger.warning("ScraperEngine: database unavailable — running without persistent cache")
                db_pool = None
        else:
            logger.info("ScraperEngine: no DATABASE_URL — running without persistent cache")
        self._db_pool = db_pool

        browser_pool_mod = _import_scraper("app.core.fetcher.browser_pool")
        browser_pool = browser_pool_mod.PlaywrightBrowserPool(
            pool_size=self._settings.PLAYWRIGHT_POOL_SIZE,
        )
        try:
            await browser_pool.start()
            self._browser_pool = browser_pool
            logger.info("ScraperEngine: browser pool started (size=%d)", self._settings.PLAYWRIGHT_POOL_SIZE)
        except Exception:
            logger.warning("ScraperEngine: Playwright unavailable — browser fetching disabled")
            self._browser_pool = None

        fetcher_mod = _import_scraper("app.core.fetcher.fetcher")
        self._fetcher = fetcher_mod.UnifiedFetcher(
            settings=self._settings,
            browser_pool=self._browser_pool,
        )

        domain_config_mod = _import_scraper("app.domain_config.config_store")
        if db_pool:
            self._domain_config_store = domain_config_mod.DomainConfigStore(db_pool)
            try:
                await self._domain_config_store.start()
                logger.info("ScraperEngine: domain config loaded")
            except Exception:
                logger.warning("ScraperEngine: domain config failed to load — using defaults")
                self._domain_config_store = domain_config_mod.DomainConfigStore.__new__(
                    domain_config_mod.DomainConfigStore
                )
                self._domain_config_store._pool = None
                self._domain_config_store._domains = {}
                self._domain_config_store._base_config = []
                self._domain_config_store._refresh_task = None
        else:
            self._domain_config_store = domain_config_mod.DomainConfigStore.__new__(
                domain_config_mod.DomainConfigStore
            )
            self._domain_config_store._pool = None
            self._domain_config_store._domains = {}
            self._domain_config_store._base_config = []
            self._domain_config_store._refresh_task = None

        if db_pool:
            cache_mod = _import_scraper("app.cache.page_cache")
            self._page_cache = cache_mod.PageCache(
                pool=db_pool,
                max_size=self._settings.PAGE_CACHE_MAX_SIZE,
                ttl_seconds=self._settings.PAGE_CACHE_TTL_SECONDS,
            )
        else:
            self._page_cache = _MemoryOnlyPageCache(
                max_size=self._settings.PAGE_CACHE_MAX_SIZE,
                ttl_seconds=self._settings.PAGE_CACHE_TTL_SECONDS,
            )

        search_mod = _import_scraper("app.core.search")
        if self._settings.BRAVE_API_KEY:
            self._search_client = search_mod.BraveSearchClient(self._settings)
            logger.info("ScraperEngine: Brave Search configured")
        else:
            logger.info("ScraperEngine: no BRAVE_API_KEY — search disabled")

        orchestrator_mod = _import_scraper("app.core.orchestrator")
        self._orchestrator = orchestrator_mod.ScrapeOrchestrator(
            fetcher=self._fetcher,
            settings=self._settings,
            db_pool=db_pool or _NullPool(),
            page_cache=self._page_cache,
            domain_config_store=self._domain_config_store,
            search_client=self._search_client,
        )

        self._started = True
        logger.info("ScraperEngine: ready (db=%s, browser=%s, search=%s)",
                     db_pool is not None,
                     self._browser_pool is not None,
                     self._search_client is not None)

    async def stop(self) -> None:
        if not self._started:
            return

        logger.info("ScraperEngine: stopping")

        if self._domain_config_store and hasattr(self._domain_config_store, '_pool') and self._domain_config_store._pool:
            try:
                await self._domain_config_store.stop()
            except Exception:
                logger.exception("ScraperEngine: error stopping domain config store")

        if self._browser_pool:
            try:
                await self._browser_pool.stop()
            except Exception:
                logger.exception("ScraperEngine: error stopping browser pool")

        if self._db_pool:
            try:
                conn_mod = _import_scraper("app.db.connection")
                await conn_mod.close_pool(self._db_pool)
            except Exception:
                logger.exception("ScraperEngine: error closing database pool")

        self._started = False
        logger.info("ScraperEngine: stopped")


class _MemoryOnlyPageCache:
    """Drop-in replacement for PageCache when no database is available.

    Uses only the in-memory TTLCache — no persistence.
    """

    def __init__(self, max_size: int = 1000, ttl_seconds: int = 1800) -> None:
        from cachetools import TTLCache

        self._memory: TTLCache[str, dict[str, Any]] = TTLCache(maxsize=max_size, ttl=ttl_seconds)

    async def get(self, page_name: str) -> Optional[dict[str, Any]]:
        return self._memory.get(page_name)

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
        from datetime import datetime, timezone

        self._memory[page_name] = {
            "content": content,
            "url": url,
            "domain": domain,
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "content_type": content_type,
            "char_count": char_count,
        }

    async def invalidate(self, page_name: str) -> None:
        self._memory.pop(page_name, None)


class _NullPool:
    """Stub that satisfies the asyncpg.Pool type hint when no DB is available.

    Any actual DB operation will fail with a clear message.
    """

    async def acquire(self) -> None:
        raise RuntimeError("No database connection — scraper running in memory-only mode")

    async def close(self) -> None:
        pass


_engine: Optional[ScraperEngine] = None


def get_scraper_engine() -> ScraperEngine:
    """Get the singleton ScraperEngine instance."""
    global _engine
    if _engine is None:
        _engine = ScraperEngine()
    return _engine
