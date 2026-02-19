"""Initial schema — 7 tables for scraper service.

Revision ID: 001
Revises:
Create Date: 2026-02-18
"""

from alembic import op

revision = "001"
down_revision = None
branch_labels = None
depends_on = None

UPGRADE_SQL = """
-- ============================================================
-- Domain Configuration Tables
-- ============================================================

CREATE TABLE scrape_domain (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url         TEXT NOT NULL UNIQUE,
    common_name TEXT,
    scrape_allowed BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE scrape_domain_settings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_id   UUID NOT NULL REFERENCES scrape_domain(id) ON DELETE CASCADE,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    proxy_type  TEXT NOT NULL DEFAULT 'datacenter'
                CHECK (proxy_type IN ('datacenter', 'residential', 'none')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (domain_id)
);

CREATE TABLE scrape_path_pattern (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_id   UUID NOT NULL REFERENCES scrape_domain(id) ON DELETE CASCADE,
    pattern     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (domain_id, pattern)
);

CREATE TABLE scrape_path_override (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    path_pattern_id UUID NOT NULL REFERENCES scrape_path_pattern(id) ON DELETE CASCADE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    config_type     TEXT NOT NULL CHECK (config_type IN ('content_filter', 'main_content')),
    selector_type   TEXT NOT NULL,
    match_type      TEXT NOT NULL CHECK (match_type IN ('exact', 'partial', 'regex')),
    action          TEXT NOT NULL CHECK (action IN ('add', 'remove', 'replace_all_with')),
    values          JSONB NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE scrape_base_config (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    selector_type   TEXT NOT NULL,
    exact           JSONB NOT NULL DEFAULT '[]',
    partial         JSONB NOT NULL DEFAULT '[]',
    regex           JSONB NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Parsed Pages (Cache)
-- ============================================================

CREATE TABLE scrape_parsed_page (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_name       TEXT NOT NULL,
    url             TEXT NOT NULL,
    domain          TEXT NOT NULL,
    scraped_at      TIMESTAMPTZ NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    validity        TEXT NOT NULL DEFAULT 'active'
                    CHECK (validity IN ('active', 'stale', 'invalid')),
    content         JSONB NOT NULL,
    char_count      INTEGER,
    content_type    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_parsed_page_name_active
    ON scrape_parsed_page(page_name)
    WHERE validity = 'active';

CREATE INDEX idx_parsed_page_domain ON scrape_parsed_page(domain);
CREATE INDEX idx_parsed_page_expires ON scrape_parsed_page(expires_at);

-- ============================================================
-- Failure Log
-- ============================================================

CREATE TABLE scrape_failure_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_url      TEXT NOT NULL,
    domain_name     TEXT NOT NULL,
    failure_reason  TEXT NOT NULL,
    failure_category TEXT,
    status_code     INTEGER,
    error_log       TEXT,
    proxy_used      BOOLEAN NOT NULL DEFAULT FALSE,
    proxy_type      TEXT,
    attempt_count   INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_failure_log_domain ON scrape_failure_log(domain_name);
CREATE INDEX idx_failure_log_created ON scrape_failure_log(created_at DESC);
CREATE INDEX idx_failure_log_category ON scrape_failure_log(failure_category);

-- ============================================================
-- Indexes on domain config
-- ============================================================

CREATE INDEX idx_scrape_domain_url ON scrape_domain(url);
CREATE INDEX idx_path_pattern_domain ON scrape_path_pattern(domain_id);
CREATE INDEX idx_path_override_pattern ON scrape_path_override(path_pattern_id);
"""

DOWNGRADE_SQL = """
DROP TABLE IF EXISTS scrape_path_override CASCADE;
DROP TABLE IF EXISTS scrape_path_pattern CASCADE;
DROP TABLE IF EXISTS scrape_domain_settings CASCADE;
DROP TABLE IF EXISTS scrape_base_config CASCADE;
DROP TABLE IF EXISTS scrape_failure_log CASCADE;
DROP TABLE IF EXISTS scrape_parsed_page CASCADE;
DROP TABLE IF EXISTS scrape_domain CASCADE;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
