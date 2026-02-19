from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import domain_config, health, scrape, search

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(scrape.router)
api_router.include_router(search.router)
api_router.include_router(domain_config.router)
