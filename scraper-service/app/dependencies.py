from __future__ import annotations

from typing import TYPE_CHECKING

import asyncpg
from fastapi import Request

from app.config import Settings

if TYPE_CHECKING:
    from app.domain_config.config_store import DomainConfigStore


def get_db_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.db_pool


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_domain_config_store(request: Request) -> DomainConfigStore:
    return request.app.state.domain_config_store
