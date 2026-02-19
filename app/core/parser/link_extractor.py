from __future__ import annotations

import os
import re
from typing import Any, Optional
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from app.utils.url import join_url

MEDIA_EXTENSIONS = {
    "images": {"jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "svg", "ico"},
    "videos": {"mp4", "avi", "mov", "mkv", "wmv", "flv", "webm"},
    "audio": {"mp3", "wav", "ogg", "aac", "flac", "wma", "m4a"},
    "documents": {"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt", "rtf", "odt"},
}

ARCHIVE_EXTENSIONS = {"zip", "tar", "gz", "bz2", "7z", "rar", "xz"}


class LinkExtractor:
    def __init__(self, base_url: str, soup: BeautifulSoup) -> None:
        self.base_url = base_url
        self.soup = soup
        parsed = urlparse(base_url)
        self.base_domain = parsed.netloc

    def get_all_links(self) -> dict[str, list[dict[str, str]]]:
        links: dict[str, list[dict[str, str]]] = {
            "internal": [],
            "external": [],
            "others": [],
            "archives": [],
            "images": [],
            "videos": [],
            "audio": [],
            "documents": [],
        }

        seen: set[str] = set()
        for a in self.soup.find_all("a", href=True):
            href = a["href"].strip()
            full_url = join_url(self.base_url, href)
            if not full_url or full_url in seen:
                continue
            seen.add(full_url)

            text = a.get_text(strip=True) or ""
            entry = {"url": full_url, "text": text}

            ext = self._get_extension(full_url)
            category = self._classify_by_extension(ext)
            if category:
                links[category].append(entry)
                continue

            parsed = urlparse(full_url)
            if not parsed.scheme or not parsed.netloc:
                links["others"].append(entry)
            elif parsed.netloc == self.base_domain or parsed.netloc.endswith(f".{self.base_domain}"):
                links["internal"].append(entry)
            else:
                links["external"].append(entry)

        return links

    @staticmethod
    def _get_extension(url: str) -> str:
        path = urlparse(url).path
        ext = os.path.splitext(path)[1].lstrip(".").lower()
        return ext

    @staticmethod
    def _classify_by_extension(ext: str) -> Optional[str]:
        if ext in ARCHIVE_EXTENSIONS:
            return "archives"
        for category, extensions in MEDIA_EXTENSIONS.items():
            if ext in extensions:
                return category
        return None
