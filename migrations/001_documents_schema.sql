-- ============================================================================
-- Matrx Local: Documents & Notes Sync Schema Migration
-- ============================================================================
-- This migration extends the existing notes system to support:
--   1. Hierarchical folder structure
--   2. Multi-device sync with conflict detection
--   3. Granular sharing and collaboration permissions
--   4. Per-device directory mappings
--   5. Sync audit logging
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. note_folders — Hierarchical folder tree
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.note_folders (
    id          uuid        NOT NULL DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL,
    name        text        NOT NULL,
    parent_id   uuid,
    path        text        NOT NULL DEFAULT '',
    position    integer     DEFAULT 0,
    is_deleted  boolean     DEFAULT false,
    created_at  timestamptz DEFAULT now(),
    updated_at  timestamptz DEFAULT now(),

    CONSTRAINT note_folders_pkey PRIMARY KEY (id),
    CONSTRAINT note_folders_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT note_folders_parent_id_fkey
        FOREIGN KEY (parent_id) REFERENCES public.note_folders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_folders_user_id ON public.note_folders(user_id);
CREATE INDEX IF NOT EXISTS idx_note_folders_parent_id ON public.note_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_note_folders_path ON public.note_folders(user_id, path);

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Extend public.notes — Add sync and file-path columns
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.notes
    ADD COLUMN IF NOT EXISTS folder_id       uuid REFERENCES public.note_folders(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS file_path       text,
    ADD COLUMN IF NOT EXISTS content_hash    text,
    ADD COLUMN IF NOT EXISTS sync_version    bigint DEFAULT 1,
    ADD COLUMN IF NOT EXISTS last_device_id  text;

CREATE INDEX IF NOT EXISTS idx_notes_folder_id ON public.notes(folder_id);
CREATE INDEX IF NOT EXISTS idx_notes_file_path ON public.notes(user_id, file_path);
CREATE INDEX IF NOT EXISTS idx_notes_sync_version ON public.notes(user_id, sync_version);
CREATE INDEX IF NOT EXISTS idx_notes_content_hash ON public.notes(content_hash);

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. note_shares — Normalized sharing and collaboration permissions
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.note_shares (
    id              uuid        NOT NULL DEFAULT gen_random_uuid(),
    note_id         uuid,
    folder_id       uuid,
    owner_id        uuid        NOT NULL,
    shared_with_id  uuid,
    permission      text        NOT NULL DEFAULT 'read',
    is_public       boolean     DEFAULT false,
    public_token    text        UNIQUE,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now(),

    CONSTRAINT note_shares_pkey PRIMARY KEY (id),
    CONSTRAINT note_shares_note_id_fkey
        FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE,
    CONSTRAINT note_shares_folder_id_fkey
        FOREIGN KEY (folder_id) REFERENCES public.note_folders(id) ON DELETE CASCADE,
    CONSTRAINT note_shares_owner_id_fkey
        FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT note_shares_shared_with_id_fkey
        FOREIGN KEY (shared_with_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT note_shares_target_check
        CHECK (note_id IS NOT NULL OR folder_id IS NOT NULL),
    CONSTRAINT note_shares_permission_check
        CHECK (permission IN ('read', 'edit', 'comment', 'admin'))
);

CREATE INDEX IF NOT EXISTS idx_note_shares_owner ON public.note_shares(owner_id);
CREATE INDEX IF NOT EXISTS idx_note_shares_shared_with ON public.note_shares(shared_with_id);
CREATE INDEX IF NOT EXISTS idx_note_shares_note ON public.note_shares(note_id);
CREATE INDEX IF NOT EXISTS idx_note_shares_folder ON public.note_shares(folder_id);
CREATE INDEX IF NOT EXISTS idx_note_shares_public_token ON public.note_shares(public_token)
    WHERE public_token IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. note_devices — Track registered devices per user
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.note_devices (
    id          uuid        NOT NULL DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL,
    device_name text        NOT NULL,
    device_id   text        NOT NULL,
    platform    text,
    base_path   text,
    last_seen   timestamptz DEFAULT now(),
    is_active   boolean     DEFAULT true,
    created_at  timestamptz DEFAULT now(),

    CONSTRAINT note_devices_pkey PRIMARY KEY (id),
    CONSTRAINT note_devices_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT note_devices_unique_device
        UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_note_devices_user ON public.note_devices(user_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. note_directory_mappings — Per-device folder-to-local-path mappings
--    Example: "React Best Practices" folder → /home/user/repos/myapp/docs
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.note_directory_mappings (
    id          uuid        NOT NULL DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL,
    device_id   text        NOT NULL,
    folder_id   uuid        NOT NULL,
    local_path  text        NOT NULL,
    is_active   boolean     DEFAULT true,
    created_at  timestamptz DEFAULT now(),
    updated_at  timestamptz DEFAULT now(),

    CONSTRAINT note_directory_mappings_pkey PRIMARY KEY (id),
    CONSTRAINT note_directory_mappings_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT note_directory_mappings_folder_id_fkey
        FOREIGN KEY (folder_id) REFERENCES public.note_folders(id) ON DELETE CASCADE,
    CONSTRAINT note_directory_mappings_unique_mapping
        UNIQUE (user_id, device_id, folder_id, local_path)
);

CREATE INDEX IF NOT EXISTS idx_note_dir_mappings_user_device
    ON public.note_directory_mappings(user_id, device_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. note_sync_log — Audit trail for sync operations
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.note_sync_log (
    id              uuid        NOT NULL DEFAULT gen_random_uuid(),
    note_id         uuid,
    folder_id       uuid,
    user_id         uuid        NOT NULL,
    device_id       text        NOT NULL,
    action          text        NOT NULL,
    sync_version    bigint,
    content_hash    text,
    details         jsonb       DEFAULT '{}',
    created_at      timestamptz DEFAULT now(),

    CONSTRAINT note_sync_log_pkey PRIMARY KEY (id),
    CONSTRAINT note_sync_log_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT note_sync_log_action_check
        CHECK (action IN (
            'create', 'update', 'delete', 'conflict_detected',
            'conflict_resolved', 'pull', 'push', 'full_sync'
        ))
);

CREATE INDEX IF NOT EXISTS idx_note_sync_log_note ON public.note_sync_log(note_id);
CREATE INDEX IF NOT EXISTS idx_note_sync_log_user_device
    ON public.note_sync_log(user_id, device_id);
CREATE INDEX IF NOT EXISTS idx_note_sync_log_created
    ON public.note_sync_log(created_at DESC);

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. Auto-update updated_at triggers
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_notes_updated_at'
    ) THEN
        CREATE TRIGGER trigger_notes_updated_at
            BEFORE UPDATE ON public.notes
            FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_note_folders_updated_at'
    ) THEN
        CREATE TRIGGER trigger_note_folders_updated_at
            BEFORE UPDATE ON public.note_folders
            FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_note_shares_updated_at'
    ) THEN
        CREATE TRIGGER trigger_note_shares_updated_at
            BEFORE UPDATE ON public.note_shares
            FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
    END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. Auto-increment sync_version on notes update
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_sync_version()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.content IS DISTINCT FROM OLD.content
       OR NEW.label IS DISTINCT FROM OLD.label THEN
        NEW.sync_version = COALESCE(OLD.sync_version, 0) + 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_notes_sync_version'
    ) THEN
        CREATE TRIGGER trigger_notes_sync_version
            BEFORE UPDATE ON public.notes
            FOR EACH ROW EXECUTE FUNCTION public.increment_sync_version();
    END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. Row Level Security policies
-- ──────────────────────────────────────────────────────────────────────────────

-- Enable RLS on new tables
ALTER TABLE public.note_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_directory_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_sync_log ENABLE ROW LEVEL SECURITY;

-- note_folders: users see their own + shared
CREATE POLICY note_folders_owner ON public.note_folders
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY note_folders_shared ON public.note_folders
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.note_shares
            WHERE note_shares.folder_id = note_folders.id
              AND (note_shares.shared_with_id = auth.uid() OR note_shares.is_public = true)
        )
    );

-- note_shares: owners manage, recipients read
CREATE POLICY note_shares_owner ON public.note_shares
    FOR ALL USING (auth.uid() = owner_id);

CREATE POLICY note_shares_recipient ON public.note_shares
    FOR SELECT USING (auth.uid() = shared_with_id);

-- note_devices: users see their own
CREATE POLICY note_devices_owner ON public.note_devices
    FOR ALL USING (auth.uid() = user_id);

-- note_directory_mappings: users see their own
CREATE POLICY note_dir_mappings_owner ON public.note_directory_mappings
    FOR ALL USING (auth.uid() = user_id);

-- note_sync_log: users see their own
CREATE POLICY note_sync_log_owner ON public.note_sync_log
    FOR ALL USING (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- 10. Enable Supabase Realtime on notes and note_folders
-- ──────────────────────────────────────────────────────────────────────────────
-- Run in Supabase Dashboard > SQL Editor:
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.notes;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.note_folders;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.note_shares;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
