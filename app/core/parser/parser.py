from __future__ import annotations

import logging
from typing import Any, Optional

from bs4 import BeautifulSoup

from app.core.parser.element_extractor import ElementExtractor
from app.core.parser.extraction_rules import rules as default_rules
from app.core.parser.html_transformer import HtmlTransformer, _get_soup
from app.core.parser.link_extractor import LinkExtractor
from app.core.parser.overrides import overrides as default_overrides
from app.core.parser.scrape_filter import ScrapeFilter
from app.models.enums import OutputMode
from app.utils.url import get_url_info

logger = logging.getLogger(__name__)


class ParseResult:
    __slots__ = (
        "overview", "organized_data", "structured_data", "text_data",
        "main_image", "hashes", "links", "content_filter_removal_details",
        "ai_research_content",
    )

    def __init__(self) -> None:
        self.overview: Optional[dict[str, Any]] = None
        self.organized_data: Any = None
        self.structured_data: Optional[dict[str, Any]] = None
        self.text_data: Optional[str] = None
        self.main_image: Optional[str] = None
        self.hashes: Optional[list[str]] = None
        self.links: Optional[dict[str, Any]] = None
        self.content_filter_removal_details: Optional[list[dict[str, Any]]] = None
        self.ai_research_content: Optional[str] = None


class UnifiedParser:
    def __init__(self) -> None:
        self.element_extractor = ElementExtractor()
        self.scrape_filter = ScrapeFilter()

    def parse(
        self,
        html: str,
        url: Optional[str] = None,
        output_mode: OutputMode = OutputMode.RICH,
        content_filter_config: Optional[list[dict[str, Any]]] = None,
        main_content_config: Optional[list[str]] = None,
    ) -> ParseResult:
        result = ParseResult()
        soup = _get_soup(html)

        transformer = HtmlTransformer(soup)
        soup = transformer.process()

        self._filter_unwanted_tags(soup)

        filter_overrides = content_filter_config or default_overrides
        filtered_soup = self.scrape_filter.filter_soup(
            soup,
            remove=False,
            content_filter_config=filter_overrides,
            main_content_config=main_content_config or [],
        )

        if output_mode == OutputMode.RICH:
            clean_soup, removal_details = self._remove_and_extract_content(filtered_soup)
            result.content_filter_removal_details = removal_details

            extracted = self.element_extractor.extract_content(clean_soup, url=url)

            organized_data = extracted["organized_data"]
            metadata_counts = extracted["metadata"]
            result.hashes = extracted["hashes"]
            result.organized_data = organized_data

            extracted_rules = organized_data.extract(rules=default_rules)
            result.text_data = extracted_rules.get("markdown_renderable", "")
            result.ai_research_content = extracted_rules.get("ai_research_content", "")

            if url:
                url_info = get_url_info(url)
                meta_tags = self._extract_meta_tags(soup)
                main_image = self._extract_main_image(meta_tags)
                title_tag = soup.find("title")
                page_title = title_tag.get_text(strip=True) if title_tag else ""
                links = LinkExtractor(base_url=url, soup=soup).get_all_links()
                result.links = links
                result.main_image = main_image

                table_count = metadata_counts.get("table_count", 0) or 0
                code_block_count = metadata_counts.get("code_block_count", 0) or 0
                list_count = metadata_counts.get("list_count", 0) or 0
                text_data = result.text_data or ""

                result.overview = {
                    "website": url_info.website,
                    "url": url_info.url,
                    "unique_page_name": url_info.unique_page_name,
                    "page_title": page_title,
                    "has_structured_content": any((list_count, table_count, code_block_count)),
                    "table_count": table_count,
                    "code_block_count": code_block_count,
                    "list_count": list_count,
                    "char_count": len(text_data),
                }

        elif output_mode == OutputMode.RESEARCH:
            extracted = self.element_extractor.extract_content(filtered_soup, url=url)
            organized_data = extracted["organized_data"]
            extracted_rules = organized_data.extract(rules=default_rules)
            result.ai_research_content = extracted_rules.get("ai_research_content", "")
            result.hashes = extracted["hashes"]

        return result

    @staticmethod
    def _filter_unwanted_tags(soup: BeautifulSoup) -> None:
        for tag_name in ("script", "head", "link", "style", "svg", "noscript"):
            for tag in soup.find_all(tag_name):
                tag.decompose()

    @staticmethod
    def _remove_and_extract_content(soup: BeautifulSoup) -> tuple[BeautifulSoup, list[dict[str, Any]]]:
        removal_info: list[dict[str, Any]] = []
        for element in soup.find_all("ContentFilter"):
            if element.name:
                removal_info.append({
                    "attribute": element.get("type"),
                    "match_type": element.get("match_type"),
                    "trigger_value": element.get("trigger_item"),
                    "text": element.get_text(strip=True),
                    "html_length": len(str(element)),
                })
                element.decompose()
        return soup, removal_info

    @staticmethod
    def _extract_meta_tags(soup: BeautifulSoup) -> dict[str, Any]:
        meta_dict: dict[str, Any] = {}
        for meta in soup.find_all("meta"):
            meta_key = meta.get("name", meta.get("property"))
            if not meta_key:
                meta_key = "unknown"
            content = meta.get("content", "").strip()
            if meta_key in meta_dict:
                existing = meta_dict[meta_key]
                if isinstance(existing, list):
                    existing.append(content)
                else:
                    meta_dict[meta_key] = [existing, content]
            else:
                meta_dict[meta_key] = content
        return meta_dict

    @staticmethod
    def _extract_main_image(meta_tags: dict[str, Any]) -> Optional[str]:
        for key in ("og:image", "twitter:image", "image", "thumbnail", "msapplication-TileImage"):
            if key in meta_tags:
                val = meta_tags[key]
                return val[0] if isinstance(val, list) else val
        return None
