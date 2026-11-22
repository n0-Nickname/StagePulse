from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from app.auth.router import router as auth_router
from app.core.config import settings
from app.core.database import Base, engine
from app.presentations.router import router as presentations_router
from app.slots.router import router as slots_router


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    """Create database tables on application startup."""
    Base.metadata.create_all(bind=engine)
    yield


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


@app.get("/api/health", tags=["health"])
def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}
