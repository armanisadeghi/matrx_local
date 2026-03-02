from __future__ import annotations

from pydantic import BaseModel, Field


class AppleScriptArgs(BaseModel):
    script: str = Field(
        description=(
            "AppleScript code to execute (macOS only). "
            "Can control Finder, Mail, Calendar, Safari, and any scriptable app."
        )
    )
    timeout: int = Field(
        default=30,
        ge=1,
        le=300,
        description="Seconds before the script is forcefully terminated.",
    )


class PowerShellScriptArgs(BaseModel):
    script: str = Field(
        description=(
            "PowerShell script to execute (Windows only). "
            "Has access to COM, WMI, .NET APIs, and registry."
        )
    )
    timeout: int = Field(
        default=30,
        ge=1,
        le=300,
        description="Seconds before the script is forcefully terminated.",
    )


class GetInstalledAppsArgs(BaseModel):
    filter: str | None = Field(
        default=None,
        description="Optional substring filter applied to application names.",
    )


# ── Document tools ────────────────────────────────────────────────────────────

class ListDocumentsArgs(BaseModel):
    folder: str | None = Field(
        default=None,
        description="Folder name to filter by. Lists all documents if omitted.",
    )


class ReadDocumentArgs(BaseModel):
    file_path: str | None = Field(
        default=None,
        description="Absolute path to the document file.",
    )
    folder: str | None = Field(
        default=None,
        description="Folder name. Used together with label to locate the document.",
    )
    label: str | None = Field(
        default=None,
        description="Document label/title. Used together with folder to locate the document.",
    )


class WriteDocumentArgs(BaseModel):
    label: str = Field(description="Document title (used as file name).")
    content: str = Field(description="Markdown content to write.")
    folder: str = Field(
        default="General",
        description="Folder to save the document in.",
    )


class SearchDocumentsArgs(BaseModel):
    query: str = Field(description="Search string to look for across all document contents.")


class ListDocumentFoldersArgs(BaseModel):
    pass  # no parameters
