from collections.abc import AsyncGenerator
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings


def create_app_async_engine(database_url: str) -> AsyncEngine:
    """Create an async SQLAlchemy engine tuned for SQLite or PostgreSQL."""
    if database_url.startswith("sqlite"):
        return create_async_engine(
            database_url,
            connect_args={"check_same_thread": False},
        )
    parsed = urlparse(database_url)
    query_params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    ssl_mode = query_params.pop("sslmode", None)
    query_params.pop("channel_binding", None)
    clean_url = urlunparse(parsed._replace(query=urlencode(query_params)))
    connect_args = {"ssl": "require"} if ssl_mode in ("require", "verify-ca", "verify-full") else {}
    return create_async_engine(
        clean_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        connect_args=connect_args,
    )


engine: AsyncEngine = create_app_async_engine(settings.database_url)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession]:
    """Yield an async database session and close it when the request completes."""
    async with AsyncSessionLocal() as session:
        yield session
