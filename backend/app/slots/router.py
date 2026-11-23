import random
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.core.database import get_db
from app.core.security import get_current_user
from app.slots.schemas import (
    BASE_WIN_RATE,
    MAX_SPINS_CAP,
    MILESTONE_SYMBOLS,
    SYMBOLS,
    SpinResponse,
)

router = APIRouter(prefix="/api/slots", tags=["slots"])


def generate_losing_reels() -> tuple[str, str, str]:
    """Generate 3 milestone symbols that are not all identical."""
    while True:
        reels = (
            random.choice(SYMBOLS),  # noqa: S311
            random.choice(SYMBOLS),  # noqa: S311
            random.choice(SYMBOLS),  # noqa: S311
        )
        if len(set(reels)) > 1:
            return reels


async def spin_slot_machine(db: AsyncSession, user: User) -> SpinResponse:
    """Evaluate a Speech Performance Milestone check toward Pace Mastery PRO."""
    if user.is_pro:
        return SpinResponse(
            reels=("DIAMOND", "DIAMOND", "DIAMOND"),
            is_jackpot=True,
            is_pro=True,
            spin_count=user.spin_count,
            spins_remaining=0,
            message="You already unlocked PRO!",
        )

    user.spin_count += 1
    is_cycle_milestone = user.spin_count % MAX_SPINS_CAP == 0
    is_win = True if is_cycle_milestone else (random.random() < BASE_WIN_RATE)  # noqa: S311

    if is_win:
        user.is_pro = True
        milestone_symbol = (
            "DIAMOND" if is_cycle_milestone else random.choice(MILESTONE_SYMBOLS)  # noqa: S311
        )
        reels: tuple[str, str, str] = (milestone_symbol, milestone_symbol, milestone_symbol)
        spins_remaining = 0
        message = (
            "Pace Mastery Milestone Achieved — PRO Unlocked!"
            if is_cycle_milestone
            else "Speech Performance Milestone Complete — PRO Unlocked!"
        )
    else:
        reels = generate_losing_reels()
        spins_remaining = max(0, MAX_SPINS_CAP - user.spin_count)
        message = (
            "Keep refining your pacing! Complete another speech check to advance Pace Mastery."
        )

    db.add(user)
    await db.commit()
    await db.refresh(user)

    return SpinResponse(
        reels=reels,
        is_jackpot=is_win,
        is_pro=user.is_pro,
        spin_count=user.spin_count,
        spins_remaining=spins_remaining,
        message=message,
    )


@router.post("/spin")
async def spin_slots(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SpinResponse:
    """Evaluate speech performance milestones toward Pace Mastery PRO unlock."""
    return await spin_slot_machine(db=db, user=current_user)
