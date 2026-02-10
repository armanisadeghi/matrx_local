"""ToolSession — mutable state shared across tool calls within a connection."""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class BackgroundShell:
    shell_id: str
    process: asyncio.subprocess.Process
    output_buffer: list[str] = field(default_factory=list)
    read_offset: int = 0
    is_complete: bool = False
    return_code: int | None = None


class ToolSession:
    """Tracks mutable state across tool calls for a single connected client.

    Each WebSocket or long-lived HTTP session gets its own ToolSession so
    working directory, background processes, and file-read history persist
    across sequential tool invocations.
    """

    def __init__(self, working_dir: str | None = None) -> None:
        self.cwd: str = working_dir or str(Path.home())
        self.files_read: set[str] = set()
        self.background_shells: dict[str, BackgroundShell] = {}
        self._shell_counter: int = 0

    def mark_file_read(self, path: str) -> None:
        self.files_read.add(os.path.realpath(path))

    def has_read_file(self, path: str) -> bool:
        return os.path.realpath(path) in self.files_read

    def next_shell_id(self) -> str:
        self._shell_counter += 1
        return f"shell_{self._shell_counter}"

    def resolve_path(self, path: str) -> str:
        if os.path.isabs(path):
            return path
        return os.path.join(self.cwd, path)

    async def cleanup(self) -> None:
        for shell in self.background_shells.values():
            if not shell.is_complete:
                try:
                    shell.process.kill()
                except ProcessLookupError:
                    pass
