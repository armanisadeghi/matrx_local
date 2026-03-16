"""Data access repositories for each SQLite table.

Each repo provides typed CRUD operations over the local database.
All reads are instant (local SQLite), all writes commit immediately.
JSON fields (lists, dicts) are serialized/deserialized transparently.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from app.services.local_db.database import get_db, LocalDatabase

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _json_dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str)


def _json_loads(raw: str | None) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return raw


def _row_to_dict(row) -> dict[str, Any]:
    if row is None:
        return {}
    return dict(row)


# ==================================================================
# ModelsRepo — ai_models table
# ==================================================================

class ModelsRepo:
    def __init__(self, db: LocalDatabase | None = None):
        self._db = db or get_db()

    async def list_all(self, include_deprecated: bool = False) -> list[dict[str, Any]]:
        sql = "SELECT * FROM ai_models"
        if not include_deprecated:
            sql += " WHERE is_deprecated = 0"
        sql += " ORDER BY is_primary DESC, provider, common_name"
        rows = await self._db.fetchall(sql)
        return [self._deserialize(r) for r in rows]

    async def get(self, model_id: str) -> dict[str, Any] | None:
        row = await self._db.fetchone("SELECT * FROM ai_models WHERE id = ?", (model_id,))
        return self._deserialize(row) if row else None

    async def get_by_name(self, name: str) -> dict[str, Any] | None:
        row = await self._db.fetchone("SELECT * FROM ai_models WHERE name = ?", (name,))
        return self._deserialize(row) if row else None

    async def upsert(self, model: dict[str, Any]) -> None:
        await self._db.execute(
            """INSERT INTO ai_models (id, name, common_name, provider, endpoints,
               capabilities, context_window, max_tokens, is_primary, is_premium,
               is_deprecated, raw_json, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, common_name=excluded.common_name,
                 provider=excluded.provider, endpoints=excluded.endpoints,
                 capabilities=excluded.capabilities, context_window=excluded.context_window,
                 max_tokens=excluded.max_tokens, is_primary=excluded.is_primary,
                 is_premium=excluded.is_premium, is_deprecated=excluded.is_deprecated,
                 raw_json=excluded.raw_json, updated_at=excluded.updated_at""",
            (
                model["id"],
                model.get("name", ""),
                model.get("common_name", ""),
                model.get("provider", ""),
                _json_dumps(model.get("endpoints", [])),
                _json_dumps(model.get("capabilities", [])),
                model.get("context_window"),
                model.get("max_tokens"),
                int(model.get("is_primary", False)),
                int(model.get("is_premium", False)),
                int(model.get("is_deprecated", False)),
                _json_dumps(model),
                _now(),
            ),
        )
        await self._db.commit()

    async def upsert_many(self, models: list[dict[str, Any]]) -> None:
        for m in models:
            await self.upsert(m)

    async def delete_missing(self, keep_ids: set[str]) -> int:
        """Remove models not in keep_ids. Returns count deleted."""
        if not keep_ids:
            return 0
        placeholders = ",".join("?" for _ in keep_ids)
        cursor = await self._db.execute(
            f"DELETE FROM ai_models WHERE id NOT IN ({placeholders})",
            tuple(keep_ids),
        )
        await self._db.commit()
        return cursor.rowcount

    async def count(self) -> int:
        row = await self._db.fetchone("SELECT COUNT(*) as cnt FROM ai_models WHERE is_deprecated = 0")
        return row["cnt"] if row else 0

    def _deserialize(self, row) -> dict[str, Any]:
        d = _row_to_dict(row)
        d["endpoints"] = _json_loads(d.get("endpoints", "[]")) or []
        d["capabilities"] = _json_loads(d.get("capabilities", "[]")) or []
        d["is_primary"] = bool(d.get("is_primary", 0))
        d["is_premium"] = bool(d.get("is_premium", 0))
        d["is_deprecated"] = bool(d.get("is_deprecated", 0))
        d["raw_json"] = _json_loads(d.get("raw_json", "{}")) or {}
        return d


# ==================================================================
# AgentsRepo — agents table
# ==================================================================

class AgentsRepo:
    def __init__(self, db: LocalDatabase | None = None):
        self._db = db or get_db()

    async def list_all(self, source: str | None = None) -> list[dict[str, Any]]:
        if source:
            rows = await self._db.fetchall(
                "SELECT * FROM agents WHERE source = ? AND is_active = 1 ORDER BY name",
                (source,),
            )
        else:
            rows = await self._db.fetchall(
                "SELECT * FROM agents WHERE is_active = 1 ORDER BY source, name"
            )
        return [self._deserialize(r) for r in rows]

    async def get(self, agent_id: str) -> dict[str, Any] | None:
        row = await self._db.fetchone("SELECT * FROM agents WHERE id = ?", (agent_id,))
        return self._deserialize(row) if row else None

    async def upsert(self, agent: dict[str, Any]) -> None:
        await self._db.execute(
            """INSERT INTO agents (id, name, description, source, variable_defaults,
               settings, is_active, raw_json, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, description=excluded.description,
                 source=excluded.source, variable_defaults=excluded.variable_defaults,
                 settings=excluded.settings, is_active=excluded.is_active,
                 raw_json=excluded.raw_json, updated_at=excluded.updated_at""",
            (
                agent["id"],
                agent.get("name", ""),
                agent.get("description", ""),
                agent.get("source", "builtin"),
                _json_dumps(agent.get("variable_defaults", [])),
                _json_dumps(agent.get("settings", {})),
                int(agent.get("is_active", True)),
                _json_dumps(agent),
                _now(),
            ),
        )
        await self._db.commit()

    async def upsert_many(self, agents: list[dict[str, Any]]) -> None:
        for a in agents:
            await self.upsert(a)

    async def delete_by_source(self, source: str, keep_ids: set[str]) -> int:
        if not keep_ids:
            cursor = await self._db.execute(
                "DELETE FROM agents WHERE source = ?", (source,)
            )
        else:
            placeholders = ",".join("?" for _ in keep_ids)
            cursor = await self._db.execute(
                f"DELETE FROM agents WHERE source = ? AND id NOT IN ({placeholders})",
                (source, *keep_ids),
            )
        await self._db.commit()
        return cursor.rowcount

    def _deserialize(self, row) -> dict[str, Any]:
        d = _row_to_dict(row)
        d["variable_defaults"] = _json_loads(d.get("variable_defaults", "[]")) or []
        d["settings"] = _json_loads(d.get("settings", "{}")) or {}
        d["is_active"] = bool(d.get("is_active", 1))
        d["raw_json"] = _json_loads(d.get("raw_json", "{}")) or {}
        return d


# ==================================================================
# ConversationsRepo — conversations table
# ==================================================================

class ConversationsRepo:
    def __init__(self, db: LocalDatabase | None = None):
        self._db = db or get_db()

    async def list_all(self, limit: int = 200, offset: int = 0) -> list[dict[str, Any]]:
        rows = await self._db.fetchall(
            "SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        )
        return [_row_to_dict(r) for r in rows]

    async def get(self, conv_id: str) -> dict[str, Any] | None:
        row = await self._db.fetchone("SELECT * FROM conversations WHERE id = ?", (conv_id,))
        return _row_to_dict(row) if row else None

    async def create(self, conv: dict[str, Any]) -> None:
        now = _now()
        await self._db.execute(
            """INSERT INTO conversations (id, title, mode, model, server_conversation_id,
               route_mode, agent_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                conv["id"],
                conv.get("title", "New conversation"),
                conv.get("mode", "chat"),
                conv.get("model", ""),
                conv.get("server_conversation_id"),
                conv.get("route_mode", "chat"),
                conv.get("agent_id"),
                conv.get("created_at", now),
                conv.get("updated_at", now),
            ),
        )
        await self._db.commit()

    async def update(self, conv_id: str, updates: dict[str, Any]) -> None:
        sets = []
        params = []
        for key in ("title", "mode", "model", "server_conversation_id", "route_mode", "agent_id"):
            if key in updates:
                sets.append(f"{key} = ?")
                params.append(updates[key])
        if not sets:
            return
        sets.append("updated_at = ?")
        params.append(_now())
        params.append(conv_id)
        await self._db.execute(
            f"UPDATE conversations SET {', '.join(sets)} WHERE id = ?",
            tuple(params),
        )
        await self._db.commit()

    async def delete(self, conv_id: str) -> None:
        # Messages cascade-delete via FK
        await self._db.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
        await self._db.commit()

    async def count(self) -> int:
        row = await self._db.fetchone("SELECT COUNT(*) as cnt FROM conversations")
        return row["cnt"] if row else 0


# ==================================================================
# MessagesRepo — messages table
# ==================================================================

class MessagesRepo:
    def __init__(self, db: LocalDatabase | None = None):
        self._db = db or get_db()

    async def list_by_conversation(self, conv_id: str) -> list[dict[str, Any]]:
        rows = await self._db.fetchall(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at",
            (conv_id,),
        )
        return [self._deserialize(r) for r in rows]

    async def create(self, msg: dict[str, Any]) -> None:
        await self._db.execute(
            """INSERT INTO messages (id, conversation_id, role, content, model,
               tool_calls, tool_results, error, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                msg["id"],
                msg["conversation_id"],
                msg.get("role", "user"),
                msg.get("content", ""),
                msg.get("model"),
                _json_dumps(msg["tool_calls"]) if msg.get("tool_calls") else None,
                _json_dumps(msg["tool_results"]) if msg.get("tool_results") else None,
                msg.get("error"),
                msg.get("created_at", _now()),
            ),
        )
        await self._db.commit()

    async def create_many(self, messages: list[dict[str, Any]]) -> None:
        for m in messages:
            await self.create(m)

    async def update(self, msg_id: str, updates: dict[str, Any]) -> None:
        sets = []
        params = []
        for key in ("content", "model", "error"):
            if key in updates:
                sets.append(f"{key} = ?")
                params.append(updates[key])
        for key in ("tool_calls", "tool_results"):
            if key in updates:
                sets.append(f"{key} = ?")
                params.append(_json_dumps(updates[key]) if updates[key] else None)
        if not sets:
            return
        params.append(msg_id)
        await self._db.execute(
            f"UPDATE messages SET {', '.join(sets)} WHERE id = ?",
            tuple(params),
        )
        await self._db.commit()

    async def delete_by_conversation(self, conv_id: str) -> int:
        cursor = await self._db.execute(
            "DELETE FROM messages WHERE conversation_id = ?", (conv_id,)
        )
        await self._db.commit()
        return cursor.rowcount

    def _deserialize(self, row) -> dict[str, Any]:
        d = _row_to_dict(row)
        d["tool_calls"] = _json_loads(d.get("tool_calls"))
        d["tool_results"] = _json_loads(d.get("tool_results"))
        return d


# ==================================================================
# ToolsRepo — tools table
# ==================================================================

class ToolsRepo:
    def __init__(self, db: LocalDatabase | None = None):
        self._db = db or get_db()

    async def list_all(self, source: str | None = None) -> list[dict[str, Any]]:
        if source:
            rows = await self._db.fetchall(
                "SELECT * FROM tools WHERE source = ? ORDER BY category, name",
                (source,),
            )
        else:
            rows = await self._db.fetchall(
                "SELECT * FROM tools ORDER BY category, name"
            )
        return [self._deserialize(r) for r in rows]

    async def list_by_category(self) -> dict[str, list[dict[str, Any]]]:
        all_tools = await self.list_all()
        grouped: dict[str, list[dict[str, Any]]] = {}
        for t in all_tools:
            cat = t.get("category", "other")
            grouped.setdefault(cat, []).append(t)
        return grouped

    async def get_by_name(self, name: str) -> dict[str, Any] | None:
        row = await self._db.fetchone("SELECT * FROM tools WHERE name = ?", (name,))
        return self._deserialize(row) if row else None

    async def upsert(self, tool: dict[str, Any]) -> None:
        await self._db.execute(
            """INSERT INTO tools (id, name, description, category, tags,
               parameters, source, version, raw_json, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, description=excluded.description,
                 category=excluded.category, tags=excluded.tags,
                 parameters=excluded.parameters, source=excluded.source,
                 version=excluded.version, raw_json=excluded.raw_json,
                 updated_at=excluded.updated_at""",
            (
                tool.get("id", tool.get("name", "")),
                tool.get("name", ""),
                tool.get("description", ""),
                tool.get("category", ""),
                _json_dumps(tool.get("tags", [])),
                _json_dumps(tool.get("parameters", {})),
                tool.get("source", "local"),
                tool.get("version", "1"),
                _json_dumps(tool),
                _now(),
            ),
        )
        await self._db.commit()

    async def upsert_many(self, tools: list[dict[str, Any]]) -> None:
        for t in tools:
            await self.upsert(t)

    async def count(self) -> int:
        row = await self._db.fetchone("SELECT COUNT(*) as cnt FROM tools")
        return row["cnt"] if row else 0

    def _deserialize(self, row) -> dict[str, Any]:
        d = _row_to_dict(row)
        d["tags"] = _json_loads(d.get("tags", "[]")) or []
        d["parameters"] = _json_loads(d.get("parameters", "{}")) or {}
        d["raw_json"] = _json_loads(d.get("raw_json", "{}")) or {}
        return d


# ==================================================================
# SyncMetaRepo — sync_meta + sync_queue tables
# ==================================================================

class SyncMetaRepo:
    def __init__(self, db: LocalDatabase | None = None):
        self._db = db or get_db()

    async def get_last_sync(self, entity_type: str) -> dict[str, Any] | None:
        row = await self._db.fetchone(
            "SELECT * FROM sync_meta WHERE entity_type = ?", (entity_type,)
        )
        return _row_to_dict(row) if row else None

    async def set_last_sync(
        self,
        entity_type: str,
        *,
        status: str = "success",
        last_hash: str | None = None,
        error_message: str | None = None,
    ) -> None:
        now = _now()
        await self._db.execute(
            """INSERT INTO sync_meta (entity_type, last_synced_at, last_hash, status, error_message, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(entity_type) DO UPDATE SET
                 last_synced_at=excluded.last_synced_at, last_hash=excluded.last_hash,
                 status=excluded.status, error_message=excluded.error_message,
                 updated_at=excluded.updated_at""",
            (entity_type, now, last_hash, status, error_message, now),
        )
        await self._db.commit()

    async def get_all_sync_status(self) -> list[dict[str, Any]]:
        rows = await self._db.fetchall("SELECT * FROM sync_meta ORDER BY entity_type")
        return [_row_to_dict(r) for r in rows]

    # -- Sync queue --

    async def enqueue(self, entity_type: str, entity_id: str, action: str, payload: dict) -> None:
        await self._db.execute(
            """INSERT INTO sync_queue (entity_type, entity_id, action, payload)
               VALUES (?, ?, ?, ?)""",
            (entity_type, entity_id, action, _json_dumps(payload)),
        )
        await self._db.commit()

    async def dequeue(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = await self._db.fetchall(
            "SELECT * FROM sync_queue ORDER BY created_at LIMIT ?", (limit,)
        )
        return [_row_to_dict(r) for r in rows]

    async def remove_from_queue(self, queue_id: int) -> None:
        await self._db.execute("DELETE FROM sync_queue WHERE id = ?", (queue_id,))
        await self._db.commit()

    async def increment_attempts(self, queue_id: int) -> None:
        await self._db.execute(
            "UPDATE sync_queue SET attempts = attempts + 1 WHERE id = ?", (queue_id,)
        )
        await self._db.commit()

    async def pending_count(self) -> int:
        row = await self._db.fetchone("SELECT COUNT(*) as cnt FROM sync_queue")
        return row["cnt"] if row else 0


# ==================================================================
# TokenRepo — auth_tokens table (single row: key='current_user')
# ==================================================================

_TOKEN_KEY = "current_user"


class TokenRepo:
    def __init__(self, db: LocalDatabase | None = None):
        self._db = db or get_db()

    async def get(self) -> dict[str, Any] | None:
        row = await self._db.fetchone(
            "SELECT * FROM auth_tokens WHERE key = ?", (_TOKEN_KEY,)
        )
        return _row_to_dict(row) if row else None

    async def save(
        self,
        access_token: str,
        user_id: str,
        refresh_token: str | None = None,
        expires_at: int | None = None,
    ) -> None:
        await self._db.execute(
            """INSERT INTO auth_tokens (key, access_token, refresh_token, user_id, expires_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET
                 access_token=excluded.access_token,
                 refresh_token=excluded.refresh_token,
                 user_id=excluded.user_id,
                 expires_at=excluded.expires_at,
                 updated_at=excluded.updated_at""",
            (_TOKEN_KEY, access_token, refresh_token, user_id, expires_at, _now()),
        )
        await self._db.commit()

    async def clear(self) -> None:
        await self._db.execute("DELETE FROM auth_tokens WHERE key = ?", (_TOKEN_KEY,))
        await self._db.commit()

    def is_expired(self, token_row: dict[str, Any]) -> bool:
        import time
        expires_at = token_row.get("expires_at")
        if not expires_at:
            return False
        return int(time.time()) >= int(expires_at)


# ==================================================================
# PromptBuiltinsRepo — prompt_builtins table
# ==================================================================

class PromptBuiltinsRepo:
    def __init__(self, db: LocalDatabase | None = None):
        self._db = db or get_db()

    async def list_all(self, active_only: bool = True) -> list[dict[str, Any]]:
        sql = "SELECT * FROM prompt_builtins"
        if active_only:
            sql += " WHERE is_active = 1"
        sql += " ORDER BY name"
        rows = await self._db.fetchall(sql)
        return [self._deserialize(r) for r in rows]

    async def get(self, builtin_id: str) -> dict[str, Any] | None:
        row = await self._db.fetchone(
            "SELECT * FROM prompt_builtins WHERE id = ?", (builtin_id,)
        )
        return self._deserialize(row) if row else None

    async def upsert(self, builtin: dict[str, Any]) -> None:
        await self._db.execute(
            """INSERT INTO prompt_builtins
               (id, name, description, category, tags, variable_defaults, settings, is_active, raw_json, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, description=excluded.description,
                 category=excluded.category, tags=excluded.tags,
                 variable_defaults=excluded.variable_defaults,
                 settings=excluded.settings, is_active=excluded.is_active,
                 raw_json=excluded.raw_json, updated_at=excluded.updated_at""",
            (
                builtin["id"],
                builtin.get("name", ""),
                builtin.get("description", ""),
                builtin.get("category", ""),
                _json_dumps(builtin.get("tags", [])),
                _json_dumps(builtin.get("variable_defaults", [])),
                _json_dumps(builtin.get("settings", {})),
                int(builtin.get("is_active", True)),
                _json_dumps(builtin),
                _now(),
            ),
        )
        await self._db.commit()

    async def upsert_many(self, builtins: list[dict[str, Any]]) -> None:
        for b in builtins:
            await self.upsert(b)

    async def delete_missing(self, keep_ids: set[str]) -> int:
        if not keep_ids:
            return 0
        placeholders = ",".join("?" for _ in keep_ids)
        cursor = await self._db.execute(
            f"DELETE FROM prompt_builtins WHERE id NOT IN ({placeholders})",
            tuple(keep_ids),
        )
        await self._db.commit()
        return cursor.rowcount

    async def count(self) -> int:
        row = await self._db.fetchone("SELECT COUNT(*) as cnt FROM prompt_builtins WHERE is_active = 1")
        return row["cnt"] if row else 0

    def _deserialize(self, row) -> dict[str, Any]:
        d = _row_to_dict(row)
        d["tags"] = _json_loads(d.get("tags", "[]")) or []
        d["variable_defaults"] = _json_loads(d.get("variable_defaults", "[]")) or []
        d["settings"] = _json_loads(d.get("settings", "{}")) or {}
        d["is_active"] = bool(d.get("is_active", 1))
        d["raw_json"] = _json_loads(d.get("raw_json", "{}")) or {}
        return d


# ==================================================================
# PromptsRepo — prompts table (user-owned prompts)
# ==================================================================

class PromptsRepo:
    def __init__(self, db: LocalDatabase | None = None):
        self._db = db or get_db()

    async def list_for_user(self, user_id: str) -> list[dict[str, Any]]:
        rows = await self._db.fetchall(
            "SELECT * FROM prompts WHERE user_id = ? ORDER BY name",
            (user_id,),
        )
        return [self._deserialize(r) for r in rows]

    async def list_all(self) -> list[dict[str, Any]]:
        rows = await self._db.fetchall("SELECT * FROM prompts ORDER BY name")
        return [self._deserialize(r) for r in rows]

    async def get(self, prompt_id: str) -> dict[str, Any] | None:
        row = await self._db.fetchone("SELECT * FROM prompts WHERE id = ?", (prompt_id,))
        return self._deserialize(row) if row else None

    async def upsert(self, prompt: dict[str, Any]) -> None:
        await self._db.execute(
            """INSERT INTO prompts
               (id, user_id, name, description, category, tags, variable_defaults,
                settings, is_favorite, raw_json, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 user_id=excluded.user_id, name=excluded.name,
                 description=excluded.description, category=excluded.category,
                 tags=excluded.tags, variable_defaults=excluded.variable_defaults,
                 settings=excluded.settings, is_favorite=excluded.is_favorite,
                 raw_json=excluded.raw_json, updated_at=excluded.updated_at""",
            (
                prompt["id"],
                prompt.get("user_id", ""),
                prompt.get("name", ""),
                prompt.get("description", ""),
                prompt.get("category", ""),
                _json_dumps(prompt.get("tags", [])),
                _json_dumps(prompt.get("variable_defaults", [])),
                _json_dumps(prompt.get("settings", {})),
                int(prompt.get("is_favorite", False)),
                _json_dumps(prompt),
                _now(),
            ),
        )
        await self._db.commit()

    async def upsert_many(self, prompts: list[dict[str, Any]]) -> None:
        for p in prompts:
            await self.upsert(p)

    async def delete_for_user(self, user_id: str, keep_ids: set[str]) -> int:
        if not keep_ids:
            cursor = await self._db.execute(
                "DELETE FROM prompts WHERE user_id = ?", (user_id,)
            )
        else:
            placeholders = ",".join("?" for _ in keep_ids)
            cursor = await self._db.execute(
                f"DELETE FROM prompts WHERE user_id = ? AND id NOT IN ({placeholders})",
                (user_id, *keep_ids),
            )
        await self._db.commit()
        return cursor.rowcount

    async def count(self) -> int:
        row = await self._db.fetchone("SELECT COUNT(*) as cnt FROM prompts")
        return row["cnt"] if row else 0

    def _deserialize(self, row) -> dict[str, Any]:
        d = _row_to_dict(row)
        d["tags"] = _json_loads(d.get("tags", "[]")) or []
        d["variable_defaults"] = _json_loads(d.get("variable_defaults", "[]")) or []
        d["settings"] = _json_loads(d.get("settings", "{}")) or {}
        d["is_favorite"] = bool(d.get("is_favorite", 0))
        d["raw_json"] = _json_loads(d.get("raw_json", "{}")) or {}
        return d


# ==================================================================
# NotesRepo — notes table
# ==================================================================

class NotesRepo:
    def __init__(self, db: LocalDatabase | None = None):
        self._db = db or get_db()

    async def list_for_user(
        self,
        user_id: str,
        folder_id: str | None = None,
        include_deleted: bool = False,
    ) -> list[dict[str, Any]]:
        params: list[Any] = [user_id]
        sql = "SELECT * FROM notes WHERE user_id = ?"
        if not include_deleted:
            sql += " AND is_deleted = 0"
        if folder_id is not None:
            sql += " AND folder_id = ?"
            params.append(folder_id)
        sql += " ORDER BY updated_at DESC"
        rows = await self._db.fetchall(sql, tuple(params))
        return [self._deserialize(r) for r in rows]

    async def get(self, note_id: str) -> dict[str, Any] | None:
        row = await self._db.fetchone("SELECT * FROM notes WHERE id = ?", (note_id,))
        return self._deserialize(row) if row else None

    async def upsert(self, note: dict[str, Any]) -> None:
        await self._db.execute(
            """INSERT INTO notes
               (id, user_id, folder_id, title, content, content_hash, file_path,
                is_deleted, is_pinned, tags, sync_version, supabase_updated_at,
                created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 user_id=excluded.user_id, folder_id=excluded.folder_id,
                 title=excluded.title, content=excluded.content,
                 content_hash=excluded.content_hash, file_path=excluded.file_path,
                 is_deleted=excluded.is_deleted, is_pinned=excluded.is_pinned,
                 tags=excluded.tags, sync_version=excluded.sync_version,
                 supabase_updated_at=excluded.supabase_updated_at,
                 updated_at=excluded.updated_at""",
            (
                note["id"],
                note.get("user_id", ""),
                note.get("folder_id"),
                note.get("title", ""),
                note.get("content", ""),
                note.get("content_hash"),
                note.get("file_path"),
                int(note.get("is_deleted", False)),
                int(note.get("is_pinned", False)),
                _json_dumps(note.get("tags", [])),
                note.get("sync_version", 0),
                note.get("supabase_updated_at") or note.get("updated_at"),
                note.get("created_at", _now()),
                note.get("updated_at", _now()),
            ),
        )
        await self._db.commit()

    async def upsert_many(self, notes: list[dict[str, Any]]) -> None:
        for n in notes:
            await self.upsert(n)

    async def soft_delete(self, note_id: str) -> None:
        await self._db.execute(
            "UPDATE notes SET is_deleted = 1, updated_at = ? WHERE id = ?",
            (_now(), note_id),
        )
        await self._db.commit()

    async def hard_delete(self, note_id: str) -> None:
        await self._db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        await self._db.commit()

    async def count(self, user_id: str | None = None) -> int:
        if user_id:
            row = await self._db.fetchone(
                "SELECT COUNT(*) as cnt FROM notes WHERE user_id = ? AND is_deleted = 0",
                (user_id,),
            )
        else:
            row = await self._db.fetchone(
                "SELECT COUNT(*) as cnt FROM notes WHERE is_deleted = 0"
            )
        return row["cnt"] if row else 0

    def _deserialize(self, row) -> dict[str, Any]:
        d = _row_to_dict(row)
        d["tags"] = _json_loads(d.get("tags", "[]")) or []
        d["is_deleted"] = bool(d.get("is_deleted", 0))
        d["is_pinned"] = bool(d.get("is_pinned", 0))
        return d


# ==================================================================
# NoteFoldersRepo — note_folders table
# ==================================================================

class NoteFoldersRepo:
    def __init__(self, db: LocalDatabase | None = None):
        self._db = db or get_db()

    async def list_for_user(
        self, user_id: str, include_deleted: bool = False
    ) -> list[dict[str, Any]]:
        sql = "SELECT * FROM note_folders WHERE user_id = ?"
        if not include_deleted:
            sql += " AND is_deleted = 0"
        sql += " ORDER BY path"
        rows = await self._db.fetchall(sql, (user_id,))
        return [self._deserialize(r) for r in rows]

    async def get(self, folder_id: str) -> dict[str, Any] | None:
        row = await self._db.fetchone(
            "SELECT * FROM note_folders WHERE id = ?", (folder_id,)
        )
        return self._deserialize(row) if row else None

    async def upsert(self, folder: dict[str, Any]) -> None:
        await self._db.execute(
            """INSERT INTO note_folders
               (id, user_id, parent_id, name, path, is_deleted, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 user_id=excluded.user_id, parent_id=excluded.parent_id,
                 name=excluded.name, path=excluded.path,
                 is_deleted=excluded.is_deleted, updated_at=excluded.updated_at""",
            (
                folder["id"],
                folder.get("user_id", ""),
                folder.get("parent_id"),
                folder.get("name", ""),
                folder.get("path", ""),
                int(folder.get("is_deleted", False)),
                folder.get("created_at", _now()),
                folder.get("updated_at", _now()),
            ),
        )
        await self._db.commit()

    async def upsert_many(self, folders: list[dict[str, Any]]) -> None:
        for f in folders:
            await self.upsert(f)

    def _deserialize(self, row) -> dict[str, Any]:
        d = _row_to_dict(row)
        d["is_deleted"] = bool(d.get("is_deleted", 0))
        return d


# ==================================================================
# AppInstanceRepo — app_instance table (single-row: key='self')
# ==================================================================

_INSTANCE_KEY = "self"


class AppInstanceRepo:
    def __init__(self, db: LocalDatabase | None = None):
        self._db = db or get_db()

    async def get(self) -> dict[str, Any] | None:
        row = await self._db.fetchone(
            "SELECT * FROM app_instance WHERE key = ?", (_INSTANCE_KEY,)
        )
        if not row:
            return None
        d = _row_to_dict(row)
        d["raw_json"] = _json_loads(d.get("raw_json", "{}")) or {}
        return d

    async def save(self, data: dict[str, Any]) -> None:
        await self._db.execute(
            """INSERT INTO app_instance
               (key, instance_id, instance_name, user_id, platform, os_version,
                architecture, hostname, registered_at, last_heartbeat, raw_json, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET
                 instance_id=excluded.instance_id, instance_name=excluded.instance_name,
                 user_id=excluded.user_id, platform=excluded.platform,
                 os_version=excluded.os_version, architecture=excluded.architecture,
                 hostname=excluded.hostname, registered_at=excluded.registered_at,
                 last_heartbeat=excluded.last_heartbeat,
                 raw_json=excluded.raw_json, updated_at=excluded.updated_at""",
            (
                _INSTANCE_KEY,
                data.get("instance_id", ""),
                data.get("instance_name", "My Computer"),
                data.get("user_id", ""),
                data.get("platform", ""),
                data.get("os_version", ""),
                data.get("architecture", ""),
                data.get("hostname", ""),
                data.get("registered_at"),
                data.get("last_heartbeat"),
                _json_dumps(data),
                _now(),
            ),
        )
        await self._db.commit()

    async def update_heartbeat(self) -> None:
        await self._db.execute(
            "UPDATE app_instance SET last_heartbeat = ?, updated_at = ? WHERE key = ?",
            (_now(), _now(), _INSTANCE_KEY),
        )
        await self._db.commit()


# ==================================================================
# AppSettingsRepo — app_settings table (single-row: key='settings')
# ==================================================================

_SETTINGS_KEY = "settings"


class AppSettingsRepo:
    def __init__(self, db: LocalDatabase | None = None):
        self._db = db or get_db()

    async def get_all(self) -> dict[str, Any]:
        row = await self._db.fetchone(
            "SELECT settings FROM app_settings WHERE key = ?", (_SETTINGS_KEY,)
        )
        if not row:
            return {}
        return _json_loads(row["settings"]) or {}

    async def save_all(self, settings: dict[str, Any]) -> None:
        await self._db.execute(
            """INSERT INTO app_settings (key, settings, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET
                 settings=excluded.settings, updated_at=excluded.updated_at""",
            (_SETTINGS_KEY, _json_dumps(settings), _now()),
        )
        await self._db.commit()

    async def get(self, key: str, default: Any = None) -> Any:
        all_settings = await self.get_all()
        return all_settings.get(key, default)

    async def set(self, key: str, value: Any) -> None:
        all_settings = await self.get_all()
        all_settings[key] = value
        await self.save_all(all_settings)

    async def set_many(self, updates: dict[str, Any]) -> None:
        all_settings = await self.get_all()
        all_settings.update(updates)
        await self.save_all(all_settings)
