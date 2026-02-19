from __future__ import annotations

from collections import defaultdict
from typing import Any, Optional, Union

from pydantic import BaseModel, Field
from tabulate import tabulate

ContentUnion = Union[
    "TextContent",
    "CodeBlock",
    "Quote",
    "ListElement",
    "Table",
    "Header",
    "Image",
    "Audio",
    "Video",
]


class ElementMetadata(BaseModel):
    tag: Optional[str] = None
    attributes: dict[str, Any] = Field(default_factory=dict)
    filtered: bool = False
    filter_details: Optional[dict[str, Any]] = None


class ExtractionSettings:
    def __init__(self, allowed_children: list[str], options: list[str]) -> None:
        self.remove_formatting = "remove_formatting" in options
        self.remove_anchors = "remove_anchors" in options
        self.remove_filtered = "remove_filtered" in options
        self.use_content_format = False
        self.use_data_format = False
        self.organize_content_by_headers = "organize_content_by_headers" in options

        for opt in options:
            if opt == "content":
                self.use_content_format = True
                break
            elif opt == "data":
                self.use_data_format = True
                break

        self.allowed_types: set[str] = set(allowed_children)
        if "paragraph" in self.allowed_types:
            self.allowed_types.discard("paragraph")
            self.allowed_types.add("text")
        if "header_text" in self.allowed_types:
            self.allowed_types.discard("header_text")
            self.allowed_types.add("header")
        if self.organize_content_by_headers:
            self.allowed_types.add("header")


class BaseContent(BaseModel):
    model_config = {"arbitrary_types_allowed": True}

    def to_content(self, settings: ExtractionSettings) -> str:
        raise NotImplementedError

    def to_data(self, settings: ExtractionSettings) -> Any:
        raise NotImplementedError

    def get(self, settings: ExtractionSettings) -> Any:
        if settings.use_data_format:
            return self.to_data(settings)
        return self.to_content(settings)

    def is_allowed(self, settings: ExtractionSettings) -> bool:
        return getattr(self, "type", "") in settings.allowed_types


class TextContent(BaseContent):
    type: str = "text"
    content: str
    metadata: ElementMetadata = Field(default_factory=ElementMetadata)

    def to_content(self, settings: ExtractionSettings) -> str:
        if settings.remove_filtered and self.metadata.filtered:
            return ""
        if settings.remove_anchors:
            return self.content
        return self.metadata.attributes.get("fmt-txt") or self.content

    def to_data(self, settings: ExtractionSettings) -> dict[str, Any]:
        if settings.remove_filtered and self.metadata.filtered:
            return {}
        if settings.remove_anchors:
            return {"type": "text", "content": self.content}
        content = self.metadata.attributes.get("fmt-txt") or self.content
        return {"type": "text", "content": content}


class CodeBlock(BaseContent):
    type: str = "code"
    content: str
    metadata: ElementMetadata = Field(default_factory=ElementMetadata)

    def to_data(self, settings: ExtractionSettings) -> dict[str, Any]:
        if settings.remove_filtered and self.metadata.filtered:
            return {}
        return {"type": "code", "content": self.content}

    def to_content(self, settings: ExtractionSettings) -> str:
        if settings.remove_filtered and self.metadata.filtered:
            return ""
        return f"```\n{self.content}\n```"


class Quote(BaseContent):
    type: str = "quote"
    content: str
    metadata: ElementMetadata = Field(default_factory=ElementMetadata)

    def to_data(self, settings: ExtractionSettings) -> dict[str, Any]:
        if settings.remove_filtered and self.metadata.filtered:
            return {}
        return {"type": "quote", "content": self.content}

    def to_content(self, settings: ExtractionSettings) -> str:
        if settings.remove_filtered and self.metadata.filtered:
            return ""
        return f"\u201c{self.content}\u201d"


