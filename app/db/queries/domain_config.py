from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import asyncpg

from app.models.domain import (
    BaseConfigRule,
    DomainConfig,
    DomainSettings,
    OverrideRule,
    PathPatternConfig,
)
from app.models.enums import ProxyType


async def load_all_domains(pool: asyncpg.Pool) -> list[DomainConfig]:
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT d.id, d.url, d.common_name, d.scrape_allowed,
                   ds.id AS settings_id, ds.enabled, ds.proxy_type
            FROM scrape_domain d
            LEFT JOIN scrape_domain_settings ds ON ds.domain_id = d.id
            ORDER BY d.url
        """)

    domains: dict[UUID, DomainConfig] = {}
    for row in rows:
        domain_id = row["id"]
        settings = None
        if row["settings_id"]:
            settings = DomainSettings(
                id=row["settings_id"],
                domain_id=domain_id,
                enabled=row["enabled"],
                proxy_type=ProxyType(row["proxy_type"]),
            )
        domains[domain_id] = DomainConfig(
            id=domain_id,
            url=row["url"],
            common_name=row["common_name"],
            scrape_allowed=row["scrape_allowed"],
            settings=settings,
        )

    if not domains:
        return []

    async with pool.acquire() as conn:
        pp_rows = await conn.fetch("""
            SELECT id, domain_id, pattern
            FROM scrape_path_pattern
            WHERE domain_id = ANY($1::uuid[])
            ORDER BY domain_id, pattern
        """, list(domains.keys()))

    patterns: dict[UUID, PathPatternConfig] = {}
    for row in pp_rows:
        pp = PathPatternConfig(
            id=row["id"],
            domain_id=row["domain_id"],
            pattern=row["pattern"],
        )
        patterns[pp.id] = pp
        domains[row["domain_id"]].path_patterns.append(pp)

    if patterns:
        async with pool.acquire() as conn:
            override_rows = await conn.fetch("""
                SELECT id, path_pattern_id, is_active, config_type,
                       selector_type, match_type, action, values
                FROM scrape_path_override
                WHERE path_pattern_id = ANY($1::uuid[])
                ORDER BY path_pattern_id
            """, list(patterns.keys()))

        for row in override_rows:
            values_raw = row["values"]
            if isinstance(values_raw, str):
                values_raw = json.loads(values_raw)
            override = OverrideRule(
                id=row["id"],
                path_pattern_id=row["path_pattern_id"],
                is_active=row["is_active"],
                config_type=row["config_type"],
                selector_type=row["selector_type"],
                match_type=row["match_type"],
                action=row["action"],
                values=values_raw,
            )
            if row["path_pattern_id"] in patterns:
                patterns[row["path_pattern_id"]].overrides.append(override)

    return list(domains.values())


async def load_base_config(pool: asyncpg.Pool) -> list[BaseConfigRule]:
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT id, selector_type, exact, partial, regex FROM scrape_base_config")

    rules: list[BaseConfigRule] = []
    for row in rows:
        def _parse_list(val: Any) -> list[str]:
            if isinstance(val, str):
                return json.loads(val)
            if isinstance(val, list):
                return val
            return []

        rules.append(BaseConfigRule(
            id=row["id"],
            selector_type=row["selector_type"],
            exact=_parse_list(row["exact"]),
            partial=_parse_list(row["partial"]),
            regex=_parse_list(row["regex"]),
        ))
    return rules


async def upsert_domain(
    pool: asyncpg.Pool,
    url: str,
    common_name: str | None,
    scrape_allowed: bool,
    enabled: bool,
    proxy_type: str,
) -> DomainConfig:
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow("""
                INSERT INTO scrape_domain (url, common_name, scrape_allowed)
                VALUES ($1, $2, $3)
                ON CONFLICT (url) DO UPDATE SET
                    common_name = EXCLUDED.common_name,
                    scrape_allowed = EXCLUDED.scrape_allowed,
                    updated_at = NOW()
                RETURNING id, url, common_name, scrape_allowed
            """, url, common_name, scrape_allowed)

            domain_id = row["id"]

            settings_row = await conn.fetchrow("""
                INSERT INTO scrape_domain_settings (domain_id, enabled, proxy_type)
                VALUES ($1, $2, $3)
                ON CONFLICT (domain_id) DO UPDATE SET
                    enabled = EXCLUDED.enabled,
                    proxy_type = EXCLUDED.proxy_type,
                    updated_at = NOW()
                RETURNING id, domain_id, enabled, proxy_type
            """, domain_id, enabled, proxy_type)

    settings = DomainSettings(
        id=settings_row["id"],
        domain_id=domain_id,
        enabled=settings_row["enabled"],
        proxy_type=ProxyType(settings_row["proxy_type"]),
    )

    return DomainConfig(
        id=domain_id,
        url=row["url"],
        common_name=row["common_name"],
        scrape_allowed=row["scrape_allowed"],
        settings=settings,
    )
