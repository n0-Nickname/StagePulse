import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_full_user_journey_free_to_pro(
    async_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    health = await async_client.get("/api/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok"}

    # 1. Register & login
    reg = await async_client.post(
        "/api/auth/register",
        json={"email": "Journey@Example.com", "password": "strongpassword"},
    )
    assert reg.status_code == 201
    assert reg.json()["user"]["email"] == "journey@example.com"

    login = await async_client.post(
        "/api/auth/login",
        json={"email": "journey@example.com", "password": "strongpassword"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Record 4 presentations as Free user -> capped at 3 visible, 1 locked
    for idx in range(1, 5):
        create_res = await async_client.post(
            "/api/presentations",
            json={
                "title": f"Rehearsal {idx}",
                "target_duration_sec": 120,
                "actual_duration_sec": 120,
                "word_count": 260,
                "wpm": 130.0,
                "pause_count": 2,
                "total_pause_sec": 2.5,
                "estimation_method": "speech_api",
                "score": 85,
                "filler_count": 1,
                "top_fillers_json": '{"um": 1}',
                "pacing_timeline_json": '[{"sec": 15, "wpm": 130}]',
                "verdict": "Steady pace.",
            },
            headers=headers,
        )
        assert create_res.status_code == 201
        assert create_res.json()["is_analytics_locked"] is True

    free_list = await async_client.get("/api/presentations", headers=headers)
    assert free_list.status_code == 200
    free_body = free_list.json()
    assert free_body["total_count"] == 4
    assert free_body["locked_history_count"] == 1
    assert len(free_body["items"]) == 3

    # 3. Spin slots 3 times with losing RNG -> guaranteed 3rd-spin DIAMOND jackpot
    monkeypatch.setattr("app.slots.router.random.random", lambda: 0.99)
    for expected_count in (1, 2):
        loss = await async_client.post("/api/slots/spin", headers=headers)
        assert loss.status_code == 200
        assert loss.json()["is_jackpot"] is False
        assert loss.json()["spin_count"] == expected_count

    win = await async_client.post("/api/slots/spin", headers=headers)
    assert win.status_code == 200
    assert win.json()["is_jackpot"] is True
    assert win.json()["is_pro"] is True
    assert win.json()["reels"] == ["DIAMOND", "DIAMOND", "DIAMOND"]

    # 4. Verify /api/auth/me and unmasked /api/presentations + PRO direct creation
    me = await async_client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["is_pro"] is True

    pro_list = await async_client.get("/api/presentations", headers=headers)
    assert pro_list.status_code == 200
    pro_body = pro_list.json()
    assert pro_body["locked_history_count"] == 0
    assert len(pro_body["items"]) == 4
    assert all(not item["is_analytics_locked"] for item in pro_body["items"])

    pro_create = await async_client.post(
        "/api/presentations",
        json={
            "title": "Final Dress Rehearsal",
            "target_duration_sec": 120,
            "actual_duration_sec": 115,
            "word_count": 270,
            "wpm": 140.8,
            "pause_count": 1,
            "total_pause_sec": 1.2,
            "estimation_method": "speech_api",
            "score": 95,
            "filler_count": 0,
            "verdict": "Ready for stage.",
        },
        headers=headers,
    )
    assert pro_create.status_code == 201
    assert pro_create.json()["is_analytics_locked"] is False
    assert pro_create.json()["wpm"] == 140.8
