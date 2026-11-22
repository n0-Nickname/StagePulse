"""Slot machine Gacha paywall service with 3-spin pity guarantee."""
from __future__ import annotations

import random
from sqlalchemy.orm import Session

from app.models.user import User
from app.schemas.slot import SpinResponse

SYMBOLS: list[str] = ["MIC", "TIMER", "DIAMOND", "FIRE", "CLOWN"]
JACKPOT_SYMBOLS: list[str] = ["DIAMOND", "MIC", "TIMER", "FIRE"]
MAX_SPINS_CAP: int = 3
BASE_WIN_RATE: float = 0.35


def _generate_losing_reels() -> tuple[str, str, str]:
    """Generate 3 symbols guaranteed not to be all identical."""
    while True:
        reels = (
            random.choice(SYMBOLS),
            random.choice(SYMBOLS),
            random.choice(SYMBOLS),
        )
        if len(set(reels)) > 1:
            return reels


def spin_slot_machine(db: Session, user: User) -> SpinResponse:
    """Execute a slot machine spin for the given user.

    Rules:
    - If user is already PRO, return idempotent jackpot state without incrementing spin_count.
    - Increment user.spin_count by 1.
    - Guaranteed 3rd-spin pity: if user.spin_count % 3 == 0, force is_win = True ("DIAMOND" jackpot).
    - Otherwise, roll random.random() < 0.35.
    """
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
    is_win = True if is_pity_spin else (random.random() < BASE_WIN_RATE)

    if is_win:
        user.is_pro = True
        jackpot_symbol = "DIAMOND" if is_pity_spin else random.choice(JACKPOT_SYMBOLS)
        reels: tuple[str, str, str] = (jackpot_symbol, jackpot_symbol, jackpot_symbol)
        spins_remaining = 0
        if is_pity_spin:
            message = "JACKPOT! 3rd-Spin Pity Guarantee triggered — PRO Unlocked!"
        else:
            message = "JACKPOT! Lucky spin — PRO Unlocked!"
    else:
        reels = _generate_losing_reels()
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
