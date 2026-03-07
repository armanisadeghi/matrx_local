from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import content, docs, domain_config, health, queue, scrape, search

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(scrape.router)
api_router.include_router(search.router)
api_router.include_router(domain_config.router)
api_router.include_router(queue.router)
api_router.include_router(content.router)
api_router.include_router(docs.router)
