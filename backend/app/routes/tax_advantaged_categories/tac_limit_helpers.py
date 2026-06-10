"""TAC limit route helpers"""
import uuid
from collections.abc import Mapping, Sequence
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedCategoryLimit
from app.schemas.tax_advantaged_category import CreateTaxAdvantagedCategoryLimitRequest


async def get_tac_limits_for_tax_advantaged_category(
    db: AsyncSession,
    tax_advantaged_category_id: uuid.UUID,
) -> Sequence[TaxAdvantagedCategoryLimit]:
    """Return TAC limit rows for a tax-advantaged category

    Args:
        db: Active database session
        tax_advantaged_category_id: Tax-advantaged category identifier whose limits should be listed

    Returns:
        TAC limit rows ordered by year
    """
    # Fetch every yearly limit row for the owned tax-advantaged category in chronological order
    result = await db.execute(
        select(TaxAdvantagedCategoryLimit)
        .where(TaxAdvantagedCategoryLimit.tax_advantaged_category_id == tax_advantaged_category_id)
        .order_by(TaxAdvantagedCategoryLimit.year),
    )
    limit_rows = result.scalars().all()
    return limit_rows


async def validate_tac_limit_year_available(
    db: AsyncSession,
    tax_advantaged_category_id: uuid.UUID,
    year: int,
) -> None:
    """Validate that a TAC limit year is available for a tax-advantaged category

    Args:
        db: Active database session
        tax_advantaged_category_id: Tax-advantaged category identifier that owns the limit row
        year: Year requested for the new TAC limit

    Raises:
        HTTPException: Tax-advantaged category already has a limit row for the year
    """
    # Check the composite key before creating a yearly limit for this tax-advantaged category
    existing_limit = await db.get(TaxAdvantagedCategoryLimit, (tax_advantaged_category_id, year))
    if existing_limit:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A limit for this year already exists")


def build_tac_limit(
    tax_advantaged_category_id: uuid.UUID,
    data: CreateTaxAdvantagedCategoryLimitRequest,
) -> TaxAdvantagedCategoryLimit:
    """Build a TAC limit row from a creation request

    Args:
        tax_advantaged_category_id: Tax-advantaged category identifier that owns the limit row
        data: Yearly limit creation payload

    Returns:
        TAC limit row ready to add to the session
    """
    limit_row = TaxAdvantagedCategoryLimit(
        tax_advantaged_category_id=tax_advantaged_category_id,
        year=data.year,
        contribution_limit=data.contribution_limit,
        withdrawal_limit=data.withdrawal_limit,
        accrued_contributions=data.accrued_contributions,
        accrued_withdrawals=data.accrued_withdrawals,
    )
    return limit_row


async def get_tac_limit_or_404(
    db: AsyncSession,
    tax_advantaged_category_id: uuid.UUID,
    year: int,
) -> TaxAdvantagedCategoryLimit:
    """Return a TAC limit row for a tax-advantaged category and year

    Args:
        db: Active database session
        tax_advantaged_category_id: Tax-advantaged category identifier that owns the limit row
        year: Year to fetch

    Returns:
        TAC limit row for the requested tax-advantaged category and year

    Raises:
        HTTPException: TAC limit row does not exist
    """
    not_found_detail = "Tax-advantaged category limit not found"

    # Fetch the limit row by category and year after ownership has been verified
    limit_row = await db.get(TaxAdvantagedCategoryLimit, (tax_advantaged_category_id, year))
    if not limit_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail)
    return limit_row


def apply_tac_limit_updates(
    limit_row: TaxAdvantagedCategoryLimit,
    updates: Mapping[str, Any],
) -> None:
    """Apply explicit update fields to a TAC limit row

    Args:
        limit_row: TAC limit row being updated
        updates: Explicit fields from the update request

    Raises:
        HTTPException: Contribution limit is being cleared
    """
    if "contribution_limit" in updates and updates["contribution_limit"] is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Delete the limit row instead of clearing contribution_limit",
        )

    for field, value in updates.items():
        setattr(limit_row, field, value)
