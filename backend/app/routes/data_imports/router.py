"""Data import route handlers"""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.data_imports import (
    FireflyTransactionImportRequest,
    FireflyTransactionImportResponse,
)
from app.services.data_imports.firefly.service import import_firefly_transactions

router = APIRouter(prefix="/data-imports", tags=["data-imports"])


@router.post(
    "/firefly/transactions",
    response_model=FireflyTransactionImportResponse,
    status_code=status.HTTP_201_CREATED,
)
async def import_firefly_transaction_rows(
    data: FireflyTransactionImportRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Import journal rows from a Firefly III data export

    Rows between an imported account and an expense or revenue counterparty
    become single transactions, while rows between two imported accounts
    become transfer pairs. Rows that cannot convert are skipped and reported

    Args:
        data: Prepared Firefly III import payload from the frontend compiler
        user: Authenticated user running the import
        db: Active database session

    Returns:
        Import summary with converted, skipped, and created record counts
    """
    return await import_firefly_transactions(db, user, data)
