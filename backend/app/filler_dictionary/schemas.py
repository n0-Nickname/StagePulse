from pydantic import BaseModel, ConfigDict, field_validator

MAX_FILLER_WORDS: int = 100


def normalize_filler_words(raw_words: list[str]) -> list[str]:
    """Strip, lowercase, drop empty strings, and deduplicate preserving order."""
    seen: set[str] = set()
    normalized: list[str] = []
    for raw in raw_words:
        cleaned = raw.strip().lower()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        normalized.append(cleaned)
    return normalized


class FillerDictionaryUpdate(BaseModel):
    """Request payload for replacing the user's custom filler-word dictionary."""

    model_config = ConfigDict(extra="forbid")

    words: list[str]

    @field_validator("words", mode="after")
    @classmethod
    def validate_and_normalize_words(cls, value: list[str]) -> list[str]:
        """Normalize entries and enforce max 100 unique filler words."""
        normalized = normalize_filler_words(value)
        if len(normalized) > MAX_FILLER_WORDS:
            msg = f"Custom filler dictionary may contain at most {MAX_FILLER_WORDS} words"
            raise ValueError(msg)
        return normalized


class FillerDictionaryResponse(BaseModel):
    """Response payload containing the user's normalized custom filler words."""

    words: list[str]
