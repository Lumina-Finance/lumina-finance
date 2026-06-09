"""TAC plan route helpers"""
import uuid
from collections.abc import Mapping, Sequence
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedPlan
from app.models.base import TaxTreatment
from app.models.currency import Currency
from app.models.group import GroupMember
from app.schemas.tax_advantaged_plan import CreateTaxAdvantagedPlanRequest

_VALID_TAX_TREATMENTS = {tax_treatment.value for tax_treatment in TaxTreatment}


def validate_tax_advantaged_plan_tax_treatment(value: str) -> None:
    """Validate a tax treatment for a tax-advantaged plan

    Args:
        value: Tax treatment enum value from the request

    Raises:
        HTTPException: Tax treatment is invalid or taxable
    """
    if value not in _VALID_TAX_TREATMENTS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid tax treatment")
    if value == TaxTreatment.TAXABLE.value:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Tax-advantaged plans require a non-taxable tax treatment",
        )


async def validate_tax_advantaged_plan_group_scope(
    db: AsyncSession,
    group_id: uuid.UUID | None,
    user_id: uuid.UUID,
) -> None:
    """Validate that a plan can be owned in the requested group

    Args:
        db: Active database session
        group_id: Optional group context for the plan
        user_id: User that would own the plan

    Raises:
        HTTPException: Group is not visible to the user
    """
    if group_id is None:
        return

    # Check group membership so plans cannot be created in an inaccessible group
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
        ),
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Group not found")


async def get_owned_tax_advantaged_plan_or_404(
    db: AsyncSession,
    plan_id: uuid.UUID,
    user_id: uuid.UUID,
) -> TaxAdvantagedPlan:
    """Return a tax-advantaged plan owned by the authenticated user

    Args:
        db: Active database session
        plan_id: Plan identifier to fetch
        user_id: Authenticated user identifier

    Returns:
        Owned tax-advantaged plan

    Raises:
        HTTPException: Plan does not exist or belongs to another user
    """
    not_found_detail = "Tax-advantaged plan not found"

    # Fetch the plan directly before enforcing owner-only access
    plan = await db.get(TaxAdvantagedPlan, plan_id)
    if not plan or plan.plan_owner_user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail)
    return plan


async def get_tax_advantaged_plans_for_owner(
    db: AsyncSession,
    owner_id: uuid.UUID,
) -> Sequence[TaxAdvantagedPlan]:
    """Return tax-advantaged plans for a plan owner

    Args:
        db: Active database session
        owner_id: User identifier that owns the plans

    Returns:
        Tax-advantaged plans in creation order
    """
    # Fetch the user's plans in creation order before adding derived limit metrics
    result = await db.execute(
        select(TaxAdvantagedPlan)
        .where(TaxAdvantagedPlan.plan_owner_user_id == owner_id)
        .order_by(TaxAdvantagedPlan.created_at),
    )
    plans = result.scalars().all()
    return plans


async def validate_tax_advantaged_plan_currency(
    db: AsyncSession,
    currency_code: str,
) -> None:
    """Validate that a tax-advantaged plan currency is supported

    Args:
        db: Active database session
        currency_code: Currency code from the request

    Raises:
        HTTPException: Currency code is not supported
    """
    # Fetch the currency so plans cannot reference an unsupported currency code
    currency = await db.get(Currency, currency_code)
    if not currency:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")


def build_tac_plan(
    owner_id: uuid.UUID,
    data: CreateTaxAdvantagedPlanRequest,
) -> TaxAdvantagedPlan:
    """Build a tax-advantaged plan from a creation request

    Args:
        owner_id: User identifier that owns the plan
        data: Plan creation payload

    Returns:
        Tax-advantaged plan ready to add to the session
    """
    plan = TaxAdvantagedPlan(
        plan_owner_user_id=owner_id,
        group_id=data.group_id,
        name=data.name,
        tax_treatment=TaxTreatment(data.tax_treatment),
        currency=data.currency,
        lifetime_contribution_limit=data.lifetime_contribution_limit,
        accrued_contributions=data.accrued_contributions,
    )
    return plan


async def validate_tac_plan_updates(
    db: AsyncSession,
    updates: Mapping[str, Any],
    user_id: uuid.UUID,
) -> None:
    """Validate explicit tax-advantaged plan update fields

    Args:
        db: Active database session
        updates: Explicit fields from the update request
        user_id: Authenticated user identifier

    Raises:
        HTTPException: Supplied update field is invalid
    """
    if "tax_treatment" in updates:
        if updates["tax_treatment"] is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="tax_treatment cannot be null")
        validate_tax_advantaged_plan_tax_treatment(updates["tax_treatment"])

    if "group_id" in updates:
        await validate_tax_advantaged_plan_group_scope(db, updates["group_id"], user_id)

    if "name" in updates and updates["name"] is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="name cannot be null")


def apply_tac_plan_updates(
    plan: TaxAdvantagedPlan,
    updates: Mapping[str, Any],
) -> None:
    """Apply explicit update fields to a tax-advantaged plan

    Args:
        plan: Tax-advantaged plan being updated
        updates: Explicit fields from the update request
    """
    for field, value in updates.items():
        if field == "tax_treatment":
            value = TaxTreatment(value)
        setattr(plan, field, value)
