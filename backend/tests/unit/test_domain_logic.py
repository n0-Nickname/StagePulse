from datetime import UTC, datetime

import pytest

from app.auth.models import User
from app.presentations.models import Presentation
from app.presentations.router import (
    classify_pacing,
    classify_timing,
    format_presentation_item,
)
from app.slots.router import generate_losing_reels


@pytest.mark.parametrize(
    ("is_pro", "spin_count", "expected_remaining"),
    [
        (False, 0, 3),
        (False, 1, 2),
        (False, 2, 1),
        (False, 3, 0),
        (False, 5, 0),
        (True, 0, 0),
        (True, 2, 0),
    ],
)
def test_user_spins_remaining(is_pro: bool, spin_count: int, expected_remaining: int) -> None:
    user = User(
        email="unit@example.com",
        password_hash="hashed",
        is_pro=is_pro,
        spin_count=spin_count,
    )
    assert user.spins_remaining == expected_remaining
    assert not hasattr(User, "username")


@pytest.mark.parametrize(
    ("wpm", "expected"),
    [
        (0.0, "too_slow"),
        (109.9, "too_slow"),
        (110.0, "optimal"),
        (135.0, "optimal"),
        (160.0, "optimal"),
        (160.1, "too_fast"),
        (250.0, "too_fast"),
    ],
)
def test_classify_pacing_boundaries(wpm: float, expected: str) -> None:
    assert classify_pacing(wpm) == expected


@pytest.mark.parametrize(
    ("actual", "target", "expected"),
    [
        (0, 100, "under_time"),
        (79, 100, "under_time"),
        (80, 100, "on_time"),
        (100, 100, "on_time"),
        (105, 100, "on_time"),
        (106, 100, "overtime"),
    ],
)
def test_classify_timing_boundaries(actual: int, target: int, expected: str) -> None:
    assert classify_timing(actual, target) == expected


@pytest.mark.parametrize(
    ("is_pro", "mask_for_free", "expected_locked"),
    [
        (False, True, True),
        (False, False, True),
        (True, True, False),
        (True, False, False),
    ],
)
def test_format_presentation_item_masking(
    is_pro: bool, mask_for_free: bool, expected_locked: bool
) -> None:
    row = Presentation(
        id=1,
        user_id=1,
        title="Keynote",
        target_duration_sec=100,
        actual_duration_sec=100,
        word_count=250,
        wpm=150.14,
        pause_count=2,
        total_pause_sec=3.456,
        estimation_method="speech_api",
        score=90,
        filler_count=1,
        top_fillers_json='{"um": 1}',
        pacing_timeline_json="[]",
        verdict="Great",
        created_at=datetime.now(UTC),
    )
    item = format_presentation_item(row, is_pro=is_pro, mask_for_free=mask_for_free)
    assert item.is_analytics_locked is expected_locked
    if mask_for_free and not is_pro:
        assert item.wpm is None
        assert item.pause_count is None
        assert item.pacing_status is None
        assert item.filler_count is None
    else:
        assert item.wpm == 150.1
        assert item.total_pause_sec == 3.46
        assert item.pacing_status == "optimal"
        assert item.filler_count == 1


def test_generate_losing_reels_retries_on_accidental_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    choices = iter(["DIAMOND", "DIAMOND", "DIAMOND", "MIC", "TIMER", "CLOWN"])

    def _fake_choice(_seq: list[str]) -> str:
        return next(choices)

    monkeypatch.setattr("app.slots.router.random.choice", _fake_choice)
    reels = generate_losing_reels()
    assert reels == ("MIC", "TIMER", "CLOWN")
    assert len(set(reels)) > 1
