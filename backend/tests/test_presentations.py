"""Tests for /api/presentations creation, pacing/timing classification, and Free vs PRO tier gating."""
from __future__ import annotations

from unittest.mock import patch
from fastapi.testclient import TestClient


def _register_and_headers(client: TestClient, email: str = "speaker@example.com") -> dict[str, str]:
    resp = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "username": "Speaker",
            "password": "password123",
        },
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_presentations_require_auth(client: TestClient) -> None:
    assert client.get("/api/presentations").status_code in (401, 403)
    assert client.post("/api/presentations", json={}).status_code in (401, 403)


def test_free_tier_capping_and_pro_unmasking(client: TestClient) -> None:
    """Free users see max 3 presentations with masked WPM/pause fields; unlocking PRO unmasks all rows."""
    headers = _register_and_headers(client, "tier@example.com")

    sessions = [
        # 1: under_time (< 80% of 300 = 240), too_slow (wpm < 110)
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
        # 2: on_time (80%..105% of 300 = 240..315), optimal (110..160)
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
        # 3: overtime (> 105% of 300 = 315), too_fast (> 160)
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
        # 4: on_time, optimal
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
        # 5: most recent
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
        create_resp = client.post("/api/presentations", json=s, headers=headers)
        assert create_resp.status_code == 201, create_resp.text
        created_item = create_resp.json()
        assert created_item["title"] == s["title"]
        assert created_item["is_analytics_locked"] is True

    # 1. Verify Free tier response on GET /api/presentations
    free_resp = client.get("/api/presentations", headers=headers)
    assert free_resp.status_code == 200
    free_data = free_resp.json()

    assert free_data["is_pro"] is False
    assert free_data["total_count"] == 5
    assert free_data["locked_history_count"] == 2
    assert len(free_data["items"]) == 3

    # Most recent first (Pitch 5, Pitch 4, Pitch 3)
    assert [item["title"] for item in free_data["items"]] == [
        "Pitch 5 - Latest",
        "Pitch 4 - Recent",
        "Pitch 3 - Fast & Overtime",
    ]

    # Free tier masks wpm, pause_count, total_pause_sec, pacing_status, filler_count, top_fillers_json, pacing_timeline_json
    for item in free_data["items"]:
        assert item["is_analytics_locked"] is True
        assert item["wpm"] is None
        assert item["pause_count"] is None
        assert item["total_pause_sec"] is None
        assert item["pacing_status"] is None
        assert item["filler_count"] is None
        assert item["top_fillers_json"] is None
        assert item["pacing_timeline_json"] is None
        assert item["timing_status"] in ("under_time", "on_time", "overtime")
        assert isinstance(item["score"], int)
        assert isinstance(item["verdict"], str)

    latest_free = free_data["items"][0]
    assert latest_free["score"] == 92
    assert latest_free["verdict"] == "Sharp delivery."

    # Free tier stats keep total_sessions and total_practice_sec, mask avg_wpm & avg_pauses
    assert free_data["stats"]["total_sessions"] == 5
    assert free_data["stats"]["total_practice_sec"] == 200 + 295 + 350 + 180 + 60
    assert free_data["stats"]["avg_wpm"] is None
    assert free_data["stats"]["avg_pauses"] is None

    # 2. Unlock PRO via slot machine spin
    with patch("app.services.slot_service.random.random", return_value=0.05):
        spin_resp = client.post("/api/slots/spin", headers=headers)
        assert spin_resp.status_code == 200
        assert spin_resp.json()["is_pro"] is True

    # 3. Verify PRO tier response on GET /api/presentations
    pro_resp = client.get("/api/presentations", headers=headers)
    assert pro_resp.status_code == 200
    pro_data = pro_resp.json()

    assert pro_data["is_pro"] is True
    assert pro_data["total_count"] == 5
    assert pro_data["locked_history_count"] == 0
    assert len(pro_data["items"]) == 5

    by_title = {item["title"]: item for item in pro_data["items"]}

    p1 = by_title["Pitch 1 - Slow & Short"]
    assert p1["is_analytics_locked"] is False
    assert p1["wpm"] == 90.0
    assert p1["pause_count"] == 4
    assert p1["total_pause_sec"] == 8.5
    assert p1["pacing_status"] == "too_slow"
    assert p1["timing_status"] == "under_time"

    p2 = by_title["Pitch 2 - Optimal & On Time"]
    assert p2["pacing_status"] == "optimal"
    assert p2["timing_status"] == "on_time"

    p3 = by_title["Pitch 3 - Fast & Overtime"]
    assert p3["pacing_status"] == "too_fast"
    assert p3["timing_status"] == "overtime"

    p5 = by_title["Pitch 5 - Latest"]
    assert p5["is_analytics_locked"] is False
    assert p5["score"] == 92
    assert p5["verdict"] == "Sharp delivery."
    assert p5["filler_count"] == 2
    assert p5["top_fillers_json"] == '{"like": 2}'
    assert p5["pacing_timeline_json"] == '[{"sec": 10, "wpm": 145}]'

    # PRO stats should be unmasked and accurately averaged
    assert pro_data["stats"]["total_sessions"] == 5
    assert pro_data["stats"]["total_practice_sec"] == 1085
    assert pro_data["stats"]["avg_wpm"] == round((90.0 + 132.2 + 180.0 + 140.0 + 150.0) / 5, 1)
    assert pro_data["stats"]["avg_pauses"] == 2.0
