"""TAC plan route helpers"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedPlan
from app.models.base import TaxTreatment
from app.models.group import GroupMember

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
