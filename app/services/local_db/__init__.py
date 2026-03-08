"""Local SQLite database — offline-first data store for Matrx Local.

All runtime data (models, agents, conversations, tools) is read from this
database.  Cloud data (Supabase) is synced in the background so the app
works fully offline and responds instantly.
"""

from app.services.local_db.database import get_db, LocalDatabase
from app.services.local_db.repositories import (
    ModelsRepo,
    AgentsRepo,
    ConversationsRepo,
    MessagesRepo,
    ToolsRepo,
    SyncMetaRepo,
)

__all__ = [
    "get_db",
    "LocalDatabase",
    "ModelsRepo",
    "AgentsRepo",
    "ConversationsRepo",
    "MessagesRepo",
    "ToolsRepo",
    "SyncMetaRepo",
]
