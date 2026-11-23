from collections.abc import Awaitable, Callable

import pytest
from app.filler_dictionary.schemas import (
    MAX_FILLER_WORDS,
    FillerDictionaryUpdate,
    normalize_filler_words,
)
from httpx import AsyncClient
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User


@pytest.mark.parametrize(
    ("raw_words", "expected"),
    [
        ([], []),
        (["", "   ", "\t\n"], []),
        (
            ["Um", "  LIKE  ", "actually", "um", "Like", "  ", "So"],
            ["um", "like", "actually", "so"],
        ),
        (["you know", "  You   Know ", "you know"], ["you know", "you   know"]),
        (
            [f"word{i}" for i in range(MAX_FILLER_WORDS)],
            [f"word{i}" for i in range(MAX_FILLER_WORDS)],
        ),
    ],
)
def test_normalize_filler_words(raw_words: list[str], expected: list[str]) -> None:
    assert normalize_filler_words(raw_words) == expected


def test_filler_dictionary_update_enforces_max_after_dedup() -> None:
    # 105 raw items reducing to 100 unique non-empty items should succeed
    raw_within_limit = [f"word_{i}" for i in range(100)] + ["WORD_0", "word_1", "  ", ""]
    parsed = FillerDictionaryUpdate(words=raw_within_limit)
    assert len(parsed.words) == 100

    # 101 unique normalized items must fail validation
    too_many = [f"word_{i}" for i in range(MAX_FILLER_WORDS + 1)]
    with pytest.raises(ValidationError, match="at most 100"):
        FillerDictionaryUpdate(words=too_many)


async def _promote_user_to_pro(db_session: AsyncSession, email: str) -> User:
    result = await db_session.execute(select(User).where(User.email == email))
    user = result.scalar_one()
    user.is_pro = True
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def test_filler_dictionary_requires_auth(async_client: AsyncClient) -> None:
    get_res = await async_client.get("/api/v1/filler-dictionary")
    assert get_res.status_code == 401

    put_res = await async_client.put("/api/v1/filler-dictionary", json={"words": ["um"]})
    assert put_res.status_code == 401


async def test_filler_dictionary_rejects_free_user_with_403(
    async_client: AsyncClient,
    auth_headers_for: Callable[[str, str], Awaitable[dict[str, str]]],
) -> None:
    headers = await auth_headers_for("free_dict@example.com", "password123")

    get_res = await async_client.get("/api/v1/filler-dictionary", headers=headers)
    assert get_res.status_code == 403

    put_res = await async_client.put(
        "/api/v1/filler-dictionary",
        json={"words": ["basically"]},
        headers=headers,
    )
    assert put_res.status_code == 403


async def test_pro_user_filler_dictionary_crud_and_persistence(
    async_client: AsyncClient,
    db_session: AsyncSession,
    auth_headers_for: Callable[[str, str], Awaitable[dict[str, str]]],
) -> None:
    email = "pro_dict@example.com"
    headers = await auth_headers_for(email, "password123")
    await _promote_user_to_pro(db_session, email)

    initial_get = await async_client.get("/api/v1/filler-dictionary", headers=headers)
    assert initial_get.status_code == 200
    assert initial_get.json() == {"words": []}

    put_res = await async_client.put(
        "/api/v1/filler-dictionary",
        json={"words": ["  Basically ", "", "UM", "basically", "   ", "Actually", "um", "Kind Of"]},
        headers=headers,
    )
    assert put_res.status_code == 200
    assert put_res.json() == {"words": ["basically", "um", "actually", "kind of"]}

    after_get = await async_client.get("/api/v1/filler-dictionary", headers=headers)
    assert after_get.status_code == 200
    assert after_get.json() == {"words": ["basically", "um", "actually", "kind of"]}

    me_res = await async_client.get("/api/auth/me", headers=headers)
    assert me_res.status_code == 200
    assert me_res.json()["custom_filler_words"] == ["basically", "um", "actually", "kind of"]

    clear_res = await async_client.put(
        "/api/v1/filler-dictionary",
        json={"words": []},
        headers=headers,
    )
    assert clear_res.status_code == 200
    assert clear_res.json() == {"words": []}


async def test_pro_user_filler_dictionary_validation_boundaries(
    async_client: AsyncClient,
    db_session: AsyncSession,
    auth_headers_for: Callable[[str, str], Awaitable[dict[str, str]]],
) -> None:
    email = "pro_limits@example.com"
    headers = await auth_headers_for(email, "password123")
    await _promote_user_to_pro(db_session, email)

    # Exactly 100 unique words succeeds (including duplicates that collapse to 100)
    exact_100 = [f"filler_{i}" for i in range(100)] + ["FILLER_0", "   "]
    ok_res = await async_client.put(
        "/api/v1/filler-dictionary",
        json={"words": exact_100},
        headers=headers,
    )
    assert ok_res.status_code == 200
    assert len(ok_res.json()["words"]) == 100

    # 101 unique words returns 422 and preserves prior persisted list
    over_limit = [f"new_filler_{i}" for i in range(101)]
    fail_res = await async_client.put(
        "/api/v1/filler-dictionary",
        json={"words": over_limit},
        headers=headers,
    )
    assert fail_res.status_code == 422

    current_get = await async_client.get("/api/v1/filler-dictionary", headers=headers)
    assert current_get.status_code == 200
    assert current_get.json()["words"] == [f"filler_{i}" for i in range(100)]


@pytest.mark.parametrize(
    "bad_payload",
    [
        {},
        {"words": "um"},
        {"words": [123]},
        {"words": [None]},
    ],
)
async def test_pro_user_filler_dictionary_invalid_payloads_return_422(
    async_client: AsyncClient,
    db_session: AsyncSession,
    auth_headers_for: Callable[[str, str], Awaitable[dict[str, str]]],
    bad_payload: dict[str, object],
) -> None:
    email = f"bad_payload_{hash(str(bad_payload))}@example.com"
    headers = await auth_headers_for(email, "password123")
    await _promote_user_to_pro(db_session, email)

    res = await async_client.put(
        "/api/v1/filler-dictionary",
        json=bad_payload,
        headers=headers,
    )
    assert res.status_code == 422
