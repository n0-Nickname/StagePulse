from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PresentationCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    target_duration_sec: int = Field(gt=0, le=7200)
    actual_duration_sec: int = Field(ge=0, le=14400)
    word_count: int = Field(ge=0)
    wpm: float = Field(ge=0.0)
    pause_count: int = Field(ge=0)
    total_pause_sec: float = Field(ge=0.0)
    estimation_method: Literal["speech_api", "audio_burst", "manual"] = "speech_api"
    score: int = Field(default=0, ge=0, le=100)
    filler_count: int = Field(default=0, ge=0)
    top_fillers_json: str = "{}"
    pacing_timeline_json: str = "[]"
    verdict: str = ""


class PresentationItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    target_duration_sec: int
    actual_duration_sec: int
    word_count: int
    wpm: float | None = None
    pause_count: int | None = None
    total_pause_sec: float | None = None
    pacing_status: str | None = None
    timing_status: str
    estimation_method: str
    score: int = 0
    verdict: str = ""
    filler_count: int | None = None
    top_fillers_json: str | None = None
    pacing_timeline_json: str | None = None
    is_analytics_locked: bool
    created_at: datetime


class DashboardStats(BaseModel):
    total_sessions: int
    total_practice_sec: int
    avg_wpm: float | None = None
    avg_pauses: float | None = None


class PresentationListResponse(BaseModel):
    items: list[PresentationItem]
    total_count: int
    locked_history_count: int
    is_pro: bool
    stats: DashboardStats
