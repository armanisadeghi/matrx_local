"""SQLite schema definitions and migration scripts.

Each migration is a (version, sql) tuple.  Migrations are applied in order
and tracked in the ``_migrations`` table so they only run once.
"""

from __future__ import annotations

# ------------------------------------------------------------------
# Migration 1: Core tables
# ------------------------------------------------------------------

_V1_CORE = """
-- AI models: cached from AIDream server /api/ai-models
CREATE TABLE IF NOT EXISTS ai_models (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    common_name  TEXT NOT NULL DEFAULT '',
    provider     TEXT NOT NULL DEFAULT '',
    endpoints    TEXT NOT NULL DEFAULT '[]',
    capabilities TEXT NOT NULL DEFAULT '[]',
    context_window INTEGER,
    max_tokens   INTEGER,
    is_primary   INTEGER NOT NULL DEFAULT 0,
    is_premium   INTEGER NOT NULL DEFAULT 0,
    is_deprecated INTEGER NOT NULL DEFAULT 0,
    raw_json     TEXT NOT NULL DEFAULT '{}',
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models(provider);
CREATE INDEX IF NOT EXISTS idx_ai_models_name ON ai_models(name);

-- Agents / prompts: merged view of builtins + user prompts (backward-compat read layer)
CREATE TABLE IF NOT EXISTS agents (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    source          TEXT NOT NULL DEFAULT 'builtin',
    variable_defaults TEXT NOT NULL DEFAULT '[]',
    settings        TEXT NOT NULL DEFAULT '{}',
    is_active       INTEGER NOT NULL DEFAULT 1,
    raw_json        TEXT NOT NULL DEFAULT '{}',
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agents_source ON agents(source);

-- Conversations: migrated from localStorage
CREATE TABLE IF NOT EXISTS conversations (
    id                      TEXT PRIMARY KEY,
    title                   TEXT NOT NULL DEFAULT 'New conversation',
    mode                    TEXT NOT NULL DEFAULT 'chat',
    model                   TEXT NOT NULL DEFAULT '',
    server_conversation_id  TEXT,
    route_mode              TEXT NOT NULL DEFAULT 'chat',
    agent_id                TEXT,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

-- Messages: one-to-many from conversations
CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'user',
    content         TEXT NOT NULL DEFAULT '',
    model           TEXT,
    tool_calls      TEXT,
    tool_results    TEXT,
    error           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

-- Tools: cached from matrx-ai tool registry / Supabase tools table
CREATE TABLE IF NOT EXISTS tools (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '[]',
    parameters  TEXT NOT NULL DEFAULT '{}',
    source      TEXT NOT NULL DEFAULT 'local',
    version     TEXT NOT NULL DEFAULT '1',
    raw_json    TEXT NOT NULL DEFAULT '{}',
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tools_name ON tools(name);
CREATE INDEX IF NOT EXISTS idx_tools_category ON tools(category);

-- Sync metadata: tracks last sync timestamps per entity type
CREATE TABLE IF NOT EXISTS sync_meta (
    entity_type     TEXT PRIMARY KEY,
    last_synced_at  TEXT,
    last_hash       TEXT,
    status          TEXT NOT NULL DEFAULT 'idle',
    error_message   TEXT,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pending sync queue: local changes waiting to be pushed to cloud
CREATE TABLE IF NOT EXISTS sync_queue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    action      TEXT NOT NULL,
    payload     TEXT NOT NULL DEFAULT '{}',
    attempts    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, created_at)
"""

# ------------------------------------------------------------------
# Migration 2: Extended tables — prompts, notes, auth, instance
# ------------------------------------------------------------------

