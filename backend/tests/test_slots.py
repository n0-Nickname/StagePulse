"""Tests for the Gacha Slot Machine paywall (/api/slots/spin) and 3rd-spin pity guarantee."""

from __future__ import annotations

from unittest.mock import patch

from app.services.slot_service import SYMBOLS, _generate_losing_reels
from fastapi.testclient import TestClient


def _register_and_headers(
    client: TestClient, email: str = "spinner@example.com"
) -> dict[str, str]:
    resp = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "password123",
        },
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_spin_requires_auth(client: TestClient) -> None:
    resp = client.post("/api/slots/spin")
    assert resp.status_code in (401, 403)


def test_generate_losing_reels_retries_on_accidental_match() -> None:
    choices = ["DIAMOND", "DIAMOND", "DIAMOND", "MIC", "TIMER", "CLOWN"]
    with patch("app.services.slot_service.random.choice", side_effect=choices):
        reels = _generate_losing_reels()
    assert reels == ("MIC", "TIMER", "CLOWN")
    assert len(set(reels)) > 1


def test_guaranteed_third_spin_pity_and_idempotency(client: TestClient) -> None:
    """When spins 1 and 2 lose (random >= 0.35), spin 3 MUST trigger guaranteed DIAMOND jackpot."""
    headers = _register_and_headers(client, "pity@example.com")

    # Force random.random() to return 0.99 so spins 1 and 2 cannot win via RNG
    with patch("app.services.slot_service.random.random", return_value=0.99):
        # Spin 1: loss
        r1 = client.post("/api/slots/spin", headers=headers)
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1["is_jackpot"] is False
        assert d1["is_pro"] is False
        assert d1["spin_count"] == 1
        assert d1["spins_remaining"] == 2
        assert len(d1["reels"]) == 3
        assert len(set(d1["reels"])) > 1
        assert all(sym in SYMBOLS for sym in d1["reels"])

        # Spin 2: loss
        r2 = client.post("/api/slots/spin", headers=headers)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["is_jackpot"] is False
        assert d2["is_pro"] is False
        assert d2["spin_count"] == 2
        assert d2["spins_remaining"] == 1
        assert len(set(d2["reels"])) > 1

        # Spin 3: 100% guaranteed pity win
        r3 = client.post("/api/slots/spin", headers=headers)
        assert r3.status_code == 200
        d3 = r3.json()
        assert d3["is_jackpot"] is True
        assert d3["is_pro"] is True
        assert d3["spin_count"] == 3
        assert d3["spins_remaining"] == 0
        assert d3["reels"] == ["DIAMOND", "DIAMOND", "DIAMOND"]

    # Spin 4 (already PRO): idempotent response, spin_count stays 3
    r4 = client.post("/api/slots/spin", headers=headers)
    assert r4.status_code == 200
    d4 = r4.json()
    assert d4["is_jackpot"] is True
    assert d4["is_pro"] is True
    assert d4["spin_count"] == 3
    assert d4["spins_remaining"] == 0
    assert d4["reels"] == ["DIAMOND", "DIAMOND", "DIAMOND"]
    assert d4["message"] == "You already unlocked PRO!"

    # Verify /api/auth/me reflects is_pro=True and spins_remaining=0
    me = client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    me_data = me.json()
    assert me_data["is_pro"] is True
    assert me_data["spin_count"] == 3
    assert me_data["spins_remaining"] == 0


def test_early_win_on_first_spin(client: TestClient) -> None:
    """When random.random() < 0.35 on spin 1, user immediately unlocks PRO."""
    headers = _register_and_headers(client, "lucky@example.com")

    with patch("app.services.slot_service.random.random", return_value=0.10):
        r1 = client.post("/api/slots/spin", headers=headers)
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1["is_jackpot"] is True
        assert d1["is_pro"] is True
        assert d1["spin_count"] == 1
        assert d1["spins_remaining"] == 0
        assert len(set(d1["reels"])) == 1
        assert d1["reels"][0] in SYMBOLS
