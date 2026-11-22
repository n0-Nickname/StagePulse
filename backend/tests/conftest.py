from collections.abc import Generator
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
import app.models  # noqa: F401
from app.routers import auth as auth_router

TEST_SQLALCHEMY_DATABASE_URL = "sqlite://"

test_engine = create_engine(
    TEST_SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def _get_or_build_app() -> FastAPI:
    try:
        from app.main import app as main_app

        return main_app
    except Exception:
        fallback_app = FastAPI(title="Presentation Timer Test App")
        fallback_app.include_router(auth_router.router)
        try:
            from app.routers import slots as slots_router

            fallback_app.include_router(slots_router.router)
        except Exception:
            pass
        try:
            from app.routers import presentations as presentations_router

            fallback_app.include_router(presentations_router.router)
        except Exception:
            pass
        return fallback_app


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    Base.metadata.create_all(bind=test_engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=test_engine)


@pytest.fixture()
def client(db_session: Session) -> Generator[TestClient, None, None]:
    app = _get_or_build_app()

    def override_get_db() -> Generator[Session, None, None]:
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
