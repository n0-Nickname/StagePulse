import logging
from collections.abc import Awaitable, Callable

import pytest
from httpx import AsyncClient
from sqlalchemy import Result, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.core.security import create_access_token


async def test_health_check_and_http_request_logging(
    async_client: AsyncClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.INFO, logger="app.http"):
        response = await async_client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert any(
        "GET /api/health -> 200" in rec.message and "ms)" in rec.message for rec in caplog.records
    )


async def test_register_success_and_argon2id_storage(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    response = await async_client.post(
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

    result = await db_session.execute(select(User).where(User.email == "alice@example.com"))
    db_user = result.scalar_one_or_none()
    assert db_user is not None
    assert db_user.password_hash != "securepassword123"
    assert db_user.password_hash.startswith("$argon2id$")


async def test_register_duplicate_email_returns_400(async_client: AsyncClient) -> None:
    payload = {"email": "dup@example.com", "password": "password123"}
    assert (await async_client.post("/api/auth/register", json=payload)).status_code == 201
    res2 = await async_client.post("/api/auth/register", json=payload)
    assert res2.status_code == 400
    assert "already registered" in res2.json()["detail"].lower()


async def test_register_integrity_error_returns_409(
    async_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = {"email": "race@example.com", "password": "password123"}
    assert (await async_client.post("/api/auth/register", json=payload)).status_code == 201

    class _EmptyResult:
        def scalar_one_or_none(self) -> None:
            return None

    async def _fake_execute(*_args: object, **_kwargs: object) -> Result[tuple[User]]:
        return _EmptyResult()  # type: ignore[return-value]

    async def _raise_integrity(*_args: object, **_kwargs: object) -> None:
        raise IntegrityError("INSERT", {}, Exception("UNIQUE constraint failed"))

    monkeypatch.setattr(AsyncSession, "execute", _fake_execute)
    monkeypatch.setattr(AsyncSession, "commit", _raise_integrity)
    resp = await async_client.post("/api/auth/register", json=payload)
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
async def test_register_validation_errors(
    async_client: AsyncClient, payload: dict[str, str]
) -> None:
    res = await async_client.post("/api/auth/register", json=payload)
    assert res.status_code == 422


@pytest.mark.parametrize(
    ("login_email", "login_password", "expected_status"),
    [
        ("BOB@example.com", "bobsecretpassword", 200),
        ("bob@example.com", "wrongpassword", 401),
        ("nonexistent@example.com", "bobsecretpassword", 401),
    ],
)
async def test_login_matrix(
    async_client: AsyncClient,
    login_email: str,
    login_password: str,
    expected_status: int,
) -> None:
    await async_client.post(
        "/api/auth/register",
        json={"email": "bob@example.com", "password": "bobsecretpassword"},
    )
    res = await async_client.post(
        "/api/auth/login",
        json={"email": login_email, "password": login_password},
    )
    assert res.status_code == expected_status
    if expected_status == 200:
        body = res.json()
        assert body["token_type"] == "bearer"
        assert body["user"]["email"] == "bob@example.com"


async def test_get_me_authenticated_and_rejections(
    async_client: AsyncClient,
    auth_headers_for: Callable[[str, str], Awaitable[dict[str, str]]],
) -> None:
    headers = await auth_headers_for("carol@example.com", "carolpassword")
    me_res = await async_client.get("/api/auth/me", headers=headers)
    assert me_res.status_code == 200
    assert me_res.json()["email"] == "carol@example.com"
    assert me_res.json()["spins_remaining"] == 3

    assert (await async_client.get("/api/auth/me")).status_code == 401
    assert (
        await async_client.get(
            "/api/auth/me", headers={"Authorization": "Bearer invalid.jwt.token"}
        )
    ).status_code == 401

    non_int_sub = create_access_token("not-an-integer")
    non_int_res = await async_client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {non_int_sub}"}
    )
    assert non_int_res.status_code == 401
    assert "invalid token payload" in non_int_res.json()["detail"].lower()

    missing_token = create_access_token(999999)
    missing_res = await async_client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {missing_token}"}
    )
    assert missing_res.status_code == 401
    assert "user not found" in missing_res.json()["detail"].lower()
