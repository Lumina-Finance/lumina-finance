"""Bank sync API routes"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.bank_sync import BankProvidersResponse
from app.services.bank_sync.availability import list_providers

router = APIRouter(prefix="/bank-sync", tags=["bank-sync"])


@router.get("/providers", response_model=BankProvidersResponse)
async def list_bank_providers(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the providers the deployment enables, and whether the user can link bank accounts now

    Args:
        user: Authenticated user choosing a provider
        db: Active database session

    Returns:
        The bank-linking check, whether sync is running, and each enabled provider's facts
    """
    return await list_providers(db, user)
