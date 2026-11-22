"""Presentation persistence, pacing/timing classification, and Free vs PRO tier gating."""
from __future__ import annotations

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.models.presentation import Presentation
from app.models.user import User
from app.schemas.presentation import (
    DashboardStats,
    PresentationCreate,
    PresentationItem,
    PresentationListResponse,
)

FREE_HISTORY_LIMIT: int = 3


def classify_pacing(wpm: float) -> str:
    """Classify speaking rate (words per minute)."""
    if wpm < 110:
        return "too_slow"
    if wpm <= 160:
        return "optimal"
    return "too_fast"


def classify_timing(actual_duration_sec: int, target_duration_sec: int) -> str:
    """Classify presentation duration against target duration."""
    if actual_duration_sec < target_duration_sec * 0.8:
        return "under_time"
    if actual_duration_sec <= target_duration_sec * 1.05:
        return "on_time"
    return "overtime"


def format_presentation_item(
    row: Presentation,
    *,
    is_pro: bool,
    mask_for_free: bool = True,
) -> PresentationItem:
    """Convert a Presentation ORM row into a PresentationItem schema.

    When mask_for_free=True and is_pro=False, detailed pacing/pause metrics are masked (None)
    and is_analytics_locked is set to True.
    """
    timing_status = classify_timing(row.actual_duration_sec, row.target_duration_sec)
    should_mask = mask_for_free and not is_pro

    if should_mask:
        return PresentationItem(
            id=row.id,
            title=row.title,
            target_duration_sec=row.target_duration_sec,
            actual_duration_sec=row.actual_duration_sec,
            word_count=row.word_count,
            wpm=None,
            pause_count=None,
            total_pause_sec=None,
            pacing_status=None,
            timing_status=timing_status,
            estimation_method=row.estimation_method,
            score=row.score,
            verdict=row.verdict,
            filler_count=None,
            top_fillers_json=None,
            pacing_timeline_json=None,
            is_analytics_locked=True,
            created_at=row.created_at,
        )

    return PresentationItem(
        id=row.id,
        title=row.title,
        target_duration_sec=row.target_duration_sec,
        actual_duration_sec=row.actual_duration_sec,
        word_count=row.word_count,
        wpm=round(float(row.wpm), 1),
        pause_count=row.pause_count,
        total_pause_sec=round(float(row.total_pause_sec), 2),
        pacing_status=classify_pacing(row.wpm),
        timing_status=timing_status,
        estimation_method=row.estimation_method,
        score=row.score,
        verdict=row.verdict,
        filler_count=row.filler_count,
        top_fillers_json=row.top_fillers_json,
        pacing_timeline_json=row.pacing_timeline_json,
        is_analytics_locked=not is_pro,
        created_at=row.created_at,
    )


def create_presentation(
    db: Session,
    user: User,
    payload: PresentationCreate,
) -> PresentationItem:
    """Persist a completed presentation practice session for the user."""
    row = Presentation(
        user_id=user.id,
        title=payload.title,
        target_duration_sec=payload.target_duration_sec,
        actual_duration_sec=payload.actual_duration_sec,
        word_count=payload.word_count,
        wpm=payload.wpm,
        pause_count=payload.pause_count,
        total_pause_sec=payload.total_pause_sec,
        estimation_method=payload.estimation_method,
        score=payload.score,
        filler_count=payload.filler_count,
        top_fillers_json=payload.top_fillers_json,
        pacing_timeline_json=payload.pacing_timeline_json,
        verdict=payload.verdict,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return format_presentation_item(row, is_pro=user.is_pro, mask_for_free=True)


def list_presentations(db: Session, user: User) -> PresentationListResponse:
    """List presentations for the current user, enforcing Free vs PRO tier gating."""
    all_rows: list[Presentation] = (
        db.query(Presentation)
        .filter(Presentation.user_id == user.id)
        .order_by(desc(Presentation.created_at), desc(Presentation.id))
        .all()
    )

    total_count = len(all_rows)
    total_practice_sec = sum(r.actual_duration_sec for r in all_rows)

    if user.is_pro:
        visible_rows = all_rows
        locked_history_count = 0
        if total_count > 0:
            avg_wpm: float | None = round(
                sum(r.wpm for r in all_rows) / total_count, 1
            )
            avg_pauses: float | None = round(
                sum(r.pause_count for r in all_rows) / total_count, 1
            )
        else:
            avg_wpm = 0.0
            avg_pauses = 0.0
    else:
        visible_rows = all_rows[:FREE_HISTORY_LIMIT]
        locked_history_count = max(0, total_count - FREE_HISTORY_LIMIT)
        avg_wpm = None
        avg_pauses = None

    items = [
        format_presentation_item(r, is_pro=user.is_pro, mask_for_free=True)
        for r in visible_rows
    ]

    stats = DashboardStats(
        total_sessions=total_count,
        total_practice_sec=total_practice_sec,
        avg_wpm=avg_wpm,
        avg_pauses=avg_pauses,
    )

    return PresentationListResponse(
        items=items,
        total_count=total_count,
        locked_history_count=locked_history_count,
        is_pro=user.is_pro,
        stats=stats,
    )
