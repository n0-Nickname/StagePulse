from pydantic import BaseModel

SYMBOLS: list[str] = ["MIC", "TIMER", "DIAMOND", "FIRE", "CLOWN"]
MILESTONE_SYMBOLS: list[str] = ["DIAMOND", "MIC", "TIMER", "FIRE"]
MAX_SPINS_CAP: int = 3
BASE_WIN_RATE: float = 0.35


class SpinResponse(BaseModel):
    """Speech performance milestone check response."""

    reels: tuple[str, str, str]
    is_jackpot: bool
    is_pro: bool
    spin_count: int
    spins_remaining: int
    message: str
