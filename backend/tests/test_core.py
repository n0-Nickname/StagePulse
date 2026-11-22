"""Core health check and database session generator tests."""

from __future__ import annotations

from app.core.database import get_db
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session


def test_health_check(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_get_db_yields_and_closes_session() -> None:
    gen = get_db()
    session = next(gen)
    assert isinstance(session, Session)
    gen.close()
