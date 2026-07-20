"""FastAPI application factory and async lifespan."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI

from app.container import create_container
from app.infrastructure.observability.logging import setup_logging
from app.presentation.api.health import router as health_router
from app.presentation.api.v1.chat_models import router as chat_models_router
from app.presentation.api.v1.chat_sources import router as chat_sources_router
from app.presentation.api.v1.chat_stream import router as chat_stream_router
from app.presentation.api.v1.chat_widget import router as chat_widget_router
from app.presentation.api.v1.components import router as components_router
from app.presentation.api.v1.emails import router as emails_router
from app.presentation.api.v1.entity_instances import router as entity_instances_router
from app.presentation.api.v1.entity_types import router as entity_types_router
from app.presentation.api.v1.genui import router as genui_router
from app.presentation.api.v1.genui_code import router as genui_code_router
from app.presentation.api.v1.inbound_email import router as inbound_email_router
from app.presentation.api.v1.knowledge_edges import router as knowledge_edges_router
from app.presentation.api.v1.sns_inbound import router as sns_inbound_router
from app.presentation.middleware.request_logging import RequestLoggingMiddleware
from app.settings import get_settings

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    setup_logging(
        environment=settings.ENVIRONMENT.value,
        log_level=settings.LOG_LEVEL,
        log_json=settings.LOG_JSON,
    )
    logger.info(
        "startup",
        app=settings.APP_NAME,
        version=settings.APP_VERSION,
        environment=settings.ENVIRONMENT.value,
    )
    yield
    await app.state.dishka_container.close()
    logger.info("shutdown")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        lifespan=lifespan,
        docs_url="/docs" if settings.DEBUG else None,
        redoc_url=None,
    )

    app.add_middleware(RequestLoggingMiddleware)
    app.include_router(health_router)
    app.include_router(inbound_email_router)
    app.include_router(sns_inbound_router)
    app.include_router(emails_router)
    app.include_router(components_router)
    app.include_router(entity_instances_router)
    app.include_router(entity_types_router)
    app.include_router(genui_router)
    app.include_router(genui_code_router)
    app.include_router(chat_models_router)
    app.include_router(chat_stream_router)
    app.include_router(chat_widget_router)
    app.include_router(chat_sources_router)
    app.include_router(knowledge_edges_router)

    setup_dishka(container=create_container(), app=app)
    return app


app = create_app()
