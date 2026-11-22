from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.presentation import Presentation


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, index=True, autoincrement=True
    )
    email: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_pro: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    spin_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    presentations: Mapped[list["Presentation"]] = relationship(
        "Presentation",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    @property
    def spins_remaining(self) -> int:
        return 0 if self.is_pro else max(0, 3 - self.spin_count)
