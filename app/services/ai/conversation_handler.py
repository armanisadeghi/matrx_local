"""SQLite-backed ConversationHandler for matrx-ai client mode.

matrx-ai's client mode requires a ConversationHandler object that persists
conversations, user requests, messages, and tool call logs locally instead
of writing to the cloud database directly.

This implementation delegates all storage to the local SQLite database
(~/.matrx/matrx.db) via the existing repository layer, keeping SQLite as
the single source of truth consistent with the rest of the application.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from app.common.system_logger import get_logger
from app.services.local_db.repositories import (
    ConversationsRepo,
    MessagesRepo,
)
from app.services.local_db.database import get_db

logger = get_logger()

_HANDLER_INSTANCE: "LocalConversationHandler | None" = None


def get_conversation_handler() -> "LocalConversationHandler":
    """Return the singleton handler instance, creating it lazily if needed."""
    global _HANDLER_INSTANCE
    if _HANDLER_INSTANCE is None:
        _HANDLER_INSTANCE = LocalConversationHandler()
    return _HANDLER_INSTANCE


class LocalConversationHandler:
    """Implements matrx_ai.client_mode.config.ConversationHandler via local SQLite.

    All five protocol methods are async and delegate to the existing
    ConversationsRepo / MessagesRepo plus two new tables:
    - user_requests: one row per AI interaction
    - tool_call_logs: one row per tool invocation
    """

    def __init__(self) -> None:
        self._convs = ConversationsRepo()
        self._msgs = MessagesRepo()

    # ------------------------------------------------------------------
    # ConversationHandler protocol
    # ------------------------------------------------------------------

    async def ensure_conversation_exists(
        self,
        conversation_id: str,
        user_id: str,
        parent_conversation_id: str | None = None,
        variables: dict[str, Any] | None = None,
        overrides: dict[str, Any] | None = None,
    ) -> None:
        existing = await self._convs.get(conversation_id)
        if existing:
            return
        await self._convs.create(
            {
                "id": conversation_id,
                "title": "New conversation",
                "mode": "chat",
                "model": "",
                "server_conversation_id": None,
                "route_mode": overrides.get("route_mode", "chat") if overrides else "chat",
                "agent_id": overrides.get("agent_id") if overrides else None,
            }
        )
        logger.debug("[conv_handler] Created conversation %s for user %s", conversation_id, user_id)

    async def create_pending_user_request(
        self,
        request_id: str,
        conversation_id: str,
        user_id: str,
    ) -> None:
        db = get_db()
        await db.execute(
            """INSERT OR IGNORE INTO user_requests
               (id, conversation_id, user_id, status, created_at, updated_at)
               VALUES (?, ?, ?, 'pending', datetime('now'), datetime('now'))""",
            (request_id, conversation_id, user_id),
        )
        await db.commit()
        logger.debug("[conv_handler] Created pending request %s", request_id)

    async def persist_completed_request(
        self,
        completed: Any,
        conversation_id: str | None = None,
    ) -> dict[str, Any]:
        """Persist all data from a completed AI execution to SQLite.

        The `completed` object may be a dict or a dataclass-like object.
        We extract messages, request metadata, and store them locally.
        Returns the IDs used for tracing.
        """
        data: dict[str, Any] = completed if isinstance(completed, dict) else _to_dict(completed)

        conv_id: str = conversation_id or data.get("conversation_id") or str(uuid.uuid4())
        user_request_id: str = data.get("user_request_id") or data.get("request_id") or str(uuid.uuid4())
        message_ids: list[str] = []
        request_ids: list[str] = [user_request_id]

        # Persist any messages included in the completed payload
        messages = data.get("messages") or []
        if isinstance(messages, list):
            for msg in messages:
                msg_dict = msg if isinstance(msg, dict) else _to_dict(msg)
                if not msg_dict.get("id"):
                    msg_dict["id"] = str(uuid.uuid4())
                msg_dict.setdefault("conversation_id", conv_id)
                try:
                    await self._msgs.create(msg_dict)
                    message_ids.append(msg_dict["id"])
                except Exception as exc:
                    # Duplicate key is fine — message was already persisted
                    logger.debug("[conv_handler] Skipping duplicate message %s: %s", msg_dict.get("id"), exc)

        # Update the user_request row to status=completed
        db = get_db()
        await db.execute(
            """UPDATE user_requests SET status='completed', updated_at=datetime('now')
               WHERE id = ?""",
            (user_request_id,),
        )
        await db.commit()

        logger.debug(
            "[conv_handler] Persisted request %s: %d messages",
            user_request_id,
            len(message_ids),
        )
        return {
            "conversation_id": conv_id,
            "user_request_id": user_request_id,
            "message_ids": message_ids,
            "request_ids": request_ids,
        }

    async def log_tool_call_start(
        self,
        row_id: str,
        data: dict[str, Any],
    ) -> None:
        db = get_db()
        await db.execute(
            """INSERT OR REPLACE INTO tool_call_logs
               (id, conversation_id, user_request_id, status, data, created_at, updated_at)
               VALUES (?, ?, ?, 'running', ?, datetime('now'), datetime('now'))""",
            (
                row_id,
                data.get("conversation_id"),
                data.get("user_request_id"),
                json.dumps(data),
            ),
        )
        await db.commit()

    async def log_tool_call_update(
        self,
        row_id: str,
        data: dict[str, Any],
    ) -> None:
        db = get_db()
        status = data.get("status", "completed")
        await db.execute(
            """UPDATE tool_call_logs
               SET status = ?, data = ?, updated_at = datetime('now')
               WHERE id = ?""",
            (status, json.dumps(data), row_id),
        )
        await db.commit()

    async def get_conversation_config(
        self,
        conversation_id: str,
    ) -> dict[str, Any]:
        """Return the stored conversation config for ConversationResolver."""
        conv = await self._convs.get(conversation_id)
        if not conv:
            return {}
        return {
            "id": conv.get("id"),
            "mode": conv.get("mode", "chat"),
            "model": conv.get("model", ""),
            "route_mode": conv.get("route_mode", "chat"),
            "agent_id": conv.get("agent_id"),
        }


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _to_dict(obj: Any) -> dict[str, Any]:
    """Best-effort conversion of a dataclass or object to a plain dict."""
    if hasattr(obj, "__dict__"):
        return {k: v for k, v in obj.__dict__.items() if not k.startswith("_")}
    if hasattr(obj, "_asdict"):
        return obj._asdict()
    return {}
