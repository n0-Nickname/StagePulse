"""Presentations router (/api/presentations)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.presentation import (
    PresentationCreate,
    PresentationItem,
    PresentationListResponse,
)
from app.services.presentation_service import (
    create_presentation,
    list_presentations,
)

router = APIRouter(prefix="/api/presentations", tags=["presentations"])


@router.post(
    "",
    response_model=PresentationItem,
    status_code=status.HTTP_201_CREATED,
)
def create_presentation_endpoint(
    payload: PresentationCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> PresentationItem:
    """Record a finished presentation session."""
    return create_presentation(db=db, user=current_user, payload=payload)


@router.get("", response_model=PresentationListResponse)
def list_presentations_endpoint(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> PresentationListResponse:
    """Fetch presentation history and aggregate stats (tiered by Free vs PRO)."""
    return list_presentations(db=db, user=current_user)
