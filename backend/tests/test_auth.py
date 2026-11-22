from datetime import timedelta

import jwt
import pytest
from app.core.config import settings
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session


def test_register_success(client: TestClient, db_session: Session) -> None:
    response = client.post(
        "/api/auth/register",
        json={
            "email": "Alice@Example.com",
            "password": "securepassword123",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    user_data = data["user"]
    assert user_data["email"] == "alice@example.com"
    assert "username" not in user_data
    assert user_data["is_pro"] is False
    assert user_data["spin_count"] == 0
    assert user_data["spins_remaining"] == 3
    assert "id" in user_data
    assert "created_at" in user_data

    assert not hasattr(User, "username")
    db_user = db_session.query(User).filter(User.email == "alice@example.com").first()
    assert db_user is not None
    assert db_user.password_hash != "securepassword123"
    assert db_user.password_hash.startswith("$2")


def test_register_duplicate_email_fails(client: TestClient) -> None:
    payload = {
        "email": "dup@example.com",
        "password": "password123",
    }
    res1 = client.post("/api/auth/register", json=payload)
    assert res1.status_code == 201

    res2 = client.post("/api/auth/register", json=payload)
    assert res2.status_code == 400
    assert "already registered" in res2.json()["detail"].lower()


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "not-an-email", "password": "password123"},
        {"email": "valid@example.com", "password": "short"},
        {"password": "password123"},
        {"email": "valid@example.com"},
    ],
)
def test_register_validation_errors(
    client: TestClient, payload: dict[str, str]
) -> None:
    res = client.post("/api/auth/register", json=payload)
    assert res.status_code == 422


def test_login_success_and_invalid_credentials(client: TestClient) -> None:
    client.post(
        "/api/auth/register",
        json={
            "email": "bob@example.com",
            "password": "bobsecretpassword",
        },
    )

    login_res = client.post(
        "/api/auth/login",
        json={"email": "BOB@example.com", "password": "bobsecretpassword"},
    )
    assert login_res.status_code == 200
    login_data = login_res.json()
    assert "access_token" in login_data
    assert login_data["token_type"] == "bearer"
    assert login_data["user"]["email"] == "bob@example.com"
    assert "username" not in login_data["user"]

    wrong_pass = client.post(
        "/api/auth/login",
        json={"email": "bob@example.com", "password": "wrongpassword"},
    )
    assert wrong_pass.status_code == 401

    unknown_email = client.post(
        "/api/auth/login",
        json={"email": "nonexistent@example.com", "password": "bobsecretpassword"},
    )
    assert unknown_email.status_code == 401


def test_get_me_authenticated_and_unauthenticated(client: TestClient) -> None:
    reg = client.post(
        "/api/auth/register",
        json={
            "email": "carol@example.com",
            "password": "carolpassword",
        },
    )
    token = reg.json()["access_token"]

    me_res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["email"] == "carol@example.com"
    assert "username" not in me_data
    assert me_data["is_pro"] is False
    assert me_data["spin_count"] == 0
    assert me_data["spins_remaining"] == 3

    no_auth = client.get("/api/auth/me")
    assert no_auth.status_code == 401

    bad_token = client.get(
        "/api/auth/me", headers={"Authorization": "Bearer invalid.jwt.token"}
    )
    assert bad_token.status_code == 401

    non_int_sub = create_access_token(
        "not-an-integer", expires_delta=timedelta(minutes=5)
    )
    non_int_res = client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {non_int_sub}"}
    )
    assert non_int_res.status_code == 401
    assert "invalid token payload" in non_int_res.json()["detail"].lower()

    missing_user_token = create_access_token(999999)
    missing_user_res = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {missing_user_token}"},
    )
    assert missing_user_res.status_code == 401
    assert "user not found" in missing_user_res.json()["detail"].lower()


def test_security_helpers_edge_cases() -> None:
    hashed = hash_password("my-secret-pw")
    assert verify_password("my-secret-pw", hashed) is True
    assert verify_password("wrong", hashed) is False
    assert verify_password("anything", "not-a-valid-bcrypt-hash") is False

    token = create_access_token("42", expires_delta=timedelta(minutes=10))
    assert decode_access_token(token) == "42"
    assert decode_access_token("bad.token.value") is None

    no_sub_token = jwt.encode(
        {"role": "guest"}, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM
    )
    assert decode_access_token(no_sub_token) is None