class Image(BaseContent):
    type: str = "image"
    src: str
    alt: str = ""
    width: str = ""
    height: str = ""
    title: str = ""
    loading: str = ""
    is_data_url: bool = False
    caption: str = ""
    all_sources: list[str] = Field(default_factory=list)
    metadata: ElementMetadata = Field(default_factory=ElementMetadata)

    def to_data(self, settings: ExtractionSettings) -> dict[str, Any]:
        if settings.remove_filtered and self.metadata.filtered:
            return {}
        return {
            "type": "image",
            "src": self.src,
            "alt": self.alt,
            "width": self.width,
            "height": self.height,
            "title": self.title,
            "caption": self.caption,
            "srcset": list(set(self.all_sources)),
        }

    def to_content(self, settings: ExtractionSettings) -> str:
        if settings.remove_filtered and self.metadata.filtered:
            return ""
        alt_text = ""
        if self.caption and self.caption.strip():
            alt_text = self.caption.strip()
        elif self.alt and self.alt.strip():
            alt_text = self.alt.strip()
        if self.src:
            src = self.src.strip()
            title_text = f' "{alt_text}"' if alt_text else ""
            return f"![{alt_text}]({src}{title_text})"
        return ""


class Audio(BaseContent):
    type: str = "audio"
    src: str
    controls: bool = False
    autoplay: bool = False
    loop: bool = False
    muted: bool = False
    preload: str = ""
    sources: list[dict[str, str]] = Field(default_factory=list)
    tracks: list[dict[str, str]] = Field(default_factory=list)
    metadata: ElementMetadata = Field(default_factory=ElementMetadata)

    def to_data(self, settings: ExtractionSettings) -> dict[str, Any]:
        if settings.remove_filtered and self.metadata.filtered:
            return {}
        return {"type": "audio", "src": self.src, "sources": self.sources, "tracks": self.tracks}

    def to_content(self, settings: ExtractionSettings) -> str:
        if settings.remove_filtered and self.metadata.filtered:
            return ""
        return f"[Audio]({self.src})" if self.src else ""


class Video(BaseContent):
    type: str = "video"
    src: str
    poster: str = ""
    width: str = ""
    height: str = ""
    controls: bool = False
    autoplay: bool = False
    loop: bool = False
    muted: bool = False
    preload: str = ""
    playsinline: bool = False
    sources: list[dict[str, str]] = Field(default_factory=list)
    tracks: list[dict[str, str]] = Field(default_factory=list)
    provider: str = ""
    metadata: ElementMetadata = Field(default_factory=ElementMetadata)

    def to_data(self, settings: ExtractionSettings) -> dict[str, Any]:
        if settings.remove_filtered and self.metadata.filtered:
            return {}
        return {
            "type": "video",
            "src": self.src,
            "poster": self.poster,
            "width": self.width or None,
            "height": self.height or None,
            "sources": self.sources,
            "tracks": self.tracks,
            "provider": self.provider,
        }

    def to_content(self, settings: ExtractionSettings) -> str:
        if settings.remove_filtered and self.metadata.filtered:
            return ""
        if self.provider and self.provider.strip() and self.src:
            provider = self.provider.strip().capitalize()
            return f"[Watch {provider} Video]({self.src.strip()})"
        elif self.src:
            return f"[Watch Video]({self.src.strip()})"
        return ""


