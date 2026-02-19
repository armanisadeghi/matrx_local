from __future__ import annotations

from typing import Optional
from uuid import UUID

from pydantic import BaseModel

from app.models.enums import ProxyType


class BaseConfigRule(BaseModel):
    id: UUID
    selector_type: str
    exact: list[str] = []
    partial: list[str] = []
    regex: list[str] = []


class OverrideRule(BaseModel):
    id: UUID
    path_pattern_id: UUID
    is_active: bool = True
    config_type: str  # 'content_filter' | 'main_content'
    selector_type: str
    match_type: str  # 'exact' | 'partial' | 'regex'
    action: str  # 'add' | 'remove' | 'replace_all_with'
    values: list[str] = []


class PathPatternConfig(BaseModel):
    id: UUID
    domain_id: UUID
    pattern: str
    overrides: list[OverrideRule] = []


class DomainSettings(BaseModel):
    id: UUID
    domain_id: UUID
    enabled: bool = True
    proxy_type: ProxyType = ProxyType.DATACENTER


class DomainConfig(BaseModel):
    id: UUID
    url: str
    common_name: Optional[str] = None
    scrape_allowed: bool = True
    settings: Optional[DomainSettings] = None
    path_patterns: list[PathPatternConfig] = []


class DomainConfigCreateRequest(BaseModel):
    url: str
    common_name: Optional[str] = None
    scrape_allowed: bool = True
    enabled: bool = True
    proxy_type: ProxyType = ProxyType.DATACENTER
