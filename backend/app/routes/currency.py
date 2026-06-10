"""Currency route handlers"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.currency import Currency
from app.schemas.currency import CurrencyResponse

router = APIRouter(prefix="/currencies", tags=["currencies"])


@router.get("", response_model=list[CurrencyResponse])
async def list_currencies(
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return all supported currencies.

    Args:
        db: Async database session.

    Returns:
        List of all currencies sorted by ISO code.
    """
    result = await db.execute(select(Currency).order_by(Currency.id))
    return result.scalars().all()


@router.get("/{currency_id}", response_model=CurrencyResponse)
async def get_currency(
    currency_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single currency by its ISO 4217 code.

    Args:
        currency_id: ISO 4217 currency code (e.g., "CAD").
        db: Async database session.

    Returns:
        The matching currency.

    Raises:
        HTTPException 404: Currency code not found.
    """
    result = await db.execute(select(Currency).where(Currency.id == currency_id))
    currency = result.scalar_one_or_none()
    if not currency:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Currency not found")
    return currency
