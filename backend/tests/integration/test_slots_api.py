from collections.abc import Awaitable, Callable

import pytest
from httpx import AsyncClient

from app.slots.schemas import SYMBOLS


async def test_spin_requires_auth(async_client: AsyncClient) -> None:
    resp = await async_client.post("/api/slots/spin")
    assert resp.status_code == 401


@pytest.mark.parametrize(
    ("rng_value", "expected_win", "expected_remaining"),
    [
        (0.0, True, 0),
        (0.349, True, 0),
        (0.35, False, 2),
        (0.99, False, 2),
    ],
)
async def test_first_spin_rng_threshold_matrix(
    async_client: AsyncClient,
    auth_headers_for: Callable[[str, str], Awaitable[dict[str, str]]],
    monkeypatch: pytest.MonkeyPatch,
    rng_value: float,
    expected_win: bool,
    expected_remaining: int,
) -> None:
    headers = await auth_headers_for(f"rng_{rng_value}@example.com", "password123")
    monkeypatch.setattr("app.slots.router.random.random", lambda: rng_value)

    resp = await async_client.post("/api/slots/spin", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_jackpot"] is expected_win
    assert data["is_pro"] is expected_win
    assert data["spin_count"] == 1
    assert data["spins_remaining"] == expected_remaining
    assert all(sym in SYMBOLS for sym in data["reels"])
    if expected_win:
        assert len(set(data["reels"])) == 1
    else:
        assert len(set(data["reels"])) > 1


async def test_guaranteed_third_spin_pity_and_idempotency(
    async_client: AsyncClient,
    auth_headers_for: Callable[[str, str], Awaitable[dict[str, str]]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await auth_headers_for("pity@example.com", "password123")
    monkeypatch.setattr("app.slots.router.random.random", lambda: 0.99)

    r1 = (await async_client.post("/api/slots/spin", headers=headers)).json()
    assert (r1["is_jackpot"], r1["spin_count"], r1["spins_remaining"]) == (False, 1, 2)

    r2 = (await async_client.post("/api/slots/spin", headers=headers)).json()
    assert (r2["is_jackpot"], r2["spin_count"], r2["spins_remaining"]) == (False, 2, 1)

    r3 = (await async_client.post("/api/slots/spin", headers=headers)).json()
    assert r3["is_jackpot"] is True
    assert r3["is_pro"] is True
    assert r3["spin_count"] == 3
    assert r3["spins_remaining"] == 0
    assert r3["reels"] == ["DIAMOND", "DIAMOND", "DIAMOND"]

    r4 = (await async_client.post("/api/slots/spin", headers=headers)).json()
    assert r4["is_jackpot"] is True
    assert r4["is_pro"] is True
    assert r4["spin_count"] == 3
    assert r4["spins_remaining"] == 0
    assert r4["message"] == "You already unlocked PRO!"

    me = (await async_client.get("/api/auth/me", headers=headers)).json()
    assert me["is_pro"] is True
    assert me["spin_count"] == 3
    assert me["spins_remaining"] == 0
