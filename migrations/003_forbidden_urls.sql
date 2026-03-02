-- Migration 003: Per-user forbidden URL list
--
-- Stores URL patterns that are blocked from scraping for each user.
-- Patterns are stored as normalized bare domains/paths (no scheme, no trailing slash).
-- Wildcard prefix patterns are supported: *.example.com blocks all subdomains.
--
-- Run in Supabase SQL Editor before enabling cloud sync for forbidden URLs.

CREATE TABLE IF NOT EXISTS forbidden_urls (
    id          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    pattern     text            NOT NULL,
    created_at  timestamptz     NOT NULL DEFAULT now(),
    UNIQUE (user_id, pattern)
);

-- RLS: users can only see and manage their own entries
ALTER TABLE forbidden_urls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "forbidden_urls: select own"
    ON forbidden_urls FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "forbidden_urls: insert own"
    ON forbidden_urls FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "forbidden_urls: delete own"
    ON forbidden_urls FOR DELETE
    USING (auth.uid() = user_id);

-- Index for fast per-user lookups
CREATE INDEX IF NOT EXISTS forbidden_urls_user_id_idx ON forbidden_urls(user_id);
