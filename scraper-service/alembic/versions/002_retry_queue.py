"""Add scrape_retry_queue table for multi-client retry pipeline.

Revision ID: 002
Revises: 001
Create Date: 2026-02-22
"""

from alembic import op

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None

UPGRADE_SQL = """
CREATE TABLE IF NOT EXISTS scrape_retry_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    target_url TEXT NOT NULL,
    domain_name TEXT NOT NULL,

    failure_log_id UUID REFERENCES scrape_failure_log(id) ON DELETE SET NULL,
    failure_reason TEXT NOT NULL,
    original_failure_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    request_context JSONB NOT NULL DEFAULT '{}'::jsonb,

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'claimed', 'completed', 'failed', 'expired')),
    tier TEXT NOT NULL DEFAULT 'desktop'
        CHECK (tier IN ('desktop', 'extension')),

    claimed_by TEXT,
    claimed_at TIMESTAMPTZ,
    claim_expires_at TIMESTAMPTZ,

    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retry_queue_status_tier ON scrape_retry_queue(status, tier);
CREATE INDEX IF NOT EXISTS idx_retry_queue_domain ON scrape_retry_queue(domain_name);
CREATE INDEX IF NOT EXISTS idx_retry_queue_claim_expires ON scrape_retry_queue(claim_expires_at)
    WHERE status = 'claimed';
CREATE INDEX IF NOT EXISTS idx_retry_queue_url ON scrape_retry_queue(target_url, status);
"""

DOWNGRADE_SQL = """
DROP TABLE IF EXISTS scrape_retry_queue CASCADE;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
