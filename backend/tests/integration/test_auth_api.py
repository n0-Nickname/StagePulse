from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.security import create_access_token


def test_health_check(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_register_success_and_argon2id_storage(client: TestClient, db_session: Session) -> None:
    response = client.post(
        "/api/auth/register",
        json={"email": "Alice@Example.com", "password": "securepassword123"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["token_type"] == "bearer"
    assert "access_token" in data
    user_data = data["user"]
    assert user_data["email"] == "alice@example.com"
    assert "username" not in user_data
    assert user_data["is_pro"] is False
    assert user_data["spin_count"] == 0
    assert user_data["spins_remaining"] == 3

    db_user = db_session.scalar(select(User).where(User.email == "alice@example.com"))
    assert db_user is not None
    assert db_user.password_hash != "securepassword123"
    assert db_user.password_hash.startswith("$argon2id$")


def test_register_duplicate_email_returns_400(client: TestClient) -> None:
    payload = {"email": "dup@example.com", "password": "password123"}
    assert client.post("/api/auth/register", json=payload).status_code == 201
    res2 = client.post("/api/auth/register", json=payload)
    assert res2.status_code == 400
    assert "already registered" in res2.json()["detail"].lower()


def test_register_integrity_error_returns_409(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = {"email": "race@example.com", "password": "password123"}
    assert client.post("/api/auth/register", json=payload).status_code == 201

    def raise_integrity(*_args: object, **_kwargs: object) -> None:
        raise IntegrityError("INSERT", {}, Exception("UNIQUE constraint failed"))

    def _return_none(*_args: object, **_kwargs: object) -> None:
        return None

    # Simulate race where pre-check returns None before DB unique constraint triggers
    monkeypatch.setattr(Session, "scalar", _return_none)
    monkeypatch.setattr(Session, "commit", raise_integrity)
    resp = client.post("/api/auth/register", json=payload)
    assert resp.status_code == 409
    assert resp.json() == {"detail": "Database integrity conflict"}


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "not-an-email", "password": "password123"},
        {"email": "valid@example.com", "password": "short"},
        {"email": "valid@example.com", "password": "x" * 129},
        {"password": "password123"},
        {"email": "valid@example.com"},
    ],
)
def test_register_validation_errors(client: TestClient, payload: dict[str, str]) -> None:
    res = client.post("/api/auth/register", json=payload)
    assert res.status_code == 422


@pytest.mark.parametrize(
    ("login_email", "login_password", "expected_status"),
    [
        ("BOB@example.com", "bobsecretpassword", 200),
        ("bob@example.com", "wrongpassword", 401),
        ("nonexistent@example.com", "bobsecretpassword", 401),
    ],
)
def test_login_matrix(
    client: TestClient,
    login_email: str,
    login_password: str,
    expected_status: int,
) -> None:
    client.post(
        "/api/auth/register",
        json={"email": "bob@example.com", "password": "bobsecretpassword"},
    )
    res = client.post(
        "/api/auth/login",
        json={"email": login_email, "password": login_password},
    )
    assert res.status_code == expected_status
    if expected_status == 200:
        body = res.json()
        assert body["token_type"] == "bearer"
        assert body["user"]["email"] == "bob@example.com"


def test_get_me_authenticated_and_rejections(
    client: TestClient,
    auth_headers_for: Callable[[str, str], dict[str, str]],
) -> None:
    headers = auth_headers_for("carol@example.com", "carolpassword")
    me_res = client.get("/api/auth/me", headers=headers)
    assert me_res.status_code == 200
    assert me_res.json()["email"] == "carol@example.com"
    assert me_res.json()["spins_remaining"] == 3

    assert client.get("/api/auth/me").status_code == 401
    assert (
        client.get(
            "/api/auth/me", headers={"Authorization": "Bearer invalid.jwt.token"}
        ).status_code
        == 401
    )

    non_int_sub = create_access_token("not-an-integer")
    non_int_res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {non_int_sub}"})
    assert non_int_res.status_code == 401
    assert "invalid token payload" in non_int_res.json()["detail"].lower()

    missing_token = create_access_token(999999)
    missing_res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {missing_token}"})
    assert missing_res.status_code == 401
    assert "user not found" in missing_res.json()["detail"].lower()