class ListElement(BaseContent):
    type: str = "list"
    content: list[Any] = Field(default_factory=list)
    metadata: ElementMetadata = Field(default_factory=ElementMetadata)

    def _flatten_python_list(self, items: list[Any], settings: ExtractionSettings) -> list[str]:
        texts: list[str] = []
        for item in items:
            if isinstance(item, CodeBlock):
                code_content = item.to_content(settings)
                if code_content:
                    texts.append(code_content)
                continue
            if hasattr(item, "to_content"):
                content = item.to_content(settings)
                if content:
                    texts.append(str(content).replace("\n", " ").strip())
            elif isinstance(item, ListElement):
                if settings.remove_filtered and item.metadata.filtered:
                    continue
                texts.extend(self._flatten_python_list(item.content, settings))
            elif isinstance(item, dict):
                t = item.get("type")
                c = item.get("content")
                if t == "text" and isinstance(c, str):
                    texts.append(c.strip())
                elif t == "list" and isinstance(c, list):
                    texts.extend(self._flatten_python_list(c, settings))
                elif isinstance(c, str):
                    texts.append(c.strip())
                elif isinstance(c, list):
                    texts.extend(self._flatten_python_list(c, settings))
            elif isinstance(item, list):
                texts.extend(self._flatten_python_list(item, settings))
        return texts

    def to_data(self, settings: ExtractionSettings) -> dict[str, Any]:
        if settings.remove_filtered and self.metadata.filtered:
            return {}
        return {"type": "list", "content": self._flatten_python_list(self.content, settings), "after": "", "before": ""}

    def to_content(self, settings: ExtractionSettings) -> str:
        if settings.remove_filtered and self.metadata.filtered:
            return ""
        lines = []
        for line in self._flatten_python_list(self.content, settings):
            if settings.remove_formatting:
                lines.append(line)
            else:
                lines.append(f"- {line}")
        return "\n".join(lines)

    def _extract_nested_allowed_content(self, content_items: list[Any], settings: ExtractionSettings) -> list[Any]:
        items: list[Any] = []
        for item in content_items:
            if isinstance(item, list):
                nested = self._extract_nested_allowed_content(item, settings)
                if nested:
                    items.extend(nested)
            elif hasattr(item, "is_allowed") and item.is_allowed(settings) and getattr(item, "type", "") != "text":
                items.append(item)
        return items

    def extract_nested_allowed_data(self, settings: ExtractionSettings) -> list[Any]:
        items = self._extract_nested_allowed_content(self.content, settings)
        return [item.to_data(settings) for item in items]

    def extract_nested_allowed_content(self, settings: ExtractionSettings) -> str:
        items = self._extract_nested_allowed_content(self.content, settings)
        return "\n".join(item.to_content(settings) for item in items)


class Table(BaseContent):
    type: str = "table"
    content: list[dict[str, list[Any]]] = Field(default_factory=list)
    metadata: ElementMetadata = Field(default_factory=ElementMetadata)

    def _flatten_cell_to_text(self, cell_content: Any, settings: ExtractionSettings) -> str:
        result: list[str] = []
        if isinstance(cell_content, TextContent):
            return cell_content.to_content(settings)
        if not isinstance(cell_content, list):
            cell_content = [cell_content]
        for item in cell_content:
            if hasattr(item, "to_content"):
                if settings.remove_filtered and hasattr(item, "metadata") and item.metadata.filtered:
                    continue
                content = item.to_content(settings)
                if content:
                    result.append(str(content).replace("\n", " "))
        return " ".join(result)

    def _flatten_cell_to_data(self, cell_content: Any, settings: ExtractionSettings) -> str:
        result: list[str] = []
        items = cell_content if isinstance(cell_content, list) else [cell_content]
        for item in items:
            if hasattr(item, "to_content"):
                if not settings.remove_filtered and hasattr(item, "metadata") and item.metadata.filtered:
                    continue
                content = item.to_content(settings)
                if content:
                    result.append(str(content))
        return "\n".join(result)

    def to_data(self, settings: ExtractionSettings) -> dict[str, Any]:
        if settings.remove_filtered and self.metadata.filtered:
            return {}
        flattened_rows: list[dict[str, str]] = []
        all_columns: set[str] = set()
        for row in self.content:
            flattened_row: dict[str, str] = {}
            for column, cell_content in row.items():
                flattened_row[column] = self._flatten_cell_to_data(cell_content, settings)
                all_columns.add(column)
            if not any(val.strip() for val in flattened_row.values()):
                continue
            flattened_rows.append(flattened_row)
        normalized = [{col: row.get(col, "") for col in all_columns} for row in flattened_rows]
        return {"type": "table", "rows": normalized, "before": "", "after": ""}

    def to_content(self, settings: ExtractionSettings) -> str:
        if settings.remove_filtered and self.metadata.filtered:
            return ""
        if not self.content:
            return ""
        flattened_rows: list[dict[str, str]] = []
        all_columns: set[str] = set()
        for row in self.content:
            flattened_row: dict[str, str] = {}
            for column, cell_content in row.items():
                flattened_row[column] = self._flatten_cell_to_text(cell_content, settings)
                all_columns.add(column)
            if not any(val.strip() for val in flattened_row.values()):
                continue
            flattened_rows.append(flattened_row)
        normalized = [{col: row.get(col, "") for col in all_columns} for row in flattened_rows]
        fmt = "plain" if settings.remove_formatting else "simple"
        return tabulate(normalized, tablefmt=fmt, headers="keys")

    def _extract_nested_allowed_content(self, settings: ExtractionSettings) -> list[Any]:
        items: list[Any] = []
        for row in self.content:
            for values in row.values():
                for value in values:
                    if hasattr(value, "is_allowed") and value.is_allowed(settings) and getattr(value, "type", "") != "text":
                        items.append(value)
        return items

    def extract_nested_allowed_data(self, settings: ExtractionSettings) -> list[Any]:
        items = self._extract_nested_allowed_content(settings)
        return [item.to_data(settings) for item in items]

    def extract_nested_allowed_content(self, settings: ExtractionSettings) -> str:
        items = self._extract_nested_allowed_content(settings)
        return "\n".join(item.to_content(settings) for item in items)


