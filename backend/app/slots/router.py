import random
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.database import get_db
from app.core.security import get_current_user
from app.slots.schemas import (
    BASE_WIN_RATE,
    JACKPOT_SYMBOLS,
    MAX_SPINS_CAP,
    SYMBOLS,
    SpinResponse,
)

router = APIRouter(prefix="/api/slots", tags=["slots"])


def generate_losing_reels() -> tuple[str, str, str]:
    """Generate 3 symbols guaranteed not to be all identical."""
    while True:
        reels = (
            random.choice(SYMBOLS),  # noqa: S311
            random.choice(SYMBOLS),  # noqa: S311
            random.choice(SYMBOLS),  # noqa: S311
        )
        if len(set(reels)) > 1:
            return reels


def spin_slot_machine(db: Session, user: User) -> SpinResponse:
    """Execute a slot spin with RNG and deterministic 3rd-spin pity jackpot."""
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
    is_pity_spin = user.spin_count % MAX_SPINS_CAP == 0
    is_win = True if is_pity_spin else (random.random() < BASE_WIN_RATE)  # noqa: S311

    if is_win:
        user.is_pro = True
        jackpot_symbol = (
            "DIAMOND" if is_pity_spin else random.choice(JACKPOT_SYMBOLS)  # noqa: S311
        )
        reels: tuple[str, str, str] = (jackpot_symbol, jackpot_symbol, jackpot_symbol)
        spins_remaining = 0
        message = (
            "JACKPOT! 3rd-Spin Pity Guarantee triggered — PRO Unlocked!"
            if is_pity_spin
            else "JACKPOT! Lucky spin — PRO Unlocked!"
        )
    else:
        reels = generate_losing_reels()
        spins_remaining = max(0, MAX_SPINS_CAP - user.spin_count)
        message = f"No match! {spins_remaining} spin(s) left until guaranteed PRO jackpot."

    db.add(user)
    db.commit()
    db.refresh(user)

    return SpinResponse(
        reels=reels,
        is_jackpot=is_win,
        is_pro=user.is_pro,
        spin_count=user.spin_count,
        spins_remaining=spins_remaining,
        message=message,
    )


@router.post("/spin")
def spin_slots(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SpinResponse:
    """Spin the 3-reel Gacha slot machine to unlock PRO features."""
    return spin_slot_machine(db=db, user=current_user)
