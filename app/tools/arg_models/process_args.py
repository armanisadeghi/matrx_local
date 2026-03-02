from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ListProcessesArgs(BaseModel):
    filter: str | None = Field(
        default=None,
        description="Optional substring filter applied to process names.",
    )
    sort_by: Literal["cpu", "memory", "name", "pid"] = Field(
        default="cpu",
        description="Column to sort results by.",
    )
    limit: int = Field(
        default=50,
        ge=1,
        le=500,
        description="Maximum number of processes to return.",
    )


class ListPortsArgs(BaseModel):
    filter: str | None = Field(
        default=None,
        description="Optional substring filter on process name or port number.",
    )
    limit: int = Field(
        default=100,
        ge=1,
        le=500,
        description="Maximum number of ports to return.",
    )


class LaunchAppArgs(BaseModel):
    application: str = Field(
        description=(
            "Application name (e.g. 'Calculator', 'notepad') or full executable path."
        )
    )
    args: list[str] | None = Field(
        default=None,
        description="Optional list of command-line arguments to pass to the application.",
    )
    wait: bool = Field(
        default=False,
        description="If true, block until the application exits (up to timeout seconds).",
    )
    timeout: int = Field(
        default=30,
        ge=1,
        le=300,
        description="Seconds to wait when wait=true.",
    )


class KillProcessArgs(BaseModel):
    pid: int | None = Field(
        default=None,
        description="Process ID to terminate. Either pid or name must be provided.",
    )
    name: str | None = Field(
        default=None,
        description="Process name to terminate (kills all matching processes).",
    )
    force: bool = Field(
        default=False,
        description="If true, send SIGKILL instead of SIGTERM (cannot be caught).",
    )


class FocusAppArgs(BaseModel):
    application: str = Field(
        description=(
            "Application name to bring to the foreground "
            "(e.g. 'Finder', 'notepad', 'chrome')."
        )
    )
