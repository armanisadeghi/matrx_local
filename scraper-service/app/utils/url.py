from __future__ import annotations

import ipaddress
import os
import re
from functools import lru_cache
from typing import Optional
from urllib.parse import parse_qs, urlencode, urljoin, urlparse, urlunparse

import tldextract
from pydantic import BaseModel


class URLInfo(BaseModel):
    url: str
    website: str
    full_domain: str
    subdomain: str
    path: str
    domain_type: str
    unique_page_name: str
    extension: Optional[str] = None
    path_segments: list[str] = []

    @classmethod
    def from_url(cls, raw_url: str) -> URLInfo:
        cleaned = _clean_url(raw_url)
        parsed = urlparse(cleaned)
        extracted = tldextract.extract(parsed.netloc)

        website = f"{extracted.domain}.{extracted.suffix}" if extracted.suffix else extracted.domain
        full_domain = f"{extracted.subdomain}.{website}" if extracted.subdomain else website
        path = _construct_path(parsed)
        unique_page_name = re.sub(r"[^a-zA-Z0-9]", "_", full_domain + path)
        ext_raw = os.path.splitext(parsed.path)[1][1:]
        extension = ext_raw if ext_raw else None
        segments = [seg for seg in path.split("/") if seg.strip() and "?" not in seg]

        return cls(
            url=cleaned,
            website=website,
            full_domain=full_domain,
            subdomain=extracted.subdomain,
            path=path,
            domain_type=extracted.suffix,
            unique_page_name=unique_page_name,
            extension=extension,
            path_segments=segments,
        )


@lru_cache(maxsize=2000)
def get_url_info(url: str) -> URLInfo:
    return URLInfo.from_url(url)


def extract_domain(url: str) -> str:
    try:
        extracted = tldextract.extract(url)
        website = f"{extracted.domain}.{extracted.suffix}" if extracted.suffix else extracted.domain
        return f"{extracted.subdomain}.{website}" if extracted.subdomain else website
    except Exception:
        parsed = urlparse(url)
        return parsed.netloc or url


def _clean_url(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.scheme:
        url = "https://" + url
        parsed = urlparse(url)

    url = url.split("#")[0]
    parsed = urlparse(url)

    query_params = parse_qs(parsed.query)
    query_params = {k: v for k, v in query_params.items() if v and v[0]}
    query_string = urlencode(query_params, doseq=True)

    extracted = tldextract.extract(parsed.netloc)
    subdomain = extracted.subdomain
    domain = f"{extracted.domain}.{extracted.suffix}" if extracted.suffix else extracted.domain
    netloc = f"{subdomain}.{domain}" if subdomain else domain

    path = parsed.path
    if path == "/":
        path = ""

    if query_string:
        return f"{parsed.scheme}://{netloc}{path}?{query_string}"
    return f"{parsed.scheme}://{netloc}{path}"


def _construct_path(parsed: object) -> str:
    path = parsed.path  # type: ignore[attr-defined]
    if path == "/":
        path = ""
    elif path.endswith("/"):
        path = path.rstrip("/")

    query_params = parse_qs(parsed.query)  # type: ignore[attr-defined]
    query_params = {k: v for k, v in query_params.items() if v and v[0]}
    query_string = urlencode(query_params, doseq=True)

    if query_string:
        path += f"?{query_string}"
    return path


def validate_and_correct_url(url: str) -> str:
    if not url:
        raise ValueError("URL cannot be empty")

    url = url.strip()

    if not url.startswith(("http://", "https://")):
        if re.match(r"^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}", url):
            url = "https://" + url
        elif re.match(r"^www\.", url):
            url = "https://" + url

    parsed = urlparse(url)

    if not parsed.scheme:
        raise ValueError("URL scheme is missing and cannot be inferred")
    if not parsed.netloc:
        raise ValueError("URL domain is missing")
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"URL scheme must be http or https, got: {parsed.scheme}")

    hostname = parsed.netloc.split(":")[0]

    if hostname == "localhost" or hostname.startswith("127."):
        raise ValueError(f"URL points to localhost: {url}")
    if hostname.endswith((".local", ".internal", ".intranet", ".corp")):
        raise ValueError(f"URL points to internal network: {url}")
    if hostname in ("::1", "[::1]"):
        raise ValueError(f"URL points to localhost IPv6: {url}")

    try:
        ip_str = hostname[1:-1] if hostname.startswith("[") and hostname.endswith("]") else hostname
        ip = ipaddress.ip_address(ip_str)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved:
            raise ValueError(f"URL points to private/reserved IP address: {url}")
    except ValueError:
        pass

    netloc_lower = parsed.netloc.lower()

    def _apply_google_docs_mobilebasic(p: object) -> object:
        path_parts = p.path.strip("/").split("/")  # type: ignore[attr-defined]
        if len(path_parts) >= 3 and path_parts[0] == "document" and path_parts[1] == "d":
            doc_id = path_parts[2]
            if not p.path.endswith("/mobilebasic"):  # type: ignore[attr-defined]
                return p._replace(path=f"/document/d/{doc_id}/mobilebasic", query="", fragment="")  # type: ignore[attr-defined]
        elif len(path_parts) >= 3 and path_parts[0] == "spreadsheets" and path_parts[1] == "d":
            doc_id = path_parts[2]
            if not p.path.endswith("/htmlview"):  # type: ignore[attr-defined]
                return p._replace(path=f"/spreadsheets/d/{doc_id}/htmlview", query="", fragment="")  # type: ignore[attr-defined]
        return p

    rules: dict[str, object] = {
        "docs.google.com": _apply_google_docs_mobilebasic,
    }

    if netloc_lower in rules:
        transformation_func = rules[netloc_lower]
        modified_parsed = transformation_func(parsed)  # type: ignore[operator]
        if modified_parsed != parsed:
            url = urlunparse(modified_parsed)

    return url


