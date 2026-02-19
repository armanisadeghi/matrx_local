from __future__ import annotations

from typing import Any

rules: list[dict[str, Any]] = [
    {
        "name": "ai_content",
        "allowed_children": ["table", "list", "code", "quote", "header", "text"],
        "options": ["content", "remove_filtered", "remove_anchors", "remove_formatting"],
    },
    {
        "name": "ai_research_content",
        "allowed_children": ["header", "text", "table", "list", "quote"],
        "options": ["content", "remove_formatting", "remove_filtered"],
    },
    {
        "name": "ai_research_with_images",
        "allowed_children": ["header", "text", "table", "list", "quote", "image", "video"],
        "options": ["content", "remove_formatting", "remove_filtered"],
    },
    {
        "name": "markdown_renderable",
        "allowed_children": ["text", "table", "list", "code", "quote", "image", "video", "header", "audio"],
        "options": ["content", "remove_filtered"],
    },
    {
        "name": "organized_data",
        "allowed_children": ["text", "table", "list", "code", "quote", "image", "video", "header", "audio"],
        "options": ["data", "remove_filtered", "remove_anchors"],
    },
    {
        "name": "markdown_renderable_by_header",
        "allowed_children": ["text", "table", "list", "code", "quote", "image", "video", "header", "audio"],
        "options": ["content", "remove_filtered", "organize_content_by_headers"],
    },
    {
        "name": "tables",
        "allowed_children": ["table"],
        "options": ["data", "remove_filtered"],
    },
    {
        "name": "code_blocks",
        "allowed_children": ["code"],
        "options": ["data", "remove_filtered"],
    },
    {
        "name": "lists",
        "allowed_children": ["list"],
        "options": ["data", "remove_filtered"],
    },
    {
        "name": "images",
        "allowed_children": ["image"],
        "options": ["data", "remove_filtered"],
    },
    {
        "name": "videos",
        "allowed_children": ["video"],
        "options": ["data", "remove_filtered"],
    },
    {
        "name": "audios",
        "allowed_children": ["audio"],
        "options": ["data", "remove_filtered"],
    },
    {
        "name": "document_outline",
        "allowed_children": ["header"],
        "options": ["data", "remove_filtered", "remove_formatting"],
    },
]
