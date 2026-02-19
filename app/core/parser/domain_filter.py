from __future__ import annotations

import logging
import os
import tempfile
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

LIST_REGISTRY: dict[str, dict[str, str]] = {
    "easylist": {
        "url": "https://easylist.to/easylist/easylist.txt",
        "local": "easylist-filters.txt",
    },
    "fanboy": {
        "url": "https://easylist.to/easylist/fanboy-annoyance.txt",
        "local": "fanboy-annoyance-filters.txt",
    },
}


class AdblockConfigLoader:
    _instance: AdblockConfigLoader | None = None

    def __new__(cls) -> AdblockConfigLoader:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if hasattr(self, "_initialized") and self._initialized:
            return
        self._configs: dict[str, str] = {}
        self._cache_dir = os.path.join(tempfile.gettempdir(), "scraper_service_filters")
        os.makedirs(self._cache_dir, exist_ok=True)
        self._initialized = True

    def load_config(self, list_key: str) -> str:
        if list_key in self._configs:
            return self._configs[list_key]

        if list_key not in LIST_REGISTRY:
            raise ValueError(f"List key '{list_key}' not found in registry")

        entry = LIST_REGISTRY[list_key]
        local_path = os.path.join(self._cache_dir, entry["local"])
        content = ""

        try:
            resp = httpx.get(entry["url"], timeout=10)
            if resp.status_code == 200:
                content = resp.text
                with open(local_path, "w") as f:
                    f.write(content)
                logger.debug("Fetched and saved '%s' from URL", entry["local"])
            else:
                raise Exception(f"Status {resp.status_code}")
        except Exception:
            if os.path.exists(local_path):
                with open(local_path) as f:
                    content = f.read()
                logger.debug("Loaded local copy of '%s'", entry["local"])
            else:
                logger.warning("No filter list available for '%s'", list_key)

        self._configs[list_key] = content
        return content


class DomainFilter:
    _instances: dict[frozenset[str], DomainFilter] = {}

    def __new__(cls, list_keys: str | list[str] = "easylist") -> DomainFilter:
        if isinstance(list_keys, str):
            list_keys = [list_keys]
        key_set = frozenset(list_keys)
        if key_set not in cls._instances:
            instance = super().__new__(cls)
            cls._instances[key_set] = instance
        return cls._instances[key_set]

    def __init__(self, list_keys: str | list[str] = "easylist") -> None:
        if hasattr(self, "_initialized") and self._initialized:
            return
        if isinstance(list_keys, str):
            list_keys = [list_keys]
        self.list_keys = list_keys
        self.blocked_domains: set[str] = set()
        self.loaded_count = 0
        self.skipped_count = 0
        self._initialized = True
        self._load_filters()

    def _load_filters(self) -> None:
        loader = AdblockConfigLoader()
        for list_key in self.list_keys:
            content = loader.load_config(list_key)
            for line in content.splitlines():
                self._process_rule(line.strip())
        logger.info(
            "DomainFilter for %s: loaded %d rules, skipped %d",
            ", ".join(self.list_keys), self.loaded_count, self.skipped_count,
        )

    def _process_rule(self, rule: str) -> None:
        if not rule or rule.startswith("!"):
            return
        if "##" in rule:
            return
        if rule.startswith("@@"):
            return
        if "$" in rule:
            self.skipped_count += 1
            return
        if rule.startswith("||") and "^" in rule:
            domain = rule[2:rule.find("^")]
            if not domain or "/" in domain or ":" in domain:
                self.skipped_count += 1
                return
            self.blocked_domains.add(domain)
            self.loaded_count += 1
        else:
            self.skipped_count += 1

    def should_block(self, url: str) -> bool:
        try:
            domain = urlparse(url).netloc
            if ":" in domain:
                domain = domain.split(":")[0]
            if not domain:
                return False
            if domain in self.blocked_domains:
                return True
            parts = domain.split(".")
            for i in range(1, len(parts)):
                parent = ".".join(parts[i:])
                if parent in self.blocked_domains:
                    return True
            return False
        except Exception:
            return False
