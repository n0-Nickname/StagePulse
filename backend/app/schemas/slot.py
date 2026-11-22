from pydantic import BaseModel

SYMBOLS = ["MIC", "TIMER", "DIAMOND", "FIRE", "CLOWN"]
MAX_SPINS_CAP = 3


class SpinResponse(BaseModel):
    reels: tuple[str, str, str]
    is_jackpot: bool
    is_pro: bool
    spin_count: int
    spins_remaining: int
    message: str
