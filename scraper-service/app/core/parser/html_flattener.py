from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urlparse

from bs4 import BeautifulSoup, Comment, Tag

from app.utils.url import is_data_url, join_url

INLINE_ELEMENTS = {
    "a", "abbr", "acronym", "b", "bdi", "bdo", "big", "br", "button", "cite", "code",
    "data", "datalist", "del", "dfn", "em", "i", "img", "input", "ins", "kbd", "label",
    "map", "mark", "meter", "noscript", "object", "output", "progress", "q", "ruby", "s",
    "samp", "select", "small", "span", "strong", "sub", "sup", "textarea", "time", "u",
    "tt", "var", "wbr", "td", "source",
}

BLOCK_ELEMENTS = {
    "address", "article", "aside", "blockquote", "canvas", "dd", "div", "dl", "dt",
    "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5",
    "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table",
    "ul", "video", "picture", "audio",
}

MEDIA_ELEMENTS = {"img", "video", "audio", "figure", "picture", "embed"}


class HTMLFlattener:
    def __init__(self, soup: object, url: Optional[str] = None) -> None:
        self.url = url
        if isinstance(soup, str):
            self.soup = BeautifulSoup(soup, "lxml")
        elif isinstance(soup, Tag):
            self.soup = soup
        else:
            raise TypeError("Input must be a string or a BeautifulSoup Tag object.")
        self.md_syntax = True

    def process_html(self) -> str:
        self._flatten_element(self.soup)
        return str(self.soup)

    def _flatten_element(self, element: object) -> None:
        for child in list(element.children):  # type: ignore[attr-defined]
            if isinstance(child, Tag):
                if self.is_protected(child):
                    continue
                self._flatten_element(child)
                if child.name in INLINE_ELEMENTS and child.name != "a":
                    if self._has_block_children(child):
                        child.name = "div"
                    else:
                        self._join_inline_children(child)
                if child.name in BLOCK_ELEMENTS:
                    self._join_consecutive_inlines(child)
            elif isinstance(child, Comment):
                continue

    def is_protected(self, element: Tag) -> bool:
        if element.name == "pre":
            return True
        if element.name == "code":
            if len(list(element.descendants)) > 1 and len(element.get_text(strip=True).split(" ")) > 1:
                element.name = "pre"
                return True
            else:
                element.unwrap()
        if element.name in MEDIA_ELEMENTS:
            return True
        if element.name == "span" and "flattened-text" in element.get("class", []):
            return True
        return False

    def _has_block_children(self, element: Tag) -> bool:
        return any(isinstance(child, Tag) and child.name in BLOCK_ELEMENTS for child in element.children)

    def _contains_media(self, element: Tag) -> bool:
        return bool(element.find(lambda tag: isinstance(tag, Tag) and tag.name in MEDIA_ELEMENTS))

    def _join_consecutive_inlines(self, element: Tag) -> None:
        new_children: list = []
        buffer: list[str] = []
        fmt_buffer: list[str] = []

        for child in element.children:
            if isinstance(child, Comment):
                if buffer:
                    self._append_flattened_span(new_children, buffer, fmt_buffer)
                    buffer, fmt_buffer = [], []
                new_children.append(child)
            elif isinstance(child, Tag) and child.name in MEDIA_ELEMENTS:
                if buffer:
                    self._append_flattened_span(new_children, buffer, fmt_buffer)
                    buffer, fmt_buffer = [], []
                new_children.append(child)
            elif isinstance(child, Tag) and child.name == "a" and self.md_syntax and not self._contains_media(child):
                text = child.get_text(strip=True)
                href = child.get("href", "").strip()
                complete_url = join_url(self.url, href)
                data_url, _ = is_data_url(url=complete_url)
                is_readable = self._is_readable_url(url=complete_url)
                if text and href and not data_url and is_readable:
                    buffer.append(text)
                    fmt_buffer.append(f"[{text}]({complete_url})")
                else:
                    plain_text = child.get_text(separator=" ", strip=True)
                    buffer.append(plain_text)
                    fmt_buffer.append(plain_text)
            elif isinstance(child, Tag) and child.name in INLINE_ELEMENTS:
                if self.is_protected(child) or self._contains_media(child):
                    if buffer:
                        self._append_flattened_span(new_children, buffer, fmt_buffer)
                        buffer, fmt_buffer = [], []
                    new_children.append(child)
                else:
                    text = child.get_text(separator=" ", strip=True)
                    buffer.append(text)
                    fmt_buffer.append(text)
            elif isinstance(child, str):
                stripped = child.strip()
                if stripped:
                    buffer.append(stripped)
                    fmt_buffer.append(stripped)
            else:
                if buffer:
                    self._append_flattened_span(new_children, buffer, fmt_buffer)
                    buffer, fmt_buffer = [], []
                new_children.append(child)

        if buffer:
            self._append_flattened_span(new_children, buffer, fmt_buffer)
        element.clear()
        for c in new_children:
            element.append(c)

    def _join_inline_children(self, element: Tag) -> None:
        new_children: list = []
        buffer: list[str] = []
        fmt_buffer: list[str] = []

        for child in element.children:
            if isinstance(child, Comment):
                if buffer:
                    self._append_flattened_span(new_children, buffer, fmt_buffer)
                    buffer, fmt_buffer = [], []
                new_children.append(child)
            elif isinstance(child, Tag) and child.name in MEDIA_ELEMENTS:
                if buffer:
                    self._append_flattened_span(new_children, buffer, fmt_buffer)
                    buffer, fmt_buffer = [], []
                new_children.append(child)
            elif isinstance(child, Tag) and child.name == "a" and self.md_syntax and not self._contains_media(child):
                text = child.get_text(strip=True)
                href = child.get("href", "")
                complete_url = join_url(self.url, href)
                data_url, _ = is_data_url(url=complete_url)
                is_readable = self._is_readable_url(url=complete_url)
                if text and href and not data_url and is_readable:
                    buffer.append(text)
                    fmt_buffer.append(f"[{text}]({complete_url})")
                else:
                    plain_text = child.get_text(separator=" ", strip=True)
                    buffer.append(plain_text)
                    fmt_buffer.append(plain_text)
            elif isinstance(child, Tag) and child.name in INLINE_ELEMENTS:
                if self.is_protected(child) or self._contains_media(child):
                    if buffer:
                        self._append_flattened_span(new_children, buffer, fmt_buffer)
                        buffer, fmt_buffer = [], []
                    new_children.append(child)
                else:
                    text = child.get_text(separator=" ", strip=True)
                    buffer.append(text)
                    fmt_buffer.append(text)
            elif isinstance(child, str):
                stripped = child.strip()
                if stripped:
                    buffer.append(stripped)
                    fmt_buffer.append(stripped)
            else:
                if buffer:
                    self._append_flattened_span(new_children, buffer, fmt_buffer)
                    buffer, fmt_buffer = [], []
                new_children.append(child)

        if buffer:
            self._append_flattened_span(new_children, buffer, fmt_buffer)
        element.clear()
        for c in new_children:
            element.append(c)

    def _append_flattened_span(self, new_children: list, buffer: list[str], fmt_buffer: list[str]) -> None:
        concatenated = " ".join(filter(None, buffer))
        fmt_concatenated = " ".join(filter(None, fmt_buffer))
        if concatenated:
            span = self.soup.new_tag("span", attrs={"class": "flattened-text", "fmt-txt": fmt_concatenated})
            span.string = concatenated
            new_children.append(span)

    @staticmethod
    def _is_readable_url(url: Optional[str]) -> bool:
        if not url or not isinstance(url, str):
            return False
        url = url.strip()
        if re.match(r"^javascript:", url, re.IGNORECASE):
            return False
        if re.match(r"^data:", url, re.IGNORECASE):
            return False
        if re.match(r"^tel:", url, re.IGNORECASE):
            return True
        if re.match(r"^mailto:", url, re.IGNORECASE):
            return True
        try:
            parsed = urlparse(url)
            if not parsed.scheme or not parsed.netloc:
                return False
            return parsed.scheme.lower() in ("http", "https", "ftp", "ftps")
        except Exception:
            return False
