from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.api.auth import require_api_key
from app.db.queries.domain_config import upsert_domain
from app.models.domain import DomainConfig, DomainConfigCreateRequest

router = APIRouter(prefix="/config", tags=["domain_config"], dependencies=[Depends(require_api_key)])


@router.get("/domains", response_model=list[DomainConfig])
async def list_domains(request: Request) -> list[DomainConfig]:
    domain_config_store = request.app.state.domain_config_store
    return domain_config_store.all_domains


@router.post("/domains", response_model=DomainConfig)
async def create_or_update_domain(body: DomainConfigCreateRequest, request: Request) -> DomainConfig:
    pool = request.app.state.db_pool
    result = await upsert_domain(
        pool=pool,
        url=body.url,
        common_name=body.common_name,
        scrape_allowed=body.scrape_allowed,
        enabled=body.enabled,
        proxy_type=body.proxy_type.value,
    )
    return result
