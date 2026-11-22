from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


def build_connect_args(database_url: str) -> dict[str, bool]:
    """Return SQLite thread-safety connect args only when using a SQLite URL."""
    if database_url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


engine = create_engine(
    settings.database_url,
    connect_args=build_connect_args(settings.database_url),
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session]:
    """Yield a database session and ensure it closes when the request finishes."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
