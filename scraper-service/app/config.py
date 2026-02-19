from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

_env_file = Path(__file__).resolve().parent.parent / ".env"
if _env_file.exists():
    load_dotenv(_env_file, override=True)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # API
    API_KEY: str
    HOST: str = "0.0.0.0"
    PORT: int = 8001

    # Database
    DATABASE_URL: str

    # Proxies (comma-separated)
    DATACENTER_PROXIES: str = ""
    RESIDENTIAL_PROXIES: str = ""

    # Brave Search
    BRAVE_API_KEY: str = ""
    BRAVE_API_KEY_AI: str = ""

    # Playwright
    PLAYWRIGHT_POOL_SIZE: int = 3

    # Cache
    PAGE_CACHE_TTL_SECONDS: int = 1800
    PAGE_CACHE_MAX_SIZE: int = 1000
    DEFAULT_SCRAPE_TTL_DAYS: int = 30

    # Concurrency
    MAX_SCRAPE_CONCURRENCY: int = 20
    MAX_RESEARCH_CONCURRENCY: int = 30

    @property
    def datacenter_proxy_list(self) -> list[str]:
        return [p.strip() for p in self.DATACENTER_PROXIES.split(",") if p.strip()]

    @property
    def residential_proxy_list(self) -> list[str]:
        return [p.strip() for p in self.RESIDENTIAL_PROXIES.split(",") if p.strip()]


def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
