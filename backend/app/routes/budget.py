import uuid
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.base import HouseholdRole
from app.models.budget import Budget, BudgetMember, BudgetTrackedCategory
from app.models.category import Category
from app.models.household import HouseholdMember
from app.models.user import User
from app.schemas.budget import AddBudgetMemberRequest, BudgetMemberResponse, BudgetResponse, CreateBudgetRequest, UpdateBudgetRequest

router = APIRouter(prefix="/budgets", tags=["budgets"])


async def _check_household_editor_or_403(
    db: AsyncSession, household_id: uuid.UUID, user_id: uuid.UUID,
) -> HouseholdMember:
    """Return the user's membership or raise 403 if they lack edit access.

    Args:
        db: Async database session.
        household_id: UUID of the household.
        user_id: UUID of the user.

    Returns:
        The HouseholdMember row.

    Raises:
        HTTPException 404: User is not a member of the household.
        HTTPException 403: User is a viewer (read-only).
    """
    result = await db.execute(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household_id,
            HouseholdMember.user_id == user_id,
        ),
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Household not found")
    if membership.role == HouseholdRole.VIEWER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Viewer role cannot manage budgets")
    return membership


async def _validate_category_ids(
    db: AsyncSession, category_ids: list[uuid.UUID], user_id: uuid.UUID, household_id: uuid.UUID | None,
) -> list[uuid.UUID]:
    """Verify all category IDs exist and belong to the user or household. Returns deduplicated list.

    Args:
        db: Async database session.
        category_ids: List of category UUIDs to validate.
        user_id: UUID of the requesting user.
        household_id: UUID of the household, or None for personal budgets.

    Returns:
        Deduplicated list of valid category IDs.

    Raises:
        HTTPException 422: One or more categories not found.
    """
    if not category_ids:
        return []
    unique_ids = list(set(category_ids))
    query = select(Category.id).where(Category.id.in_(unique_ids))
    if household_id:
        query = query.where(
            (Category.owner_id == user_id) | (Category.household_id == household_id),
        )
    else:
        query = query.where(Category.owner_id == user_id)
    result = await db.execute(query)
    found = set(result.scalars().all())
    if found != set(unique_ids):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")
    return unique_ids


async def _get_active_category_ids(db: AsyncSession, budget_id: uuid.UUID) -> list[uuid.UUID]:
    """Fetch currently active tracked category IDs for a budget (removed_at is null).

    Args:
        db: Async database session.
        budget_id: UUID of the budget.

    Returns:
        List of active category UUIDs.
    """
    result = await db.execute(
        select(BudgetTrackedCategory.category_id).where(
            BudgetTrackedCategory.budget_id == budget_id,
            BudgetTrackedCategory.removed_at.is_(None),
        ),
    )
    return list(result.scalars().all())


async def _build_budget_response(db: AsyncSession, budget: Budget) -> BudgetResponse:
    """Build a BudgetResponse with tracked category IDs.

    Args:
        db: Async database session.
        budget: The Budget model instance.

    Returns:
        BudgetResponse with category_ids populated.
    """
    category_ids = await _get_active_category_ids(db, budget.id)
    resp = BudgetResponse.model_validate(budget)
    resp.category_ids = category_ids
    return resp


async def _get_budget_or_404(
    db: AsyncSession, budget_id: uuid.UUID, user_id: uuid.UUID,
) -> Budget:
    """Fetch a budget by ID, verifying the user owns it or is a household member.

    Args:
        db: Async database session.
        budget_id: UUID of the budget.
        user_id: UUID of the requesting user.

    Returns:
        The Budget row.

    Raises:
        HTTPException 404: Budget not found or user lacks access.
    """
    result = await db.execute(
        select(Budget)
        .outerjoin(HouseholdMember, Budget.household_id == HouseholdMember.household_id)
        .where(
            Budget.id == budget_id,
            (Budget.owner_id == user_id) | (HouseholdMember.user_id == user_id),
        ),
    )
    budget = result.scalar_one_or_none()
    if not budget:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found")
    return budget