def join_url(base_url: Optional[str], path: Optional[str]) -> Optional[str]:
    if base_url is None:
        return path
    if path is None:
        return base_url

    path = str(path).strip()
    if not path:
        return base_url

    if re.match(r"^(?:http|https|ftp|file)://", path):
        return path

    if path.startswith("data:"):
        return path

    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", path):
        return path

    if path.startswith("//") and not path.startswith("///"):
        parsed_base = urlparse(base_url)
        return f"{parsed_base.scheme}:{path}"

    if re.match(r"^/{3,}", path):
        path = "/" + path.lstrip("/")

    trailing = re.search(r"/{2,}$", base_url)
    if trailing and not path.startswith("/"):
        return base_url + path

    return urljoin(base_url, path)


def is_data_url(url: Optional[str]) -> tuple[bool, bool]:
    if url is None:
        return False, False
    url_lower = str(url).strip().lower()
    if not url_lower.startswith("data:"):
        return False, False
    return True, ";base64," in url_lower


def match_path(path: str, patterns: list[str]) -> Optional[str]:
    normalized_path = path
    if path != "/" and path.endswith("/"):
        normalized_path = path[:-1]

    for pattern in patterns:
        normalized_pattern = pattern
        if pattern != "/" and pattern.endswith("/"):
            normalized_pattern = pattern[:-1]
        if normalized_path == normalized_pattern or path == pattern:
            return pattern

    matches: list[tuple[str, int]] = []

    for pattern in patterns:
        if "*" in pattern:
            pattern_parts = [p for p in pattern.split("/") if p]
            path_parts = [p for p in path.split("/") if p]

            non_wildcard_parts = [p for p in pattern_parts if p != "*"]
            if len(non_wildcard_parts) > len(path_parts):
                continue

            is_match = True
            specificity = 0
            pattern_idx = 0

            for path_part in path_parts:
                if pattern_idx >= len(pattern_parts):
                    if "*" not in pattern_parts:
                        is_match = False
                        break
                    continue

                pattern_part = pattern_parts[pattern_idx]
                if pattern_part == "*":
                    specificity += 1
                elif pattern_part != path_part:
                    is_match = False
                    break
                else:
                    specificity += 10

                pattern_idx += 1

            while pattern_idx < len(pattern_parts):
                if pattern_parts[pattern_idx] != "*":
                    is_match = False
                    break
                pattern_idx += 1

            if is_match:
                matches.append((pattern, specificity))

        elif pattern == "/*" and len(patterns) > 0:
            matches.append((pattern, 1))

    if matches:
        matches.sort(key=lambda x: x[1], reverse=True)
        return matches[0][0]

    if path == "/" and "/" in patterns:
        return "/"

    return None
