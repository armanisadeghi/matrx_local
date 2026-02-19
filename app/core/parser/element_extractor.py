from __future__ import annotations

import logging
import re
from collections import Counter, defaultdict
from typing import Any, Optional, Union

from bs4 import BeautifulSoup, Comment, NavigableString, Tag
from markdownify import markdownify as md

from app.core.parser.data_types import (
    Audio,
    BaseContent,
    CodeBlock,
    ContentUnion,
    ElementMetadata,
    Header,
    Image,
    ListElement,
    OrganizedData,
    Quote,
    Table,
    TextContent,
    Video,
)
from app.core.parser.domain_filter import DomainFilter
from app.core.parser.html_flattener import HTMLFlattener
from app.utils.url import is_data_url, join_url

logger = logging.getLogger(__name__)


class ElementExtractor:
    def __init__(self) -> None:
        self.url: Optional[str] = None
        self.hashes: list[str] = []
        self.metadata: dict[str, int] = defaultdict(int)
        self.skip_empty_clicks = True
        self.domain_filter = DomainFilter(list_keys="easylist")
        self.organized_data: Optional[OrganizedData] = None
        self.header_stack: Optional[list[Union[OrganizedData, Header]]] = None

    def _create_metadata(self, element: Union[Tag, NavigableString]) -> ElementMetadata:
        filtered_parent = element.find_parent(["ContentFilter", "contentfilter"])
        if filtered_parent:
            if isinstance(element, Tag):
                attr_name = filtered_parent.get("type")
                match_type = filtered_parent.get("match_type")
                trigger_item = filtered_parent.get("trigger_item")
            else:
                attr_name = match_type = trigger_item = None
            removal_details = {"attr": attr_name, "match": match_type, "value": trigger_item}
        else:
            removal_details = None

        kwargs: dict[str, Any] = {"filtered": bool(filtered_parent), "filter_details": removal_details}

        if isinstance(element, NavigableString):
            return ElementMetadata(tag=None, attributes={}, **kwargs)
        if isinstance(element, Tag):
            return ElementMetadata(tag=element.name, attributes=dict(element.attrs), **kwargs)
        return ElementMetadata(**kwargs)

    def _has_element_children(self, element: Tag) -> bool:
        return any(child for child in element.children if child.name is not None)

    def _get_clean_html(self, main_content: object) -> BeautifulSoup:
        flattened_html = HTMLFlattener(main_content, url=self.url).process_html()
        return BeautifulSoup(re.sub(r"<!--.*?-->", "", flattened_html, flags=re.DOTALL), "lxml")

    def _add_content(self, content_item: Optional[Any]) -> None:
        if content_item and self.header_stack:
            if isinstance(content_item, list):
                self.header_stack[-1].content.extend(c for c in content_item if c)
            else:
                self.header_stack[-1].content.append(content_item)

    def _increment_metadata_count(self, content_type: str) -> None:
        if content_type in ("Lists", "Ordered Lists", "ul", "ol"):
            self.metadata["list_count"] += 1
        elif content_type == "Table":
            self.metadata["table_count"] += 1
        elif content_type == "code":
            self.metadata["code_block_count"] += 1

    def extract_content(
        self,
        main_content: Any,
        clean: bool = True,
        url: Optional[str] = None,
    ) -> dict[str, Any]:
        self.url = url
        self.metadata = defaultdict(int)
        self.hashes = []
        self.organized_data = OrganizedData()

        unassociated_header = Header(level=0, text="unassociated", content=[], metadata=ElementMetadata())
        self.organized_data.content.append(unassociated_header)
        self.header_stack = [self.organized_data, unassociated_header]

        if main_content:
            if clean:
                main_content = self._get_clean_html(main_content)
            self._extract_from_element(main_content, add=True)

        return {
            "organized_data": self.organized_data,
            "metadata": dict(self.metadata),
            "hashes": self.hashes,
        }

    def _extract_from_element(self, element: Tag, add: bool = True) -> list[Any]:
        if element.name == "table":
            try:
                result = self._handle_tables(element, add)
                return [result] if result else []
            except Exception:
                pass

        items: list[Any] = []
        for child in element.children:
            content = self._process_child(child, add)
            if content:
                items.append(content)
        return items

    def _process_child(self, child: Any, add: bool = True) -> Any:
        if isinstance(child, Comment):
            return None
        if isinstance(child, NavigableString):
            return self._handle_navigable_string(child, add)

        handler_map = {
            "figure": self._parse_figure,
            "img": self._parse_img,
            "picture": self._parse_picture,
            "audio": self._parse_audio,
            "video": self._parse_video,
            "dynamic-content": self._handle_dynamic_content,
            "pre": self._handle_code,
            "code": self._handle_code,
            "blockquote": self._handle_blockquote,
            "ul": self._extract_lists,
            "ol": self._extract_lists,
            "table": self._handle_tables,
            "p": self._handle_p,
            "span": self._handle_p,
            "a": self._handle_a,
            "th": self._handle_th,
        }

        if child.name in handler_map:
            return handler_map[child.name](child, add)
        elif child.name and child.name.startswith("h") and child.name[1:].isdigit():
            return self._handle_header(child)
        else:
            return self._extract_from_element(child, add)

    def _handle_dynamic_content(self, element: Tag, add: bool = True) -> Any:
        text_content = str(element.get("data-click-name")).strip()
        if not text_content and self.skip_empty_clicks:
            return None
        collected: list[Any] = []
        metadata = self._create_metadata(element)
        click_text = TextContent(content=f"[{text_content} : Clicked Item]", metadata=metadata)
        if add:
            self._add_content(click_text)
        else:
            collected.append(click_text)
        if self._has_element_children(element):
            children = self._extract_from_element(element, add=add)
            if not add and children:
                collected.extend(children)
        return collected if not add else None

    def _handle_blockquote(self, element: Tag, add: bool = True) -> Any:
        if self._has_element_children(element):
            return self._extract_from_element(element, add)
        metadata = self._create_metadata(element)
        text = element.get_text().strip()
        quote_obj = Quote(content=text, metadata=metadata)
        if add:
            self._add_content(quote_obj)
        return quote_obj

    def _handle_navigable_string(self, child: NavigableString, add: bool = True) -> Optional[TextContent]:
        if child.parent.name == "[document]":
            return None
        text = " ".join(child.strip().split())
        if not text:
            return None
        metadata = self._create_metadata(child)
        text_obj = TextContent(content=text, metadata=metadata)
        if add:
            self._add_content(text_obj)
            return None
        return text_obj

    def _handle_code(self, element: Tag, add: bool = True) -> Optional[CodeBlock]:
        self._increment_metadata_count("code")
        rendered_code = md(str(element)).strip().lstrip("`").rstrip("`")
        if not rendered_code:
            return None
        metadata = self._create_metadata(element)
        code_obj = CodeBlock(content=rendered_code, metadata=metadata)
        if add:
            self._add_content(code_obj)
            return None
        return code_obj

    def _handle_th(self, element: Tag, add: bool = True) -> Any:
        if self._has_element_children(element):
            return self._extract_from_element(element, add)
        text = element.get_text(strip=True)
        if not text:
            return None
        metadata = self._create_metadata(element)
        text_obj = TextContent(content=text, metadata=metadata)
        if add:
            self._add_content(text_obj)
            return None
        return text_obj

    def _handle_p(self, element: Tag, add: bool = True) -> Any:
        if self._has_element_children(element):
            return self._extract_from_element(element, add)
        text = element.get_text(strip=True)
        if not text:
            return None
        metadata = self._create_metadata(element)
        text_obj = TextContent(content=text, metadata=metadata)
        if add:
            self._add_content(text_obj)
            return None
        return text_obj

    def _handle_a(self, element: Tag, add: bool = True) -> Any:
        if self._has_element_children(element):
            return self._extract_from_element(element, add)
        text = element.get_text(strip=True)
        if not text:
            return None
        metadata = self._create_metadata(element)
        text_obj = TextContent(content=text, metadata=metadata)
        if add:
            self._add_content(text_obj)
            return None
        return text_obj

    def _handle_header(self, element: Tag) -> None:
        text = self._normalize_text(element.get_text().strip())
        if not text:
            return None
        level = int(element.name[1:])
        metadata = self._create_metadata(element)
        new_header = Header(level=level, text=text, content=[], metadata=metadata)

        if (
            len(self.header_stack) > 1
            and isinstance(self.header_stack[-1], Header)
            and self.header_stack[-1].level == 0
        ):
            self.header_stack.pop()

        while isinstance(self.header_stack[-1], Header) and self.header_stack[-1].level >= new_header.level:
            self.header_stack.pop()

        parent = self.header_stack[-1]
        parent.content.append(new_header)
        self.header_stack.append(new_header)
        return None

    def _table_has_consistent_columns(self, table_element: Tag) -> bool:
        rows = table_element.find_all("tr")
        if len(rows) < 2:
            return False
        column_counts = [len(row.find_all(recursive=False)) for row in rows]
        counts = Counter(column_counts)
        most_common_freq = counts.most_common(1)[0][1]
        return most_common_freq >= 0.9 * len(column_counts)

    def _is_table_one_column_layout(self, table_element: Tag) -> bool:
        all_rows = table_element.find_all("tr")
        current_rows = [tr for tr in all_rows if tr.find_parent("table") == table_element]
        col_counts = {len(list(tr.children)) for tr in current_rows}
        return len(col_counts) == 1 and 1 in col_counts

    def _is_data_table(self, table_element: Tag) -> tuple[bool, str]:
        if table_element.find("table"):
            return False, "Nested tables — layout table."
        role = table_element.get("role")
        if role == "presentation":
            return False, "Presentation role."
        if role == "table":
            return True, "Table role."

        def belongs(el: Tag) -> bool:
            return el.find_parent("table") == table_element

        if self._is_table_one_column_layout(table_element):
            return False, "Single-column layout."
        if table_element.find_all(lambda tag: tag.name == "th" and belongs(tag)):
            return True, "Has <th> elements."
        if table_element.find(lambda tag: tag.name == "thead" and belongs(tag)):
            return True, "Has <thead>."
        if table_element.find(lambda tag: tag.name == "caption" and belongs(tag)):
            return True, "Has <caption>."
        if table_element.get("border") == "1":
            return True, "Has border=1."
        if self._table_has_consistent_columns(table_element):
            return True, "Consistent columns."
        return False, "No data table indicators."

    def _handle_tables(self, table_element: Tag, add: bool = True) -> Any:
        is_valid, _ = self._is_data_table(table_element)
        if is_valid:
            return self._extract_tables(table_element, add=add)
        table_element.name = "div"
        return self._extract_from_element(table_element, add=add)

    def _extract_table_cell_content(self, cell: Tag, add: bool) -> Any:
        contents = self._extract_from_element(cell, add=add)
        if contents:
            if len(contents) == 1 and isinstance(contents[0], list):
                return contents[0]
            return contents
        return None

    def _extract_tables(self, element: Tag, add: bool = True) -> Optional[Table]:
        def flatten_to_items(obj: Any) -> list[Any]:
            result: list[Any] = []

            def recurse(value: Any) -> None:
                if isinstance(value, BaseContent):
                    result.append(value)
                elif isinstance(value, list):
                    for item in value:
                        recurse(item)

            recurse(obj)
            return result

        self._increment_metadata_count("Table")

        headers: list[str] = []
        thead = element.find("thead")
        first_row = element.find("tr")

        if thead:
            headers = [th.get_text(strip=True) for th in thead.find_all("th")]
            skip_first_row = True
        elif first_row and all(th.name == "th" for th in first_row.find_all(recursive=False)):
            headers = [th.get_text(strip=True) for th in first_row.find_all("th")]
            skip_first_row = True
        else:
            first_data_row = first_row.find_all(recursive=False) if first_row else []
            headers = [f"col{i + 1}" for i in range(len(first_data_row))]
            skip_first_row = False

        max_columns = max((len(row.find_all(recursive=False)) for row in element.find_all("tr")), default=0)
        if len(headers) < max_columns:
            headers.extend(f"col{i + 1}" for i in range(len(headers), max_columns))

        data: list[dict[str, list[Any]]] = []
        rows = element.find_all("tr")
        for row in rows[(1 if skip_first_row else 0):]:
            row_data: dict[str, list[Any]] = {}
            cells = row.find_all(recursive=False)
            for i, cell in enumerate(cells):
                if i >= len(headers):
                    break
                if cell.name not in ("td", "th"):
                    cell_content = self._extract_table_cell_content(cell, add=False)
                    cell_content = flatten_to_items(cell_content)
                    row_data[headers[i]] = cell_content if len(cell_content) > 1 else (cell_content if cell_content else [])
                else:
                    cell_text = TextContent(
                        content=cell.get_text(separator="\n", strip=True),
                        metadata=self._create_metadata(cell),
                    )
                    row_data[headers[i]] = [cell_text]
            data.append(row_data)

        metadata = self._create_metadata(element)
        table_obj = Table(content=data, metadata=metadata)
        if add:
            self._add_content(table_obj)
            return None
        return table_obj

    def _extract_lists(self, element: Tag, add: bool = True) -> ListElement:
        def parse_list(ele: Tag) -> list[Any]:
            items: list[Any] = []
            for li in ele.find_all(recursive=False):
                if not self._has_element_children(li):
                    li_metadata = self._create_metadata(li)
                    li_content = TextContent(content=li.get_text(strip=True), metadata=li_metadata)
                    _add_items(li_content, items)
                    continue
                item_content: list[Any] = []
                for part in li.children:
                    if part.name not in ("ul", "ol"):
                        contents = self._process_child(part, add=False)
                        if contents:
                            _add_items(contents, item_content)
                    elif part.name in ("ul", "ol"):
                        nested = parse_list(part)
                        if nested:
                            _add_items(nested, item_content)
                if item_content:
                    _add_items(item_content, items)
            return items

        def normalize_lists(obj: Any) -> Any:
            if isinstance(obj, list):
                flattened = [normalize_lists(el) for el in obj]
                while len(flattened) == 1 and isinstance(flattened[0], list):
                    flattened = [normalize_lists(el) for el in flattened[0]]
                return flattened
            return obj

        def _add_items(content: Any, items: list[Any]) -> None:
            if isinstance(content, list) and len(content) == 1:
                items.extend(content)
            elif isinstance(content, list):
                items.append(content)
            elif isinstance(content, str) and content.strip():
                items.append(content)
            elif not isinstance(content, str):
                items.append(content)

        list_items = parse_list(element)
        metadata = self._create_metadata(element)
        list_obj = ListElement(content=list_items, metadata=metadata)
        list_obj.content = normalize_lists(list_obj.content)
        if add:
            self._add_content(list_obj)
        return list_obj

    def _normalize_text(self, text: str) -> str:
        if text and text.strip():
            return "  ".join(text.split("\n")).strip()
        return ""

    def _is_tracking_pixel(self, src: str) -> bool:
        if not src:
            return False
        is_data, is_base_64 = is_data_url(src)
        if is_data and is_base_64:
            tracking_pattern = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8"
            return tracking_pattern in src
        return False

    def _parse_img(self, element: Tag, add: bool = True) -> Optional[Image]:
        source_attrs = ["src", "data-src", "data-lazy", "data-original", "data-lazy-src",
                        "data-original-src", "data-url", "data-hi-res-src", "data-full-src",
                        "lazy-src", "nitro-lazy-src", "srcset"]
        final_src = ""
        found_attr = None
        for attr in source_attrs:
            value = element.get(attr, "")
            if attr == "srcset" and value:
                parts = value.split(",")
                if parts:
                    first_src = parts[0].strip().split(" ")[0]
                    if first_src:
                        value = first_src
            if value:
                joined = self._join_and_check_url(value)
                if joined:
                    found_attr = attr
                    final_src = joined
                    break
        if not final_src:
            return None
        is_data, _ = is_data_url(final_src)
        if is_data and found_attr == "src":
            for attr in source_attrs[1:]:
                value = element.get(attr, "")
                if attr == "srcset" and value:
                    parts = value.split(",")
                    if parts:
                        first_src = parts[0].strip().split(" ")[0]
                        if first_src:
                            value = first_src
                if value:
                    joined = self._join_and_check_url(value)
                    if joined:
                        final_src = joined
                        is_data = False
                        break
        if not final_src:
            return None
        width = element.get("width", "")
        height = element.get("height", "")
        if (width == "1" and height == "1") or (width == "0" and height == "0"):
            return None
        if self._is_tracking_pixel(final_src):
            return None
        metadata = self._create_metadata(element)
        image_obj = Image(
            src=final_src, alt=self._normalize_text(element.get("alt", "")),
            width=width, height=height, title=element.get("title", ""),
            loading=element.get("loading", ""), is_data_url=is_data, metadata=metadata,
        )
        if add:
            self._add_content(image_obj)
            return None
        return image_obj

    def _parse_picture(self, element: Tag, add: bool = True) -> Optional[Image]:
        sources = element.find_all("source")
        all_sources: list[str] = []
        for source in sources:
            for attr_name, attr_value in source.attrs.items():
                if "srcset" in attr_name.lower():
                    for entry in attr_value.split(","):
                        parts = entry.strip().split(" ")
                        if parts:
                            candidate = self._join_and_check_url(parts[0])
                            if candidate:
                                all_sources.append(candidate)
        img = element.find("img")
        best_src = ""
        if img and img.has_attr("src"):
            joined = self._join_and_check_url(img["src"])
            if joined:
                best_src = joined
        if best_src:
            is_data_img, _ = is_data_url(best_src)
            if is_data_img and all_sources:
                best_src = all_sources[0]
        elif all_sources:
            best_src = all_sources[0]
        if not best_src:
            return None
        if self._is_tracking_pixel(best_src):
            return None
        metadata = self._create_metadata(element)
        image_obj = Image(
            src=best_src,
            alt=self._normalize_text(img.get("alt", "")) if img else "",
            width=img.get("width", "") if img else "",
            height=img.get("height", "") if img else "",
            title=img.get("title", "") if img else "",
            loading=img.get("loading", "") if img else "",
            all_sources=all_sources, metadata=metadata,
        )
        if add:
            self._add_content(image_obj)
            return None
        return image_obj

    def _parse_figure(self, element: Tag, add: bool = True) -> Any:
        figcaption = element.find("figcaption")
        caption = self._normalize_text(figcaption.get_text()) if figcaption else ""
        image_obj = None
        picture = element.find("picture")
        if picture:
            image_obj = self._parse_picture(picture, add=False)
        else:
            imgs = element.find_all("img")
            best_img = self._select_best_image(imgs) if imgs else None
            if best_img:
                image_obj = self._parse_img(best_img, add=False)
        if (not image_obj or not image_obj.src) or (image_obj and self._is_tracking_pixel(image_obj.src)):
            if self._has_element_children(element):
                return self._extract_from_element(element, add)
            return None
        metadata = self._create_metadata(element)
        image_obj.metadata = metadata
        image_obj.caption = caption
        if add:
            self._add_content(image_obj)
        return image_obj

    def _select_best_image(self, imgs: list[Tag]) -> Optional[Tag]:
        if not imgs:
            return None
        if len(imgs) == 1:
            return imgs[0]
        scored: list[tuple[float, Tag]] = []
        for img in imgs:
            score = 0.0
            try:
                w = int(img.get("width", "0"))
                h = int(img.get("height", "0"))
                if w > 100 and h > 100:
                    score += 10
                score += min(w * h / 10000, 10)
            except ValueError:
                pass
            if img.get("alt"):
                score += 5
            cls = img.get("class", "")
            cls_str = " ".join(cls).lower() if isinstance(cls, list) else str(cls).lower()
            if any(x in cls_str for x in ("icon", "logo", "avatar", "thumbnail")):
                score -= 5
            scored.append((score, img))
        scored.sort(reverse=True, key=lambda x: x[0])
        return scored[0][1] if scored else imgs[0]

    def _parse_audio(self, element: Tag, add: bool = True) -> Optional[Audio]:
        src = element.get("src", "")
        normalized_src = join_url(self.url, src) if src else ""
        all_sources: list[dict[str, str]] = []
        for source in element.find_all("source"):
            for attr_name, attr_value in source.attrs.items():
                if "src" in attr_name.lower():
                    all_sources.append({"url": join_url(self.url, attr_value) or "", "type": source.get("type", "")})
        tracks: list[dict[str, str]] = []
        for track in element.find_all("track"):
            track_src = track.get("src", "")
            if track_src:
                tracks.append({
                    "url": join_url(self.url, track_src) or "",
                    "kind": track.get("kind", ""),
                    "label": track.get("label", ""),
                    "srclang": track.get("srclang", ""),
                })
        final_src = normalized_src or (all_sources[0]["url"] if all_sources else "")
        if not final_src:
            return None
        metadata = self._create_metadata(element)
        audio_obj = Audio(
            src=final_src, controls=element.has_attr("controls"),
            autoplay=element.has_attr("autoplay"), loop=element.has_attr("loop"),
            muted=element.has_attr("muted"), preload=element.get("preload", ""),
            sources=all_sources, tracks=tracks, metadata=metadata,
        )
        if add:
            self._add_content(audio_obj)
            return None
        return audio_obj

    def _parse_video(self, element: Tag, add: bool = True) -> Optional[Video]:
        src = element.get("src", "")
        normalized_src = join_url(self.url, src) if src else ""
        all_sources: list[dict[str, str]] = []
        for source in element.find_all("source"):
            for attr_name, attr_value in source.attrs.items():
                if "src" in attr_name.lower():
                    all_sources.append({"url": join_url(self.url, attr_value) or "", "type": source.get("type", "")})
        poster = element.get("poster", "")
        normalized_poster = join_url(self.url, poster) if poster else ""
        tracks: list[dict[str, str]] = []
        for track in element.find_all("track"):
            track_src = track.get("src", "")
            if track_src:
                tracks.append({
                    "url": join_url(self.url, track_src) or "",
                    "kind": track.get("kind", ""),
                    "label": track.get("label", ""),
                    "srclang": track.get("srclang", ""),
                })
        final_src = normalized_src or (all_sources[0]["url"] if all_sources else "")
        if not final_src:
            return None
        metadata = self._create_metadata(element)
        video_obj = Video(
            src=final_src, poster=normalized_poster or "",
            width=element.get("width", ""), height=element.get("height", ""),
            controls=element.has_attr("controls"), autoplay=element.has_attr("autoplay"),
            loop=element.has_attr("loop"), muted=element.has_attr("muted"),
            preload=element.get("preload", ""), playsinline=element.has_attr("playsinline"),
            sources=all_sources, tracks=tracks,
            provider=element.get("provider", "unknown"), metadata=metadata,
        )
        if add:
            self._add_content(video_obj)
            return None
        return video_obj

    def _join_and_check_url(self, path: str) -> Optional[str]:
        joined = join_url(base_url=self.url, path=path)
        if not joined:
            return None
        if self.domain_filter.should_block(url=joined):
            return None
        return joined
