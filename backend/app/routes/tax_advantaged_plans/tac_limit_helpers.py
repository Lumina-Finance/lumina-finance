"""TAC limit route helpers"""
import uuid
from collections.abc import Mapping, Sequence
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedPlanLimit
from app.schemas.tax_advantaged_plan import CreateTaxAdvantagedPlanLimitRequest


async def get_tac_limits_for_plan(
    db: AsyncSession,
    plan_id: uuid.UUID,
) -> Sequence[TaxAdvantagedPlanLimit]:
    """Return TAC limit rows for a tax-advantaged plan

    Args:
        db: Active database session
        plan_id: Plan identifier whose limits should be listed

    Returns:
        TAC limit rows ordered by year
    """
    # Fetch every yearly limit row for the owned plan in chronological order
    result = await db.execute(
        select(TaxAdvantagedPlanLimit)
        .where(TaxAdvantagedPlanLimit.plan_id == plan_id)
        .order_by(TaxAdvantagedPlanLimit.year),
    )
    limit_rows = result.scalars().all()
    return limit_rows


async def validate_tac_limit_year_available(
    db: AsyncSession,
    plan_id: uuid.UUID,
    year: int,
) -> None:
    """Validate that a TAC limit year is available for a plan

    Args:
        db: Active database session
        plan_id: Plan identifier that owns the limit row
        year: Year requested for the new TAC limit

    Raises:
        HTTPException: Plan already has a limit row for the year
    """
    # Check the composite key before creating a yearly limit for this plan
    existing_limit = await db.get(TaxAdvantagedPlanLimit, (plan_id, year))
    if existing_limit:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A limit for this year already exists")


def build_tac_limit(
    plan_id: uuid.UUID,
    data: CreateTaxAdvantagedPlanLimitRequest,
) -> TaxAdvantagedPlanLimit:
    """Build a TAC limit row from a creation request

    Args:
        plan_id: Plan identifier that owns the limit row
        data: Yearly limit creation payload

    Returns:
        TAC limit row ready to add to the session
    """
    limit_row = TaxAdvantagedPlanLimit(
        plan_id=plan_id,
        year=data.year,
        contribution_limit=data.contribution_limit,
        withdrawal_limit=data.withdrawal_limit,
        accrued_contributions=data.accrued_contributions,
        accrued_withdrawals=data.accrued_withdrawals,
    )
    return limit_row


async def get_tac_limit_or_404(
    db: AsyncSession,
    plan_id: uuid.UUID,
    year: int,
) -> TaxAdvantagedPlanLimit:
    """Return a TAC limit row for a plan and year

    Args:
        db: Active database session
        plan_id: Plan identifier that owns the limit row
        year: Year to fetch

    Returns:
        TAC limit row for the requested plan and year

    Raises:
        HTTPException: TAC limit row does not exist
    """
    not_found_detail = "Tax-advantaged plan limit not found"

    # Fetch the limit row by plan and year after ownership has been verified
    limit_row = await db.get(TaxAdvantagedPlanLimit, (plan_id, year))
    if not limit_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail)
    return limit_row


def apply_tac_limit_updates(
    limit_row: TaxAdvantagedPlanLimit,
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
            detail="contribution_limit cannot be cleared; delete the limit row instead",
        )

    for field, value in updates.items():
        setattr(limit_row, field, value)