@router.get("/{budget_id}", response_model=BudgetResponse)
async def get_budget(
    budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single budget. User must own it or be a household member."""
    budget = await _get_budget_or_404(db, budget_id, user.id)
    return await _build_budget_response(db, budget)


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_budget(
    budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a budget. Household budgets require editor/admin role."""
    budget = await _get_budget_or_404(db, budget_id, user.id)

    if budget.household_id:
        await _check_household_editor_or_403(db, budget.household_id, user.id)

    await db.delete(budget)
    await db.commit()


@router.post("/{budget_id}/members", response_model=BudgetMemberResponse, status_code=status.HTTP_201_CREATED)
async def add_budget_member(
    budget_id: uuid.UUID,
    data: AddBudgetMemberRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Add a member to a household budget. Requires editor/admin role."""
    budget = await _get_budget_or_404(db, budget_id, user.id)

    if not budget.household_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Only household budgets support member scoping")

    await _check_household_editor_or_403(db, budget.household_id, user.id)

    # Target user must be a household member
    result = await db.execute(
        select(HouseholdMember).where(
            HouseholdMember.household_id == budget.household_id,
            HouseholdMember.user_id == data.user_id,
        ),
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="User is not a member of this household")

    # Check for duplicate
    result = await db.execute(
        select(BudgetMember).where(
            BudgetMember.budget_id == budget_id,
            BudgetMember.user_id == data.user_id,
        ),
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is already added to this budget")

    budget_member = BudgetMember(budget_id=budget_id, user_id=data.user_id)
    db.add(budget_member)
    await db.commit()
    return budget_member


@router.delete("/{budget_id}/members/{member_user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_budget_member(
    budget_id: uuid.UUID,
    member_user_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Remove a member from a household budget. Requires editor/admin role."""
    budget = await _get_budget_or_404(db, budget_id, user.id)

    if not budget.household_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Only household budgets support member scoping")

    await _check_household_editor_or_403(db, budget.household_id, user.id)

    result = await db.execute(
        select(BudgetMember).where(
            BudgetMember.budget_id == budget_id,
            BudgetMember.user_id == member_user_id,
        ),
    )
    budget_member = result.scalar_one_or_none()
    if not budget_member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget member not found")

    await db.delete(budget_member)
    await db.commit()


@router.patch("/{budget_id}", response_model=BudgetResponse)
async def update_budget(
    budget_id: uuid.UUID,
    data: UpdateBudgetRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a budget. Household budgets require editor/admin role."""
    budget = await _get_budget_or_404(db, budget_id, user.id)

    # Household budgets require editor or admin role
    if budget.household_id:
        await _check_household_editor_or_403(db, budget.household_id, user.id)

    changed_fields = data.model_dump(exclude_unset=True)
    if not changed_fields:
        return await _build_budget_response(db, budget)

    # Validate period if either date is being changed
    if "period_start" in changed_fields or "period_end" in changed_fields:
        new_start = changed_fields.get("period_start", budget.period_start)
        new_end = changed_fields.get("period_end", budget.period_end)
        if new_start >= new_end:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Period start must be before period end")

    # Handle tracked categories separately
    new_category_ids = changed_fields.pop("category_ids", None)

    for field, value in changed_fields.items():
        setattr(budget, field, value)

    # Update tracked categories if provided — soft-delete removed, insert new
    if new_category_ids is not None:
        validated = set(await _validate_category_ids(db, new_category_ids, user.id, budget.household_id))
        current = set(await _get_active_category_ids(db, budget_id))

        # Soft-delete categories that are no longer tracked
        removed = current - validated
        if removed:
            await db.execute(
                sa.update(BudgetTrackedCategory)
                .where(
                    BudgetTrackedCategory.budget_id == budget_id,
                    BudgetTrackedCategory.category_id.in_(removed),
                    BudgetTrackedCategory.removed_at.is_(None),
                )
                .values(removed_at=sa.func.now()),
            )

        # Insert newly added categories
        added = validated - current
        for cat_id in added:
            db.add(BudgetTrackedCategory(budget_id=budget_id, category_id=cat_id))

    await db.commit()
    await db.refresh(budget)
    return await _build_budget_response(db, budget)


@router.get("", response_model=list[BudgetResponse])
async def list_budgets(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return all budgets the user owns or has access to via household membership."""
    # Personal budgets + household budgets where the user is a member
    query = (
        select(Budget)
        .outerjoin(HouseholdMember, Budget.household_id == HouseholdMember.household_id)
        .where(
            (Budget.owner_id == user.id) | (HouseholdMember.user_id == user.id),
        )
        .order_by(Budget.period_end.desc(), Budget.name)
    )
    result = await db.execute(query)
    budgets = result.scalars().unique().all()

    # Batch fetch active tracked categories for all budgets
    budget_ids = [b.id for b in budgets]
    cat_map: dict[uuid.UUID, list[uuid.UUID]] = {b_id: [] for b_id in budget_ids}
    if budget_ids:
        cat_result = await db.execute(
            select(BudgetTrackedCategory).where(
                BudgetTrackedCategory.budget_id.in_(budget_ids),
                BudgetTrackedCategory.removed_at.is_(None),
            ),
        )
        for row in cat_result.scalars().all():
            cat_map[row.budget_id].append(row.category_id)

    responses = []
    for budget in budgets:
        resp = BudgetResponse.model_validate(budget)
        resp.category_ids = cat_map[budget.id]
        responses.append(resp)
    return responses


@router.post("", response_model=BudgetResponse, status_code=status.HTTP_201_CREATED)
async def create_budget(
    data: CreateBudgetRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new budget with optional tracked categories."""
    # Validate period
    if data.period_start >= data.period_end:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Period start must be before period end")

    # Budget currency must match the user's base currency
    if data.currency != user.base_currency:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Budget currency must match your base currency")

    # Determine ownership
    owner_id = user.id
    household_id = data.household_id
    if household_id:
        await _check_household_editor_or_403(db, household_id, user.id)
        owner_id = None

    # Validate base budget if this is a recurring instance
    if data.base_budget_id:
        base_query = select(Budget).where(Budget.id == data.base_budget_id)
        if household_id:
            base_query = base_query.where(Budget.household_id == household_id)
        else:
            base_query = base_query.where(Budget.owner_id == user.id)
        base_result = await db.execute(base_query)
        if not base_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Base budget not found")

    # Validate tracked category IDs
    validated_cat_ids = await _validate_category_ids(db, data.category_ids, user.id, household_id)

    # Generate ID in Python to avoid intermediate flush
    budget_id = uuid.uuid4()
    budget = Budget(
        id=budget_id,
        owner_id=owner_id,
        household_id=household_id,
        base_budget_id=data.base_budget_id,
        name=data.name,
        period_start=data.period_start,
        period_end=data.period_end,
        recurrence_freq=data.recurrence_freq,
        recurrence_interval=data.recurrence_interval,
        overall_limit=data.overall_limit,
        currency=data.currency,
    )
    db.add(budget)

    # Link tracked categories
    for cat_id in validated_cat_ids:
        db.add(BudgetTrackedCategory(budget_id=budget_id, category_id=cat_id))

    await db.commit()
    await db.refresh(budget)
    return await _build_budget_response(db, budget)
