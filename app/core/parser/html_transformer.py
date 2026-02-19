from __future__ import annotations

import re
from typing import Callable, Optional, Union
from urllib.parse import urlparse

from bs4 import BeautifulSoup


def _get_soup(html: Union[str, BeautifulSoup]) -> BeautifulSoup:
    if isinstance(html, BeautifulSoup):
        return html
    return BeautifulSoup(str(html), "lxml")


class HtmlTransformer:
    def __init__(self, html: Union[str, BeautifulSoup]) -> None:
        self.soup = _get_soup(html)
        self.core_fixers: list[Callable[[], None]] = [
            self.broken_tag_fix,
            self.orphan_li_fixer,
        ]
        self.custom_transformers: list[dict] = []
        self._register_default_transformers()

    def process(self, soup: bool = True) -> Union[str, BeautifulSoup]:
        for fixer in self.core_fixers:
            fixer()
        for transformer in self.custom_transformers:
            transformer["transform_func"](self.soup)
        return self.soup if soup else str(self.soup)

    def register_transformer(
        self,
        name: str,
        transform_func: Callable[..., None],
        tag: Optional[str] = None,
        class_name: Optional[str] = None,
        id: Optional[str] = None,
        selector: Optional[str] = None,
    ) -> None:
        self.custom_transformers.append({"name": name, "selector": selector, "transform_func": transform_func})

    def _register_default_transformers(self) -> None:
        self.register_transformer(name="convert_bsp_carousel", tag="bsp-carousel", transform_func=self._transform_bsp_carousel)
        self.register_transformer(name="transform_content_headers", transform_func=self._transform_content_headers)
        self.register_transformer(name="transform_common_video_iframes", transform_func=self._transform_common_video_iframes)

    def broken_tag_fix(self) -> None:
        try:
            self.soup = BeautifulSoup(str(self.soup), "lxml")
        except Exception:
            pass

    def orphan_li_fixer(self) -> None:
        all_li = self.soup.find_all("li")
        consecutive_orphans: list = []
        for li in all_li:
            if li.parent.name not in ("ul", "ol"):
                consecutive_orphans.append(li)
            else:
                if consecutive_orphans:
                    self._wrap_orphan_li(consecutive_orphans)
                    consecutive_orphans = []
        if consecutive_orphans:
            self._wrap_orphan_li(consecutive_orphans)

    def _wrap_orphan_li(self, li_elements: list) -> None:
        if not li_elements:
            return
        new_ul = self.soup.new_tag("ul")
        li_elements[0].insert_before(new_ul)
        for li in li_elements:
            new_ul.append(li.extract())

    def _transform_bsp_carousel(self, soup: BeautifulSoup) -> None:
        for carousel in soup.select("bsp-carousel"):
            container = soup.new_tag("div")
            container["class"] = "transformed-carousel"
            title_elem = carousel.find("h2", class_="Carousel-title")
            title = title_elem.get("data-override-title", title_elem.get_text(strip=True)) if title_elem else "Untitled Carousel"
            title_p = soup.new_tag("p")
            title_p.string = f"Carousel: {title}"
            container.append(title_p)
            ul = soup.new_tag("ul")
            container.append(ul)
            for slide in carousel.find_all("div", class_="Carousel-slide"):
                desc_elem = slide.find("span", class_="CarouselSlide-infoDescription")
                description = desc_elem.get_text(strip=True) if desc_elem else ""
                picture = slide.find("picture")
                text = description or f"[Slide {slide.get('data-slidenumber', '')}]"
                li = soup.new_tag("li")
                li.append(soup.new_string(text))
                ul.append(li)
                if picture:
                    li2 = soup.new_tag("li")
                    li2.append(picture)
                    ul.append(li2)
            carousel.replace_with(container)

    def _transform_content_headers(self, soup: BeautifulSoup) -> None:
        for header in soup.find_all("header"):
            if self._is_content_header_tag(header):
                content_div = soup.new_tag("div")
                content_div["class"] = "preserved-content"
                content_div["data-original-tag"] = "header"
                for child in list(header.children):
                    content_div.append(child.extract())
                header.replace_with(content_div)

    def _is_content_header_tag(self, header: object) -> bool:
        if header.find(["h1", "h2", "h3"]):  # type: ignore[attr-defined]
            return True
        if header.find("time"):  # type: ignore[attr-defined]
            return True
        nav_elements = header.find_all(["nav", "menu"])  # type: ignore[attr-defined]
        list_elements = header.find_all(["ul", "ol"])  # type: ignore[attr-defined]
        list_with_links = any(len(ul.find_all("a")) > 2 for ul in list_elements)
        if (nav_elements or list_with_links) and not header.find(["h1", "h2", "h3", "time"]):  # type: ignore[attr-defined]
            return False
        return True

    def _transform_common_video_iframes(self, soup: BeautifulSoup) -> None:
        video_patterns = [
            {"domain": "youtube.com", "path_pattern": r"/embed/"},
            {"domain": "youtube-nocookie.com", "path_pattern": r"/embed/"},
            {"domain": "youtube.com", "path_pattern": r"/watch", "param": "v"},
            {"domain": "player.vimeo.com", "path_pattern": r"/video/"},
            {"domain": "vimeo.com", "path_pattern": r"/video/"},
            {"domain": "facebook.com", "path_pattern": r"/plugins/video"},
            {"domain": "dailymotion.com", "path_pattern": r"/embed/video/"},
            {"domain": "player.twitch.tv", "path_pattern": r"/?channel=|/?video="},
            {"domain": "instagram.com", "path_pattern": r"/p/"},
            {"domain": "tiktok.com", "path_pattern": r"/embed"},
            {"domain": "rumble.com", "path_pattern": r"/embed/"},
            {"domain": "ted.com", "path_pattern": r"/talks/embed"},
        ]
        for iframe in soup.find_all("iframe"):
            src_attributes = {
                attr_name: attr_value
                for attr_name, attr_value in iframe.attrs.items()
                if "src" in attr_name.lower() and attr_value
            }
            valid_src = None
            matched_provider = None
            for attr_value in src_attributes.values():
                parsed_url = urlparse(attr_value)
                if parsed_url.scheme in ("http", "https"):
                    domain = parsed_url.netloc
                    path = parsed_url.path
                    for pattern in video_patterns:
                        if pattern["domain"] in domain and re.search(pattern["path_pattern"], path):
                            valid_src = attr_value
                            matched_provider = pattern["domain"].split(".")[0]
                            break
                if valid_src:
                    break
            if valid_src:
                video_tag = soup.new_tag("video")
                if iframe.has_attr("width"):
                    video_tag["width"] = iframe["width"]
                if iframe.has_attr("height"):
                    video_tag["height"] = iframe["height"]
                video_tag["provider"] = matched_provider
                source_tag = soup.new_tag("source")
                source_tag["src"] = valid_src
                source_tag["type"] = "unknown"
                video_tag.append(source_tag)
                iframe.replace_with(video_tag)