class Header(BaseContent):
    type: str = "header"
    level: int
    text: str
    content: list[Any] = Field(default_factory=list)
    metadata: ElementMetadata = Field(default_factory=ElementMetadata)

    def _flatten_to_data_lines(self, items: list[Any], settings: ExtractionSettings) -> list[Any]:
        lines: list[Any] = []
        for item in items:
            if not hasattr(item, "is_allowed"):
                continue
            if not item.is_allowed(settings) and getattr(item, "type", "") != "header":
                continue
            if isinstance(item, CodeBlock):
                code = item.to_data(settings)
                if code:
                    lines.append(code)
            elif isinstance(item, ListElement) and "list" not in settings.allowed_types:
                allowed_items = item.extract_nested_allowed_data(settings)
                if allowed_items:
                    lines.extend(allowed_items)
            elif isinstance(item, Table) and "table" not in settings.allowed_types:
                allowed_items = item.extract_nested_allowed_data(settings)
                if allowed_items:
                    lines.extend(allowed_items)
            elif hasattr(item, "to_data"):
                if settings.remove_filtered and hasattr(item, "metadata") and item.metadata.filtered:
                    continue
                content_block = item.to_data(settings)
                if content_block:
                    if isinstance(content_block, list):
                        lines.extend(content_block)
                    else:
                        lines.append(content_block)
            elif isinstance(item, list):
                for sub in item:
                    if hasattr(sub, "to_data"):
                        if settings.remove_filtered and hasattr(sub, "metadata") and sub.metadata.filtered:
                            continue
                        data = sub.to_data(settings)
                        if isinstance(data, list):
                            lines.extend(data)
                        else:
                            lines.append(data)
        return lines

    def _flatten_to_content_lines(self, items: list[Any], settings: ExtractionSettings) -> list[str]:
        lines: list[str] = []
        for item in items:
            if not hasattr(item, "is_allowed"):
                continue
            if not item.is_allowed(settings) and getattr(item, "type", "") != "header":
                continue
            if isinstance(item, CodeBlock):
                code = item.to_content(settings)
                if code:
                    lines.extend(code.splitlines())
            elif isinstance(item, Table) and "table" not in settings.allowed_types:
                allowed_content = item.extract_nested_allowed_content(settings)
                if allowed_content.strip():
                    lines.extend(allowed_content.splitlines())
            elif isinstance(item, ListElement) and "list" not in settings.allowed_types:
                allowed_content = item.extract_nested_allowed_content(settings)
                if allowed_content.strip():
                    lines.extend(allowed_content.splitlines())
            elif hasattr(item, "to_content"):
                if settings.remove_filtered and hasattr(item, "metadata") and item.metadata.filtered:
                    continue
                content_block = item.to_content(settings)
                if content_block:
                    lines.extend(content_block.splitlines())
            elif isinstance(item, list):
                for sub in item:
                    if hasattr(sub, "to_content"):
                        if settings.remove_filtered and hasattr(sub, "metadata") and sub.metadata.filtered:
                            continue
                        data = sub.to_content(settings)
                        if data:
                            lines.extend(data.splitlines())
        return lines

    def to_content(self, settings: ExtractionSettings) -> str:
        if self.level == 0:
            header_line = ""
        elif settings.remove_formatting:
            header_line = self.text
        else:
            header_line = f"{'#' * self.level} {self.text}"

        lines: list[str] = []
        if self.is_allowed(settings):
            if not (settings.remove_filtered and self.metadata.filtered):
                lines.append(header_line)
        header_lines = self._flatten_to_content_lines(self.content, settings)
        if header_lines:
            lines.extend(header_lines)
        return "\n".join(lines)

    def to_data(self, settings: ExtractionSettings) -> list[Any]:
        data_lines: list[Any] = []
        data = {"type": "header", "level": self.level, "content": self.text}
        if self.is_allowed(settings):
            if not (settings.remove_filtered and self.metadata.filtered):
                data_lines.append(data)
        flat_lines = self._flatten_to_data_lines(self.content, settings)
        if flat_lines:
            data_lines.extend(flat_lines)
        return data_lines


