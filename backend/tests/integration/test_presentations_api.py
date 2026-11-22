from collections.abc import Awaitable, Callable

import pytest
from httpx import AsyncClient


async def test_presentations_require_auth(async_client: AsyncClient) -> None:
    assert (await async_client.get("/api/presentations")).status_code == 401
    assert (await async_client.post("/api/presentations", json={})).status_code == 401


@pytest.mark.parametrize(
    "bad_payload",
    [
        {
            "title": "",
            "target_duration_sec": 60,
            "actual_duration_sec": 60,
            "word_count": 100,
            "wpm": 120.0,
            "pause_count": 0,
            "total_pause_sec": 0.0,
        },
        {
            "title": "Valid",
            "target_duration_sec": 0,
            "actual_duration_sec": 60,
            "word_count": 100,
            "wpm": 120.0,
            "pause_count": 0,
            "total_pause_sec": 0.0,
        },
        {
            "title": "Valid",
            "target_duration_sec": 60,
            "actual_duration_sec": -1,
            "word_count": 100,
            "wpm": 120.0,
            "pause_count": 0,
            "total_pause_sec": 0.0,
        },
        {
            "title": "Valid",
            "target_duration_sec": 60,
            "actual_duration_sec": 60,
            "word_count": 100,
            "wpm": -5.0,
            "pause_count": 0,
            "total_pause_sec": 0.0,
        },
        {
            "title": "Valid",
            "target_duration_sec": 60,
            "actual_duration_sec": 60,
            "word_count": 100,
            "wpm": 120.0,
            "pause_count": 0,
            "total_pause_sec": 0.0,
            "estimation_method": "unknown",
        },
    ],
)
async def test_create_presentation_validation_errors(
    async_client: AsyncClient,
    auth_headers_for: Callable[[str, str], Awaitable[dict[str, str]]],
    bad_payload: dict[str, object],
) -> None:
    headers = await auth_headers_for("val@example.com", "password123")
    resp = await async_client.post("/api/presentations", json=bad_payload, headers=headers)
    assert resp.status_code == 422


async def test_pro_user_with_zero_presentations_stats(
    async_client: AsyncClient,
    auth_headers_for: Callable[[str, str], Awaitable[dict[str, str]]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await auth_headers_for("emptypro@example.com", "password123")
    monkeypatch.setattr("app.slots.router.random.random", lambda: 0.05)
    assert (await async_client.post("/api/slots/spin", headers=headers)).json()["is_pro"] is True

    list_resp = await async_client.get("/api/presentations", headers=headers)
    assert list_resp.status_code == 200
    data = list_resp.json()
    assert data["is_pro"] is True
    assert data["total_count"] == 0
    assert data["locked_history_count"] == 0
    assert data["items"] == []
    assert data["stats"] == {
        "total_sessions": 0,
        "total_practice_sec": 0,
        "avg_wpm": 0.0,
        "avg_pauses": 0.0,
    }


async def test_free_tier_capping_and_pro_unmasking(
    async_client: AsyncClient,
    auth_headers_for: Callable[[str, str], Awaitable[dict[str, str]]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await auth_headers_for("tier@example.com", "password123")
    sessions = [
        {
            "title": "Pitch 1 - Slow & Short",
            "target_duration_sec": 300,
            "actual_duration_sec": 200,
            "word_count": 300,
            "wpm": 90.0,
            "pause_count": 4,
            "total_pause_sec": 8.5,
            "estimation_method": "speech_api",
        },
        {
            "title": "Pitch 2 - Optimal & On Time",
            "target_duration_sec": 300,
            "actual_duration_sec": 295,
            "word_count": 650,
            "wpm": 132.2,
            "pause_count": 2,
            "total_pause_sec": 3.2,
            "estimation_method": "speech_api",
        },
        {
            "title": "Pitch 3 - Fast & Overtime",
            "target_duration_sec": 300,
            "actual_duration_sec": 350,
            "word_count": 1050,
            "wpm": 180.0,
            "pause_count": 1,
            "total_pause_sec": 1.6,
            "estimation_method": "audio_burst",
        },
        {
            "title": "Pitch 4 - Recent",
            "target_duration_sec": 180,
            "actual_duration_sec": 180,
            "word_count": 420,
            "wpm": 140.0,
            "pause_count": 3,
            "total_pause_sec": 5.0,
            "estimation_method": "manual",
        },
        {
            "title": "Pitch 5 - Latest",
            "target_duration_sec": 60,
            "actual_duration_sec": 60,
            "word_count": 150,
            "wpm": 150.0,
            "pause_count": 0,
            "total_pause_sec": 0.0,
            "estimation_method": "speech_api",
            "score": 92,
            "filler_count": 2,
            "top_fillers_json": '{"like": 2}',
            "pacing_timeline_json": '[{"sec": 10, "wpm": 145}]',
            "verdict": "Sharp delivery.",
        },
    ]

    for s in sessions:
        res = await async_client.post("/api/presentations", json=s, headers=headers)
        assert res.status_code == 201
        assert res.json()["is_analytics_locked"] is True

    free_data = (await async_client.get("/api/presentations", headers=headers)).json()
    assert free_data["is_pro"] is False
    assert free_data["total_count"] == 5
    assert free_data["locked_history_count"] == 2
    assert len(free_data["items"]) == 3
    assert free_data["stats"]["avg_wpm"] is None
    assert free_data["stats"]["avg_pauses"] is None

    monkeypatch.setattr("app.slots.router.random.random", lambda: 0.05)
    assert (await async_client.post("/api/slots/spin", headers=headers)).json()["is_pro"] is True

    pro_data = (await async_client.get("/api/presentations", headers=headers)).json()
    assert pro_data["is_pro"] is True
    assert pro_data["total_count"] == 5
    assert pro_data["locked_history_count"] == 0
    assert len(pro_data["items"]) == 5
    assert pro_data["stats"]["avg_wpm"] == round((90.0 + 132.2 + 180.0 + 140.0 + 150.0) / 5, 1)
    assert pro_data["stats"]["avg_pauses"] == 2.0

    by_title = {item["title"]: item for item in pro_data["items"]}
    assert by_title["Pitch 1 - Slow & Short"]["pacing_status"] == "too_slow"
    assert by_title["Pitch 1 - Slow & Short"]["timing_status"] == "under_time"
    assert by_title["Pitch 2 - Optimal & On Time"]["pacing_status"] == "optimal"
    assert by_title["Pitch 2 - Optimal & On Time"]["timing_status"] == "on_time"
    assert by_title["Pitch 3 - Fast & Overtime"]["pacing_status"] == "too_fast"
    assert by_title["Pitch 3 - Fast & Overtime"]["timing_status"] == "overtime"
    assert by_title["Pitch 5 - Latest"]["filler_count"] == 2
