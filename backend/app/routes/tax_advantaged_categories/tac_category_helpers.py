"""TAC category route helpers"""

import uuid
from collections.abc import Mapping, Sequence
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedCategory
from app.models.base import TaxTreatment
from app.models.currency import Currency
from app.models.group import GroupMember
from app.schemas.tax_advantaged_category import CreateTaxAdvantagedCategoryRequest

_VALID_TAX_TREATMENTS = {tax_treatment.value for tax_treatment in TaxTreatment}


def validate_tax_advantaged_category_tax_treatment(value: str) -> None:
    """Validate a tax treatment for a tax-advantaged category

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
            detail="Tax-advantaged categories require a non-taxable tax treatment",
        )


async def validate_tax_advantaged_category_group_scope(
    db: AsyncSession,
    group_id: uuid.UUID | None,
    user_id: uuid.UUID,
) -> None:
    """Validate that a tax-advantaged category can be owned in the requested group

    Args:
        db: Active database session
        group_id: Optional group context for the tax-advantaged category
        user_id: User that would own the tax-advantaged category

    Raises:
        HTTPException: Group is not visible to the user
    """
    if group_id is None:
        return

    # Check group membership so tax-advantaged categories cannot be created in an inaccessible group
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
        ),
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Group not found")


async def get_owned_tax_advantaged_category_or_404(
    db: AsyncSession,
    tax_advantaged_category_id: uuid.UUID,
    user_id: uuid.UUID,
) -> TaxAdvantagedCategory:
    """Return a tax-advantaged category owned by the authenticated user

    Args:
        db: Active database session
        tax_advantaged_category_id: Tax-advantaged category identifier to fetch
        user_id: Authenticated user identifier

    Returns:
        Owned tax-advantaged category

    Raises:
        HTTPException: Tax-advantaged category does not exist or belongs to another user
    """
    not_found_detail = "Tax-advantaged category not found"

    # Fetch the tax-advantaged category directly before enforcing owner-only access
    tax_advantaged_category = await db.get(TaxAdvantagedCategory, tax_advantaged_category_id)
    if not tax_advantaged_category or tax_advantaged_category.category_owner_user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail)
    return tax_advantaged_category


async def get_tax_advantaged_categories_for_owner(
    db: AsyncSession,
    owner_id: uuid.UUID,
) -> Sequence[TaxAdvantagedCategory]:
    """Return tax-advantaged categories for a category owner

    Args:
        db: Active database session
        owner_id: User identifier that owns the tax-advantaged categories

    Returns:
        Tax-advantaged categories in creation order
    """
    # Fetch the user's tax-advantaged categories in creation order before adding derived limit metrics
    result = await db.execute(
        select(TaxAdvantagedCategory)
        .where(TaxAdvantagedCategory.category_owner_user_id == owner_id)
        .order_by(TaxAdvantagedCategory.created_at),
    )
    tax_advantaged_categories = result.scalars().all()
    return tax_advantaged_categories


async def validate_tax_advantaged_category_currency(
    db: AsyncSession,
    currency_code: str,
) -> None:
    """Validate that a tax-advantaged category currency is supported

    Args:
        db: Active database session
        currency_code: Currency code from the request

    Raises:
        HTTPException: Currency code is not supported
    """
    # Fetch the currency so tax-advantaged categories cannot reference an unsupported currency code
    currency = await db.get(Currency, currency_code)
    if not currency:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")


def build_tac_category(
    owner_id: uuid.UUID,
    data: CreateTaxAdvantagedCategoryRequest,
) -> TaxAdvantagedCategory:
    """Build a tax-advantaged category from a creation request

    Args:
        owner_id: User identifier that owns the tax-advantaged category
        data: Tax-advantaged category creation payload

    Returns:
        Tax-advantaged category ready to add to the session
    """
    tax_advantaged_category = TaxAdvantagedCategory(
        category_owner_user_id=owner_id,
        group_id=data.group_id,
        name=data.name,
        tax_treatment=TaxTreatment(data.tax_treatment),
        currency=data.currency,
        lifetime_contribution_limit=data.lifetime_contribution_limit,
        accrued_contributions=data.accrued_contributions,
    )
    return tax_advantaged_category


async def validate_tac_category_updates(
    db: AsyncSession,
    updates: Mapping[str, Any],
    user_id: uuid.UUID,
) -> None:
    """Validate explicit tax-advantaged category update fields

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
        validate_tax_advantaged_category_tax_treatment(updates["tax_treatment"])

    if "group_id" in updates:
        await validate_tax_advantaged_category_group_scope(db, updates["group_id"], user_id)

    if "name" in updates and updates["name"] is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="name cannot be null")


def apply_tac_category_updates(
    tax_advantaged_category: TaxAdvantagedCategory,
    updates: Mapping[str, Any],
) -> None:
    """Apply explicit update fields to a tax-advantaged category

    Args:
        tax_advantaged_category: Tax-advantaged category being updated
        updates: Explicit fields from the update request
    """
    for field, value in updates.items():
        if field == "tax_treatment":
            value = TaxTreatment(value)
        setattr(tax_advantaged_category, field, value)
