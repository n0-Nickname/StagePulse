from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.auth.models import User


class Presentation(Base):
    """Persisted presentation rehearsal session and speech analytics."""

    __tablename__ = "presentations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    target_duration_sec: Mapped[int] = mapped_column(Integer, nullable=False)
    actual_duration_sec: Mapped[int] = mapped_column(Integer, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False)
    wpm: Mapped[float] = mapped_column(Float, nullable=False)
    pause_count: Mapped[int] = mapped_column(Integer, nullable=False)
    total_pause_sec: Mapped[float] = mapped_column(Float, nullable=False)
    estimation_method: Mapped[str] = mapped_column(String(50), default="speech_api", nullable=False)
    score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    filler_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    top_fillers_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    pacing_timeline_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    verdict: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        index=True,
        nullable=False,
    )

    user: Mapped[User] = relationship("User", back_populates="presentations")
