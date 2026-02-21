-- ============================================================================
-- Matrx Local: App Instances, Settings & Cloud Sync Schema
-- ============================================================================
-- This migration creates the tables needed for:
--   1. Multi-instance app management per user
--   2. Cloud-synced settings (all settings stored per instance)
--   3. System identification per instance
--   4. Proxy configuration per instance
--   5. Sync status tracking
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. app_instances — One row per installed app instance per user
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_instances (
    id              uuid        NOT NULL DEFAULT gen_random_uuid(),
    user_id         uuid        NOT NULL,
    instance_id     text        NOT NULL,  -- locally-generated unique ID
    instance_name   text        NOT NULL DEFAULT 'My Computer',
    platform        text,       -- darwin, win32, linux
    os_version      text,       -- e.g. "macOS 14.3" or "Windows 11 23H2"
    architecture    text,       -- x86_64, arm64, etc.
    hostname        text,
    username        text,
    python_version  text,
    home_dir        text,
    cpu_model       text,
    cpu_cores       integer,
    ram_total_gb    numeric(6,2),
    is_active       boolean     DEFAULT true,
    last_seen       timestamptz DEFAULT now(),
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now(),

    CONSTRAINT app_instances_pkey PRIMARY KEY (id),
    CONSTRAINT app_instances_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT app_instances_unique_instance
        UNIQUE (user_id, instance_id)
);

CREATE INDEX IF NOT EXISTS idx_app_instances_user_id ON public.app_instances(user_id);
CREATE INDEX IF NOT EXISTS idx_app_instances_instance_id ON public.app_instances(instance_id);
CREATE INDEX IF NOT EXISTS idx_app_instances_last_seen ON public.app_instances(last_seen DESC);

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. app_settings — Key-value settings store per instance
--    Stores ALL settings: proxy, theme, scraping, app behavior, etc.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
    id              uuid        NOT NULL DEFAULT gen_random_uuid(),
    user_id         uuid        NOT NULL,
    instance_id     text        NOT NULL,
    settings_json   jsonb       NOT NULL DEFAULT '{}',  -- all settings as a single JSON blob
    updated_at      timestamptz DEFAULT now(),

    CONSTRAINT app_settings_pkey PRIMARY KEY (id),
    CONSTRAINT app_settings_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT app_settings_unique_instance
        UNIQUE (user_id, instance_id)
);

CREATE INDEX IF NOT EXISTS idx_app_settings_user_id ON public.app_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_app_settings_instance_id ON public.app_settings(instance_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. app_sync_status — Tracks sync state per instance
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_sync_status (
    id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
    user_id             uuid        NOT NULL,
    instance_id         text        NOT NULL,
    last_sync_at        timestamptz,
    last_sync_direction text,       -- 'push', 'pull', 'full'
    last_sync_result    text,       -- 'success', 'conflict', 'error'
    sync_version        bigint      DEFAULT 1,
    error_message       text,
    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now(),

    CONSTRAINT app_sync_status_pkey PRIMARY KEY (id),
    CONSTRAINT app_sync_status_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT app_sync_status_unique_instance
        UNIQUE (user_id, instance_id)
);

CREATE INDEX IF NOT EXISTS idx_app_sync_status_user_id ON public.app_sync_status(user_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. Auto-update triggers
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_app_instances_updated_at'
    ) THEN
        CREATE TRIGGER trigger_app_instances_updated_at
            BEFORE UPDATE ON public.app_instances
            FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_app_settings_updated_at'
    ) THEN
        CREATE TRIGGER trigger_app_settings_updated_at
            BEFORE UPDATE ON public.app_settings
            FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_app_sync_status_updated_at'
    ) THEN
        CREATE TRIGGER trigger_app_sync_status_updated_at
            BEFORE UPDATE ON public.app_sync_status
            FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
    END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. Row Level Security
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.app_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_sync_status ENABLE ROW LEVEL SECURITY;

-- app_instances: users see their own
CREATE POLICY app_instances_owner ON public.app_instances
    FOR ALL USING (auth.uid() = user_id);

-- app_settings: users see their own
CREATE POLICY app_settings_owner ON public.app_settings
    FOR ALL USING (auth.uid() = user_id);

-- app_sync_status: users see their own
CREATE POLICY app_sync_status_owner ON public.app_sync_status
    FOR ALL USING (auth.uid() = user_id);

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
