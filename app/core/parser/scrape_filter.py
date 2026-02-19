from __future__ import annotations

import copy
import re
from typing import Optional

import bs4

VALID_MATCH_TYPES = {"exact", "partial", "regex"}


class ScrapeFilter:
    def __init__(
        self,
        content_filter_config: Optional[list[dict]] = None,
        main_content_config: Optional[list[str]] = None,
    ) -> None:
        self.content_filters = content_filter_config or []
        self.main_content_selectors = main_content_config or []

    def _check_string_match(self, text: str, value: str, match_type: str) -> bool:
        if match_type == "exact" and text == value:
            return True
        elif match_type == "partial" and value in text:
            return True
        elif match_type == "regex":
            try:
                if re.compile(value).search(text):
                    return True
            except re.error:
                pass
        return False

    def _check_class_attribute(self, element: bs4.element.Tag, value: str, match_type: str) -> bool:
        if not element.has_attr("class"):
            return False
        element_classes = element["class"]
        if " " in value:
            return all(vc in element_classes for vc in value.split())
        for cls in element_classes:
            if self._check_string_match(cls, value, match_type):
                return True
        return False

    def _check_style_attribute(self, element: bs4.element.Tag, value: str, match_type: str) -> bool:
        if not element.has_attr("style"):
            return False
        style_str = element["style"].lower().strip()
        if not style_str:
            return False
        styles: dict[str, str] = {}
        for s in style_str.split(";"):
            if ":" in s:
                k, v = s.split(":", 1)
                styles[k.strip()] = v.strip()
        if ":" in value:
            prop, val = value.split(":", 1)
            if prop.strip() in styles:
                return self._check_string_match(styles[prop.strip()], val.strip(), match_type)
        else:
            return value in styles
        return False

    def check_element(
        self,
        element: bs4.element.Tag,
        attribute: str,
        values: list[str],
        match_type: str,
    ) -> tuple[bool, Optional[str]]:
        if match_type not in VALID_MATCH_TYPES:
            return False, None

        if attribute == "tag":
            if not element.name:
                return False, None
            for value in values:
                if self._check_string_match(element.name, value, match_type):
                    return True, value
            return False, None

        if attribute == "text":
            text = element.get_text(strip=True)
            if not text:
                return False, None
            for value in values:
                if self._check_string_match(text, value, match_type):
                    return True, value
            return False, None

        if attribute == "class":
            for value in values:
                if self._check_class_attribute(element, value, match_type):
                    return True, value
            return False, None

        if attribute == "style":
            for value in values:
                if self._check_style_attribute(element, value, match_type):
                    return True, value
            return False, None

        if not element.has_attr(attribute):
            return False, None

        attr_value = element[attribute]
        if isinstance(attr_value, list):
            for value in values:
                for av in attr_value:
                    if self._check_string_match(str(av), value, match_type):
                        return True, value
        else:
            for value in values:
                if self._check_string_match(str(attr_value), value, match_type):
                    return True, value
        return False, None

    def find_main_content(self, soup: bs4.BeautifulSoup) -> Optional[bs4.element.Tag]:
        if not self.main_content_selectors:
            return None
        main_content = soup.new_tag("div")
        found_any = False
        for selector in self.main_content_selectors:
            for element in soup.select(selector):
                found_any = True
                main_content.append(copy.deepcopy(element))
        return main_content if found_any else None

    def filter_soup(
        self,
        soup: bs4.BeautifulSoup,
        main_content_config: Optional[list[str]] = None,
        content_filter_config: Optional[list[dict]] = None,
        remove: bool = False,
    ) -> bs4.BeautifulSoup:
        if main_content_config is not None:
            self.main_content_selectors = main_content_config
        if content_filter_config is not None:
            self.content_filters = content_filter_config

        processed_soup = copy.deepcopy(soup)
        main_content = self.find_main_content(processed_soup)
        target_soup = main_content if main_content else processed_soup

        elements_to_remove: list[bs4.element.Tag] = []
        protected_tags = {"ContentFilter", "body", "html"}

        for element in target_soup.find_all():
            if element.name in protected_tags:
                continue
            if element.parent and element.parent.name == "ContentFilter":
                continue

            for filter_config in self.content_filters:
                attribute = filter_config.get("attribute")
                if not attribute:
                    continue
                is_match = False
                for match_type_str in ("exact", "partial", "regex"):
                    values = filter_config.get(match_type_str, [])
                    if not values:
                        continue
                    is_match, trigger_value = self.check_element(element, attribute, values, match_type_str)
                    if is_match:
                        if remove:
                            elements_to_remove.append(element)
                        else:
                            filter_tag = processed_soup.new_tag(
                                "ContentFilter",
                                type=attribute,
                                match_type=match_type_str,
                                trigger_item=str(trigger_value),
                            )
                            element.wrap(filter_tag)
                        break
                if is_match:
                    break

        if remove:
            for element in elements_to_remove:
                element.decompose()

        if main_content:
            for child in list(processed_soup.body.children):
                child.decompose()
            processed_soup.body.append(main_content)

        return processed_soup
