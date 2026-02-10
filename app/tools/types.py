"""Shared types for the tool system — result models and data structures."""

from __future__ import annotations

import enum
from typing import Any

from pydantic import BaseModel, Field


class ToolResultType(str, enum.Enum):
    SUCCESS = "success"
    ERROR = "error"


class ImageData(BaseModel):
    media_type: str = Field(description="MIME type, e.g. 'image/png'")
    base64_data: str = Field(description="Raw base64-encoded image bytes")


class ToolResult(BaseModel):
    type: ToolResultType = ToolResultType.SUCCESS
    output: str = ""
    image: ImageData | None = None
    metadata: dict[str, Any] | None = None
