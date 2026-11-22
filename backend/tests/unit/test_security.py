from datetime import timedelta

import jwt
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import SecretStr
from sqlalchemy.orm import Session

from app.core.config import Settings, settings
from app.core.database import build_connect_args, get_db
from app.core.security import (
    create_access_token,
    decode_access_token,
    get_current_user,
    hash_password,
    verify_password,
)


def test_settings_secret_str_and_extra_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET", "super-secret-override")
    monkeypatch.setenv("UNKNOWN_EXTRA_VAR", "ignored-value")
    cfg = Settings(_env_file=None)
    assert isinstance(cfg.jwt_secret, SecretStr)
    assert str(cfg.jwt_secret) == "**********"
    assert cfg.jwt_secret.get_secret_value() == "super-secret-override"
    assert not hasattr(cfg, "unknown_extra_var")


@pytest.mark.parametrize(
    ("database_url", "expected"),
    [
        ("sqlite:///./presentation_timer.db", {"check_same_thread": False}),
        ("sqlite://", {"check_same_thread": False}),
        ("postgresql+asyncpg://user:pass@localhost:5432/db", {}),
    ],
)
def test_build_connect_args(database_url: str, expected: dict[str, bool]) -> None:
    assert build_connect_args(database_url) == expected


def test_get_db_yields_and_closes_session() -> None:
    gen = get_db()
    session = next(gen)
    assert isinstance(session, Session)
    gen.close()


def test_hash_password_uses_argon2id_and_unique_salts() -> None:
    h1 = hash_password("my-secret-pw")
    h2 = hash_password("my-secret-pw")
    assert h1.startswith("$argon2id$")
    assert h2.startswith("$argon2id$")
    assert h1 != h2


@pytest.mark.parametrize(
    ("plain", "candidate_override", "expected"),
    [
        ("correct-horse-battery", None, True),
        ("wrong-password", None, False),
        ("", None, False),
        ("anything", "not-a-valid-argon2-hash", False),
        ("anything", "$argon2id$v=19$corrupted", False),
    ],
)
def test_verify_password_matrix(plain: str, candidate_override: str | None, expected: bool) -> None:
    hashed = (
        candidate_override
        if candidate_override is not None
        else hash_password("correct-horse-battery")
    )
    assert verify_password(plain, hashed) is expected


@pytest.mark.parametrize(
    ("subject", "delta", "expected_sub"),
    [
        (42, timedelta(minutes=10), "42"),
        ("99", None, "99"),
        (1, timedelta(seconds=-5), None),
    ],
)
def test_jwt_create_and_decode_matrix(
    subject: int | str, delta: timedelta | None, expected_sub: str | None
) -> None:
    token = create_access_token(subject, expires_delta=delta)
    assert decode_access_token(token) == expected_sub


@pytest.mark.parametrize(
    "token",
    [
        "not.a.jwt",
        "",
        jwt.encode(
            {"role": "guest"},
            settings.jwt_secret.get_secret_value(),
            algorithm=settings.jwt_algorithm,
        ),
    ],
)
def test_decode_invalid_or_missing_sub_tokens(token: str) -> None:
    assert decode_access_token(token) is None


@pytest.mark.parametrize(
    ("credentials", "expected_detail"),
    [
        (None, "Not authenticated"),
        (HTTPAuthorizationCredentials(scheme="Bearer", credentials=""), "Not authenticated"),
        (
            HTTPAuthorizationCredentials(scheme="Bearer", credentials="bad.jwt.token"),
            "Invalid or expired token",
        ),
        (
            HTTPAuthorizationCredentials(
                scheme="Bearer",
                credentials=create_access_token("not-an-int", timedelta(minutes=5)),
            ),
            "Invalid token payload",
        ),
        (
            HTTPAuthorizationCredentials(
                scheme="Bearer",
                credentials=create_access_token(99999, timedelta(minutes=5)),
            ),
            "User not found",
        ),
    ],
)
def test_get_current_user_error_branches(
    db_session: Session,
    credentials: HTTPAuthorizationCredentials | None,
    expected_detail: str,
) -> None:
    with pytest.raises(HTTPException) as exc_info:
        _ = get_current_user(credentials=credentials, db=db_session)

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == expected_detail
