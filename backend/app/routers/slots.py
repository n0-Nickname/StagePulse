"""Slot machine router (/api/slots)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.slot import SpinResponse
from app.services.slot_service import spin_slot_machine

router = APIRouter(prefix="/api/slots", tags=["slots"])


@router.post("/spin", response_model=SpinResponse)
def spin_slots(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SpinResponse:
    """Spin the 3-reel Gacha slot machine to unlock PRO features."""
    return spin_slot_machine(db=db, user=current_user)
