"""WebSocket connection manager with per-connection tool sessions."""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import WebSocket

from app.tools.dispatcher import dispatch
from app.tools.session import ToolSession

logger = logging.getLogger(__name__)


class Connection:
    __slots__ = ("websocket", "session", "_running_tasks")

    def __init__(self, websocket: WebSocket, session: ToolSession) -> None:
        self.websocket = websocket
        self.session = session
        self._running_tasks: dict[str, asyncio.Task] = {}

    def cancel_all(self) -> int:
        count = 0
        for task in self._running_tasks.values():
            if not task.done():
                task.cancel()
                count += 1
        self._running_tasks.clear()
        return count


class WebSocketManager:
    def __init__(self) -> None:
        self.connections: dict[int, Connection] = {}

    async def connect(self, websocket: WebSocket) -> Connection:
        await websocket.accept()
        session = ToolSession()
        conn = Connection(websocket, session)
        self.connections[id(websocket)] = conn
        logger.info("WebSocket connected: %s (session cwd: %s)", id(websocket), session.cwd)
        return conn

    async def disconnect(self, websocket: WebSocket) -> None:
        conn = self.connections.pop(id(websocket), None)
        if conn:
            conn.cancel_all()
            await conn.session.cleanup()
            logger.info("WebSocket disconnected: %s", id(websocket))

    async def handle_tool_message(self, conn: Connection, raw: str) -> None:
        """Parse an incoming message and dispatch concurrently.

        Messages:
          Tool call:  {"id": "...", "tool": "Name", "input": {...}}
          Cancel:     {"id": "...", "action": "cancel"}
          Cancel all: {"action": "cancel_all"}
          Ping:       {"action": "ping"}
        """
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            await self._send(conn, {"type": "error", "output": "Invalid JSON"})
            return

        action = msg.get("action")
        request_id = msg.get("id")

        # ── Control messages ───────────────────────────────────────────────
        if action == "ping":
            await self._send(conn, {"type": "success", "output": "pong", "id": request_id})
            return

        if action == "cancel_all":
            count = conn.cancel_all()
            await self._send(conn, {
                "type": "success",
                "output": f"Cancelled {count} running task(s)",
                "id": request_id,
            })
            return

        if action == "cancel" and request_id:
            task = conn._running_tasks.pop(request_id, None)
            if task and not task.done():
                task.cancel()
                await self._send(conn, {
                    "type": "success",
                    "output": f"Cancelled task {request_id}",
                    "id": request_id,
                })
            else:
                await self._send(conn, {
                    "type": "error",
                    "output": f"No running task with id {request_id}",
                    "id": request_id,
                })
            return

        # ── Tool call — dispatch concurrently ──────────────────────────────
        tool_name = msg.get("tool")
        tool_input = msg.get("input", {})

        if not tool_name:
            await self._send(conn, {
                "id": request_id,
                "type": "error",
                "output": "Missing 'tool' field in message",
            })
            return

        req_id = request_id or f"auto-{id(msg)}"
        task = asyncio.create_task(self._run_tool(conn, req_id, tool_name, tool_input))
        conn._running_tasks[req_id] = task
        task.add_done_callback(lambda _: conn._running_tasks.pop(req_id, None))

    async def _run_tool(
        self, conn: Connection, request_id: str, tool_name: str, tool_input: dict
    ) -> None:
        try:
            result = await dispatch(tool_name, tool_input, conn.session)

            response: dict = {
                "id": request_id,
                "type": result.type.value,
                "output": result.output,
            }
            if result.image:
                response["image"] = result.image.model_dump()
            if result.metadata:
                response["metadata"] = result.metadata

            await self._send(conn, response)

        except asyncio.CancelledError:
            await self._send(conn, {
                "id": request_id,
                "type": "error",
                "output": f"Task {request_id} was cancelled",
            })

        except Exception as e:
            logger.exception("Unexpected error running tool %s", tool_name)
            await self._send(conn, {
                "id": request_id,
                "type": "error",
                "output": f"Internal error: {type(e).__name__}: {e}",
            })

    async def _send(self, conn: Connection, data: dict) -> None:
        try:
            await conn.websocket.send_json(data)
        except Exception:
            pass

    async def broadcast(self, message: str) -> None:
        for conn in self.connections.values():
            await self._send(conn, {"type": "broadcast", "output": message})

    @property
    def active_count(self) -> int:
        return len(self.connections)