class OrganizedData(BaseContent):
    content: list[Any] = Field(default_factory=list)

    def _content_organized_by_headers(self, settings: ExtractionSettings) -> dict[str, str]:
        result: dict[str, str] = {}
        header_counts: dict[str, int] = defaultdict(int)

        def _process(items: list[Any]) -> None:
            for item in items:
                if hasattr(item, "type") and item.type == "header":
                    header_text = item.text
                    header_counts[header_text] += 1
                    header_key = f"{header_text} ({header_counts[header_text]})" if header_counts[header_text] > 1 else header_text
                    result[header_key] = item.to_content(settings)
                    if item.content:
                        _process(item.content)

        _process(self.content)
        return result

    def _extract_content(self, settings: ExtractionSettings) -> Any:
        if settings.organize_content_by_headers:
            return self._content_organized_by_headers(settings)
        regular = [item for item in self.content if not (hasattr(item, "level") and item.level == 0)]
        level_zero = [item for item in self.content if hasattr(item, "level") and item.level == 0]
        lines: list[str] = []
        for item in regular + level_zero:
            item_lines = item.to_content(settings)
            if item_lines:
                lines.extend(item_lines.splitlines())
        return "\n".join(lines)

    def _extract_data(self, settings: ExtractionSettings) -> list[Any]:
        lines: list[Any] = []
        for item in self.content:
            item_lines = item.get(settings)
            if item_lines:
                lines.extend(item_lines)
        return lines

    def _extract_by_rule(self, rule: dict[str, Any]) -> Any:
        settings = ExtractionSettings(rule["allowed_children"], rule["options"])
        if settings.use_data_format:
            return self._extract_data(settings)
        return self._extract_content(settings)

    def extract(self, rules: list[dict[str, Any]]) -> dict[str, Any]:
        output: dict[str, Any] = {}
        for rule in rules:
            output[rule["name"]] = self._extract_by_rule(rule)
        return output