_V2_EXTENDED = """
-- Auth tokens: persists the user JWT so Python survives restarts.
-- Single row keyed by 'current_user'. Both Python and React keep this in sync.
CREATE TABLE IF NOT EXISTS auth_tokens (
    key           TEXT PRIMARY KEY,
    access_token  TEXT NOT NULL,
    refresh_token TEXT,
    user_id       TEXT,
    expires_at    INTEGER,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prompt builtins: system-wide prompts from AIDream /api/prompts/builtins (no auth needed)
CREATE TABLE IF NOT EXISTS prompt_builtins (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL DEFAULT '',
    description       TEXT NOT NULL DEFAULT '',
    category          TEXT NOT NULL DEFAULT '',
    tags              TEXT NOT NULL DEFAULT '[]',
    variable_defaults TEXT NOT NULL DEFAULT '[]',
    settings          TEXT NOT NULL DEFAULT '{}',
    is_active         INTEGER NOT NULL DEFAULT 1,
    raw_json          TEXT NOT NULL DEFAULT '{}',
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prompt_builtins_name ON prompt_builtins(name);
CREATE INDEX IF NOT EXISTS idx_prompt_builtins_category ON prompt_builtins(category);

-- User prompts: the authenticated user's own prompts from AIDream /api/prompts
CREATE TABLE IF NOT EXISTS prompts (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL DEFAULT '',
    name              TEXT NOT NULL DEFAULT '',
    description       TEXT NOT NULL DEFAULT '',
    category          TEXT NOT NULL DEFAULT '',
    tags              TEXT NOT NULL DEFAULT '[]',
    variable_defaults TEXT NOT NULL DEFAULT '[]',
    settings          TEXT NOT NULL DEFAULT '{}',
    is_favorite       INTEGER NOT NULL DEFAULT 0,
    raw_json          TEXT NOT NULL DEFAULT '{}',
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prompts_user ON prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_prompts_name ON prompts(name);

-- Notes: local copy of the user's notes (Supabase is sync target, not source of truth)
CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT '',
    folder_id   TEXT,
    title       TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',
    content_hash TEXT,
    file_path   TEXT,
    is_deleted  INTEGER NOT NULL DEFAULT 0,
    is_pinned   INTEGER NOT NULL DEFAULT 0,
    tags        TEXT NOT NULL DEFAULT '[]',
    sync_version INTEGER NOT NULL DEFAULT 0,
    supabase_updated_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);

-- Note folders
CREATE TABLE IF NOT EXISTS note_folders (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT '',
    parent_id   TEXT,
    name        TEXT NOT NULL DEFAULT '',
    path        TEXT NOT NULL DEFAULT '',
    is_deleted  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_note_folders_user ON note_folders(user_id, is_deleted);

-- Note versions: snapshot history for a note
CREATE TABLE IF NOT EXISTS note_versions (
    id          TEXT PRIMARY KEY,
    note_id     TEXT NOT NULL,
    user_id     TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',
    content_hash TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_versions_note ON note_versions(note_id, created_at DESC);

-- Note shares
CREATE TABLE IF NOT EXISTS note_shares (
    id          TEXT PRIMARY KEY,
    note_id     TEXT NOT NULL,
    owner_id    TEXT NOT NULL DEFAULT '',
    shared_with TEXT NOT NULL DEFAULT '',
    permission  TEXT NOT NULL DEFAULT 'read',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_shares_note ON note_shares(note_id);
CREATE INDEX IF NOT EXISTS idx_note_shares_user ON note_shares(shared_with);

-- Note devices: registered devices for multi-device sync tracking
CREATE TABLE IF NOT EXISTS note_devices (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT '',
    device_id   TEXT NOT NULL DEFAULT '',
    device_name TEXT NOT NULL DEFAULT '',
    platform    TEXT NOT NULL DEFAULT '',
    last_seen   TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_note_devices_user ON note_devices(user_id);

-- App instance: single-row table describing this installation
-- Row key is always 'self'. Use INSERT OR REPLACE to update.
CREATE TABLE IF NOT EXISTS app_instance (
    key            TEXT PRIMARY KEY DEFAULT 'self',
    instance_id    TEXT NOT NULL DEFAULT '',
    instance_name  TEXT NOT NULL DEFAULT 'My Computer',
    user_id        TEXT NOT NULL DEFAULT '',
    platform       TEXT NOT NULL DEFAULT '',
    os_version     TEXT NOT NULL DEFAULT '',
    architecture   TEXT NOT NULL DEFAULT '',
    hostname       TEXT NOT NULL DEFAULT '',
    registered_at  TEXT,
    last_heartbeat TEXT,
    raw_json       TEXT NOT NULL DEFAULT '{}',
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- App settings: single-row JSON blob for all user/instance settings
-- Row key is always 'settings'. Use INSERT OR REPLACE to update.
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY DEFAULT 'settings',
    settings   TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

# ------------------------------------------------------------------
# Migration 3: Conversation persistence tables for matrx-ai client mode
# ------------------------------------------------------------------

_V3_CONVERSATION_PERSISTENCE = """
-- User requests: one per AI interaction, status tracks lifecycle
CREATE TABLE IF NOT EXISTS user_requests (
    id                 TEXT PRIMARY KEY,
    conversation_id    TEXT NOT NULL,
    user_id            TEXT NOT NULL DEFAULT '',
    status             TEXT NOT NULL DEFAULT 'pending',
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_requests_conv ON user_requests(conversation_id, created_at DESC);

-- Tool call logs: one row per tool invocation within a request
CREATE TABLE IF NOT EXISTS tool_call_logs (
    id             TEXT PRIMARY KEY,
    conversation_id TEXT,
    user_request_id TEXT,
    status         TEXT NOT NULL DEFAULT 'running',
    data           TEXT NOT NULL DEFAULT '{}',
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tool_call_logs_request ON tool_call_logs(user_request_id, created_at DESC);
"""

# ------------------------------------------------------------------
# Migration 4: Add user_id to agents table for per-user isolation
# ------------------------------------------------------------------

_V4_AGENTS_USER_ID = """
-- Add user_id column to agents so user-sourced agents can be filtered
-- per authenticated user.  Builtins always have user_id = '' (empty string).
ALTER TABLE agents ADD COLUMN user_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
"""

# ------------------------------------------------------------------
# Migration 5: Add category, tags, is_favorite to agents table
# ------------------------------------------------------------------

_V5_AGENTS_METADATA = """
-- category and tags are used for search/filtering in the AgentPicker UI.
-- is_favorite allows users to star their most-used agents.
ALTER TABLE agents ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN tags     TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agents ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_agents_category ON agents(category);
"""

# ------------------------------------------------------------------
# All migrations in order
# ------------------------------------------------------------------

MIGRATIONS: list[tuple[int, str]] = [
    (1, _V1_CORE),
    (2, _V2_EXTENDED),
    (3, _V3_CONVERSATION_PERSISTENCE),
    (4, _V4_AGENTS_USER_ID),
    (5, _V5_AGENTS_METADATA),
]
