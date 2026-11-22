from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import User


def test_register_success(client: TestClient, db_session: Session) -> None:
    response = client.post(
        "/api/auth/register",
        json={
            "email": "Alice@Example.com",
            "username": "alice",
            "password": "securepassword123",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    user_data = data["user"]
    assert user_data["email"] == "alice@example.com"
    assert user_data["username"] == "alice"
    assert user_data["is_pro"] is False
    assert user_data["spin_count"] == 0
    assert user_data["spins_remaining"] == 3
    assert "id" in user_data
    assert "created_at" in user_data

    db_user = db_session.query(User).filter(User.email == "alice@example.com").first()
    assert db_user is not None
    assert db_user.password_hash != "securepassword123"
    assert db_user.password_hash.startswith("$2")


def test_register_duplicate_email_fails(client: TestClient) -> None:
    payload = {
        "email": "dup@example.com",
        "username": "user1",
        "password": "password123",
    }
    res1 = client.post("/api/auth/register", json=payload)
    assert res1.status_code == 201

    res2 = client.post("/api/auth/register", json=payload)
    assert res2.status_code == 400
    assert "already registered" in res2.json()["detail"].lower()


def test_login_success_and_invalid_credentials(client: TestClient) -> None:
    client.post(
        "/api/auth/register",
        json={
            "email": "bob@example.com",
            "username": "bob",
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
            "username": "carol",
            "password": "carolpassword",
        },
    )
    token = reg.json()["access_token"]

    me_res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["email"] == "carol@example.com"
    assert me_data["username"] == "carol"
    assert me_data["is_pro"] is False
    assert me_data["spin_count"] == 0
    assert me_data["spins_remaining"] == 3

    no_auth = client.get("/api/auth/me")
    assert no_auth.status_code == 401

    bad_token = client.get("/api/auth/me", headers={"Authorization": "Bearer invalid.jwt.token"})
    assert bad_token.status_code == 401
