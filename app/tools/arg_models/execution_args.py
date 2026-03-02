from __future__ import annotations

from pydantic import BaseModel, Field


class BashArgs(BaseModel):
    command: str = Field(description="Shell command to execute.")
    description: str | None = Field(
        default=None,
        description="Optional human-readable label for what this command does.",
    )
    timeout: int | None = Field(
        default=None,
        description="Timeout in milliseconds (default 120000, max 600000).",
    )
    run_in_background: bool = Field(
        default=False,
        description=(
            "If true, start the command in the background and return immediately "
            "with a bash_id. Use BashOutput to read its output."
        ),
    )


class BashOutputArgs(BaseModel):
    bash_id: str = Field(
        description="The bash_id returned by Bash when run_in_background=true."
    )
    filter: str | None = Field(
        default=None,
        description="Optional substring to filter output lines.",
    )


class TaskStopArgs(BaseModel):
    task_id: str = Field(description="The bash_id of the background task to stop.")
