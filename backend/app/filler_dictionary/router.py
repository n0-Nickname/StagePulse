from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.core.database import get_db
from app.core.security import get_current_user
from app.filler_dictionary.schemas import FillerDictionaryResponse, FillerDictionaryUpdate

router = APIRouter(prefix="/api/v1/filler-dictionary", tags=["filler-dictionary"])


def require_pro_user(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    """Ensure the authenticated user has PRO tier access."""
    if not current_user.is_pro:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="PRO access required for custom filler dictionary",
        )
    return current_user


@router.get("", status_code=status.HTTP_200_OK)
async def get_filler_dictionary(
    current_user: Annotated[User, Depends(require_pro_user)],
) -> FillerDictionaryResponse:
    """Return the authenticated PRO user's custom filler-word dictionary."""
    return FillerDictionaryResponse(words=list(current_user.custom_filler_words))


@router.put("", status_code=status.HTTP_200_OK)
async def update_filler_dictionary(
    payload: FillerDictionaryUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_pro_user)],
) -> FillerDictionaryResponse:
    """Replace the authenticated PRO user's custom filler-word dictionary."""
    # Assign a fresh list so SQLAlchemy detects mutation on the JSON/JSONB column.
    current_user.custom_filler_words = list(payload.words)
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    return FillerDictionaryResponse(words=list(current_user.custom_filler_words))
