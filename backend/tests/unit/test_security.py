import json
import logging
import sys
from datetime import timedelta

import jwt
import pytest
from app.core.logging import JsonFormatter, setup_logging
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import SecretStr, ValidationError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import Settings, settings
from app.core.database import create_app_async_engine, get_db
from app.core.security import (
    create_access_token,
    decode_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.main import app, lifespan


def test_settings_requires_valid_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("JWT_SECRET", raising=False)
    with pytest.raises(ValidationError):
        _ = Settings(_env_file=None)  # type: ignore[call-arg]

    monkeypatch.setenv("JWT_SECRET", "too-short")
    with pytest.raises(ValidationError):
        _ = Settings(_env_file=None)  # type: ignore[call-arg]


def test_settings_dev_defaults_and_custom_db(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET", "a-very-secure-jwt-secret-with-32-plus-bytes")
    monkeypatch.setenv("APP_ENV", "dev")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("UNKNOWN_EXTRA_VAR", "ignored")

    cfg = Settings(_env_file=None)  # type: ignore[call-arg]
    assert isinstance(cfg.jwt_secret, SecretStr)
    assert str(cfg.jwt_secret) == "**********"
    assert cfg.database_url == "sqlite+aiosqlite:///./presentation_timer.db"
    assert cfg.log_level == "DEBUG"
    assert not hasattr(cfg, "unknown_extra_var")

    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///./custom.db")
    cfg_custom = Settings(_env_file=None)  # type: ignore[call-arg]
    assert cfg_custom.database_url == "sqlite+aiosqlite:///./custom.db"


@pytest.mark.parametrize(
    "bad_db_url",
    [
        "",
        "sqlite+aiosqlite:///./presentation_timer.db",
        "postgresql://user:pass@localhost:5432/db",
    ],
)
def test_settings_prod_rejects_missing_or_non_asyncpg_url(
    monkeypatch: pytest.MonkeyPatch,
    bad_db_url: str,
) -> None:
    monkeypatch.setenv("APP_ENV", "prod")
    monkeypatch.setenv("JWT_SECRET", "prod-jwt-secret-key-at-least-32-characters")
    if bad_db_url:
        monkeypatch.setenv("DATABASE_URL", bad_db_url)
    else:
        monkeypatch.delenv("DATABASE_URL", raising=False)

    with pytest.raises(ValueError, match="postgresql\\+asyncpg://"):
        _ = Settings(_env_file=None)  # type: ignore[call-arg]


@pytest.mark.parametrize(
    ("app_env", "log_level_env", "expected_level"),
    [
        ("dev", None, "DEBUG"),
        ("dev", "", "DEBUG"),
        ("dev", "warning", "WARNING"),
        ("prod", None, "INFO"),
        ("prod", "error", "ERROR"),
    ],
)
def test_settings_log_level_matrix(
    monkeypatch: pytest.MonkeyPatch,
    app_env: str,
    log_level_env: str | None,
    expected_level: str,
) -> None:
    monkeypatch.setenv("APP_ENV", app_env)
    monkeypatch.setenv("JWT_SECRET", "prod-jwt-secret-key-at-least-32-characters")
    if app_env == "prod":
        monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@localhost:5432/app")
    else:
        monkeypatch.delenv("DATABASE_URL", raising=False)
    if log_level_env is None:
        monkeypatch.delenv("LOG_LEVEL", raising=False)
    else:
        monkeypatch.setenv("LOG_LEVEL", log_level_env)

    cfg = Settings(_env_file=None)  # type: ignore[call-arg]
    assert cfg.log_level == expected_level


def test_setup_logging_dev_and_prod_json_formatter() -> None:
    dev_cfg = Settings(
        _env_file=None,
        app_env="dev",
        jwt_secret=SecretStr("dev-jwt-secret-key-at-least-32-characters!"),
    )
    setup_logging(dev_cfg)
    assert logging.getLogger().level == logging.DEBUG

    prod_cfg = Settings(
        _env_file=None,
        app_env="prod",
        jwt_secret=SecretStr("prod-jwt-secret-key-at-least-32-characters"),
        database_url="postgresql+asyncpg://u:p@localhost:5432/app",
    )
    setup_logging(prod_cfg)
    assert logging.getLogger().level == logging.INFO

    formatter = JsonFormatter(app_env="prod")
    record = logging.LogRecord(
        name="app.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="hello %s",
        args=("world",),
        exc_info=None,
    )
    parsed = json.loads(formatter.format(record))
    assert set(parsed.keys()) == {"timestamp", "level", "logger", "message", "env"}
    assert parsed["message"] == "hello world"
    assert parsed["env"] == "prod"

    try:
        raise RuntimeError("boom")
    except RuntimeError:
        exc_info = sys.exc_info()
    err_record = logging.LogRecord(
        name="app.err",
        level=logging.ERROR,
        pathname=__file__,
        lineno=2,
        msg="failed",
        args=(),
        exc_info=exc_info,
    )
    parsed_err = json.loads(formatter.format(err_record))
    assert "RuntimeError: boom" in parsed_err["exception"]

    # Restore dev logging after test
    setup_logging(dev_cfg)


@pytest.mark.parametrize(
    ("database_url", "expected_pool_size"),
    [
        ("sqlite+aiosqlite://", None),
        ("postgresql+asyncpg://user:pass@localhost:5432/db", 10),
    ],
)
async def test_create_app_async_engine(
    database_url: str,
    expected_pool_size: int | None,
) -> None:
    eng = create_app_async_engine(database_url)
    try:
        assert isinstance(eng, AsyncEngine)
        if expected_pool_size is None:
            assert eng.dialect.name == "sqlite"
        else:
            assert eng.dialect.name == "postgresql"
            assert eng.pool.size() == expected_pool_size  # type: ignore[attr-defined]
    finally:
        await eng.dispose()


async def test_get_db_yields_and_closes_async_session() -> None:
    gen = get_db()
    session = await anext(gen)
    assert isinstance(session, AsyncSession)
    await gen.aclose()


@pytest.mark.parametrize("env_mode", ["dev", "prod"])
async def test_lifespan_dev_and_prod_modes(
    monkeypatch: pytest.MonkeyPatch,
    env_mode: str,
) -> None:
    temp_engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    fake_settings = Settings(
        _env_file=None,
        app_env=env_mode,  # type: ignore[arg-type]
        jwt_secret=SecretStr("lifespan-secret-key-at-least-32-bytes-long"),
        database_url=(
            "sqlite+aiosqlite://"
            if env_mode == "dev"
            else "postgresql+asyncpg://u:p@localhost:5432/db"
        ),
    )
    monkeypatch.setattr("app.main.engine", temp_engine)
    monkeypatch.setattr("app.main.settings", fake_settings)

    async with lifespan(app):
        assert temp_engine is not None


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
        (
            HTTPAuthorizationCredentials(scheme="Bearer", credentials=""),
            "Not authenticated",
        ),
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
async def test_get_current_user_error_branches(
    db_session: AsyncSession,
    credentials: HTTPAuthorizationCredentials | None,
    expected_detail: str,
) -> None:
    with pytest.raises(HTTPException) as exc_info:
        _ = await get_current_user(credentials=credentials, db=db_session)

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == expected_detail
