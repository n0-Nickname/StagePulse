import logging
import time
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.auth.router import router as auth_router
from app.core.config import settings
from app.core.database import Base, engine
from app.core.logging import setup_logging
from app.filler_dictionary.router import router as filler_dictionary_router
from app.presentations.router import router as presentations_router
from app.slots.router import router as slots_router

http_logger = logging.getLogger("app.http")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    """Configure logging, initialize or check database, and dispose engine on shutdown."""
    setup_logging(settings)
    if settings.app_env == "dev":
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    else:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    try:
        yield
    finally:
        await engine.dispose()


app = FastAPI(
    title=settings.project_name,
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_http_requests(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Log HTTP method, path, response status code, and duration in milliseconds."""
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000.0
    http_logger.info(
        "%s %s -> %d (%.2f ms)",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


def integrity_error_handler(_request: object, _exc: Exception) -> Response:
    """Return 409 Conflict when a database integrity constraint is violated."""
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": "Database integrity conflict"},
    )


app.add_exception_handler(IntegrityError, integrity_error_handler)

app.include_router(auth_router)
app.include_router(slots_router)
app.include_router(presentations_router)
app.include_router(filler_dictionary_router)


@app.get("/api/health", tags=["health"])
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}
