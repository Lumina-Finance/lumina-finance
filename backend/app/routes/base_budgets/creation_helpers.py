"""Base budget creation helpers"""

import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BaseBudget, BudgetTrackedCategory
from app.models.currency import Currency
from app.models.group import GroupMember
from app.models.user import User
from app.routes.base_budgets.category_helpers import get_valid_tracked_category_ids
from app.routes.base_budgets.instance_helpers import add_initial_budget_instances
from app.routes.base_budgets.response_helpers import get_base_budget_response
from app.schemas.budget import BaseBudgetResponse, CreateBaseBudgetRequest
from app.services.budget_periods import validate_period_start
from app.services.cache_state import mark_cache_changed_for_scope


async def create_base_budget_and_get_response(
    db: AsyncSession,
    user: User,
    data: CreateBaseBudgetRequest,
    today: date,
) -> BaseBudgetResponse:
    """Create a base budget and return its API response

    Args:
        db: Active database session
        user: Authenticated user creating the base budget
        data: Base budget creation request body
        today: Current date in the user's timezone

    Returns:
        Created base budget response

    Raises:
        HTTPException: Currency, ownership, categories, or period cadence are invalid
    """
    await _validate_base_budget_currency_exists(db, data.currency)
    owner_id, group_id = await _get_base_budget_scope(db, user, data.group_id)
    valid_tracked_category_ids = await get_valid_tracked_category_ids(db, data.category_ids, user.id, group_id)
    _validate_initial_period_alignment(data)

    base_budget = BaseBudget(
        owner_id=owner_id,
        group_id=group_id,
        name=data.name,
        currency=data.currency,
        recurrence_freq=data.recurrence_freq,
        instance_length=data.instance_length,
        recurrence_weekday=data.recurrence_weekday,
        recurrence_dom=data.recurrence_dom,
        recurrence_month=data.recurrence_month,
        recurs=data.recurs,
    )
    db.add(base_budget)
    await db.flush()

    _add_initial_tracked_categories(db, base_budget, valid_tracked_category_ids, data, today)
    add_initial_budget_instances(db, base_budget, data.period_start, data.overall_limit, today)

    await mark_cache_changed_for_scope(db, user_id=base_budget.owner_id, group_id=base_budget.group_id)
    await db.commit()
    await db.refresh(base_budget)

    response = await get_base_budget_response(db, base_budget)
    return response


async def _validate_base_budget_currency_exists(db: AsyncSession, currency: str) -> None:
    """Raise when a base budget currency code is missing

    Args:
        db: Active database session
        currency: Currency code requested for the base budget

    Raises:
        HTTPException: Currency code does not exist
    """
    currency_query = select(Currency).where(Currency.id == currency)

    # Confirm the requested currency code exists before creating the base budget
    currency_result = await db.execute(currency_query)
    if not currency_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")


async def _get_base_budget_scope(
    db: AsyncSession,
    user: User,
    group_id: uuid.UUID | None,
) -> tuple[uuid.UUID | None, uuid.UUID | None]:
    """Return owner and group identifiers for a base budget

    Args:
        db: Active database session
        user: Authenticated user creating the base budget
        group_id: Optional group identifier requested for the base budget

    Returns:
        Owner and group identifiers for the new base budget

    Raises:
        HTTPException: User cannot manage the requested group
    """
    if group_id is None:
        return user.id, None

    await _get_group_admin_membership_or_403(db, group_id, user.id)
    return None, group_id


async def _get_group_admin_membership_or_403(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> GroupMember:
    """Return group membership when a user can manage base budgets

    Args:
        db: Active database session
        group_id: Group identifier for the base budget
        user_id: Authenticated user identifier

    Returns:
        Group membership for an admin user

    Raises:
        HTTPException: Group is missing or user is not an admin
    """
    membership_query = select(GroupMember).where(
        GroupMember.group_id == group_id,
        GroupMember.user_id == user_id,
    )

    # Fetch the actor's group membership before allowing base budget management
    result = await db.execute(membership_query)
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    if not membership.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can manage base budgets")
    return membership


def _validate_initial_period_alignment(data: CreateBaseBudgetRequest) -> None:
    """Raise when an initial period start does not match the recurrence cadence

    Args:
        data: Base budget creation request body

    Raises:
        HTTPException: Initial period start is invalid for the recurrence cadence
    """
    if data.period_start is None:
        return

    alignment_error = validate_period_start(
        data.period_start,
        data.recurrence_freq,
        weekday=data.recurrence_weekday,
        dom=data.recurrence_dom,
        month=data.recurrence_month,
    )
    if alignment_error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=alignment_error,
        )


def _add_initial_tracked_categories(
    db: AsyncSession,
    base_budget: BaseBudget,
    category_ids: list[uuid.UUID],
    data: CreateBaseBudgetRequest,
    today: date,
) -> None:
    """Add tracked category links for a new base budget

    Args:
        db: Active database session
        base_budget: Newly created base budget row
        category_ids: Valid tracked category identifiers
        data: Base budget creation request body
        today: Current date in the user's timezone
    """
    category_added_at = data.period_start or today
    for category_id in category_ids:
        tracked_category = BudgetTrackedCategory(
            base_budget_id=base_budget.id,
            category_id=category_id,
            added_at=category_added_at,
        )
        db.add(tracked_category)
