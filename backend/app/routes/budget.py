import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.account import Account
from app.models.base import PermissionLevel
from app.models.budget import BaseBudget, Budget, BudgetPermission, BudgetTrackedCategory
from app.models.group import GroupMember
from app.models.transaction import Transaction
from app.models.user import User
from app.permissions import check_budget_access
from app.schemas.budget import (
    BudgetCategoryUtilization,
    BudgetResponse,
    BudgetUtilizationResponse,
    LatestBudgetUtilizationResponse,
    UpdateBudgetRequest,
)
from app.services.budget_responses import build_budget_response, load_tracked_categories

router = APIRouter(prefix="/budgets", tags=["budgets"])


async def _build_budget_response(
    db: AsyncSession, budget: Budget, base_budget: BaseBudget,
) -> BudgetResponse:
    """Build a BudgetResponse for a single budget instance (convenience wrapper)."""
    cats = await load_tracked_categories(db, [base_budget.id])
    return build_budget_response(budget, base_budget, cats.get(base_budget.id, []))


async def _build_budget_utilization_responses(
    db: AsyncSession,
    rows: list[tuple[Budget, BaseBudget]],
) -> list[BudgetUtilizationResponse]:
    """Build utilization responses for budget instances in batch."""
    if not rows:
        return []

    budget_ids = [budget.id for budget, _ in rows]
    tracked_result = await db.execute(
        select(Budget.id, BudgetTrackedCategory.category_id)
        .join(BudgetTrackedCategory, BudgetTrackedCategory.base_budget_id == Budget.base_budget_id)
        .where(
            Budget.id.in_(budget_ids),
            BudgetTrackedCategory.added_at <= Budget.period_end,
            (BudgetTrackedCategory.removed_at.is_(None)) | (BudgetTrackedCategory.removed_at > Budget.period_end),
        )
        .distinct(),
    )
    tracked_by_budget: dict[uuid.UUID, list[uuid.UUID]] = {}
    for budget_id, category_id in tracked_result:
        tracked_by_budget.setdefault(budget_id, []).append(category_id)

    spend_result = await db.execute(
        select(
            Budget.id,
            Transaction.category_id,
            func.sum(Transaction.amount).label("amount_sum"),
        )
        .join(BaseBudget, Budget.base_budget_id == BaseBudget.id)
        .join(
            BudgetTrackedCategory,
            (BudgetTrackedCategory.base_budget_id == BaseBudget.id)
            & (BudgetTrackedCategory.added_at <= Budget.period_end)
            & (
                (BudgetTrackedCategory.removed_at.is_(None))
                | (BudgetTrackedCategory.removed_at > Budget.period_end)
            ),
        )
        .join(Transaction, Transaction.category_id == BudgetTrackedCategory.category_id)
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Budget.id.in_(budget_ids),
            Transaction.dt >= Budget.period_start,
            Transaction.dt <= Budget.period_end,
            Account.currency == BaseBudget.currency,
            (
                (BaseBudget.group_id.is_not(None) & (Account.group_id == BaseBudget.group_id))
                | (BaseBudget.group_id.is_(None) & (Account.owner_id == BaseBudget.owner_id))
            ),
        )
        .group_by(Budget.id, Transaction.category_id),
    )
    spend_by_budget_category = {
        (budget_id, category_id): amount_sum
        for budget_id, category_id, amount_sum in spend_result
    }

    responses = []
    for budget, _ in rows:
        categories = [
            BudgetCategoryUtilization(
                category_id=category_id,
                spent=-(spend_by_budget_category.get((budget.id, category_id), 0) or 0),
            )
            for category_id in tracked_by_budget.get(budget.id, [])
        ]
        responses.append(
            BudgetUtilizationResponse(
                budget_id=budget.id,
                period_start=budget.period_start,
                period_end=budget.period_end,
                overall_limit=budget.overall_limit,
                total_spent=sum(category.spent for category in categories),
                categories=categories,
            ),
        )
    return responses


@router.get("/latest-utilizations", response_model=list[LatestBudgetUtilizationResponse])
async def list_latest_budget_utilizations(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return utilization for the latest period of each accessible base budget."""
    ranked_budget_ids = (
        select(
            Budget.id.label("budget_id"),
            func.row_number()
            .over(
                partition_by=Budget.base_budget_id,
                order_by=(Budget.period_start.desc(), Budget.created_at.desc()),
            )
            .label("rank"),
        )
        .join(BaseBudget, Budget.base_budget_id == BaseBudget.id)
        .outerjoin(GroupMember, BaseBudget.group_id == GroupMember.group_id)
        .outerjoin(
            BudgetPermission,
            (BudgetPermission.base_budget_id == BaseBudget.id) & (BudgetPermission.user_id == user.id),
        )
        .where(
            (BaseBudget.owner_id == user.id)
            | ((GroupMember.user_id == user.id) & (GroupMember.is_admin.is_(True)))
            | (BudgetPermission.user_id == user.id),
        )
        .subquery()
    )
    result = await db.execute(
        select(Budget, BaseBudget)
        .join(BaseBudget, Budget.base_budget_id == BaseBudget.id)
        .join(ranked_budget_ids, Budget.id == ranked_budget_ids.c.budget_id)
        .where(ranked_budget_ids.c.rank == 1)
        .order_by(BaseBudget.name),
    )
    rows = result.all()
    utilizations = await _build_budget_utilization_responses(db, rows)
    return [
        LatestBudgetUtilizationResponse(
            **utilization.model_dump(),
            base_budget_id=base_budget.id,
            name=base_budget.name,
            currency=base_budget.currency,
        )
        for utilization, (_, base_budget) in zip(utilizations, rows, strict=True)
    ]


@router.get("/{budget_id}", response_model=BudgetResponse)
async def get_budget(
    budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single budget instance. Requires READ access on the base budget."""
    budget, base_budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.READ)
    return await _build_budget_response(db, budget, base_budget)


@router.get("/{budget_id}/utilization", response_model=BudgetUtilizationResponse)
async def get_budget_utilization(
    budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return per-category spending totals for the budget instance's period.

    Requires READ on the base budget; access to the underlying accounts is not required.
    The tracked-category set is reconstructed as of period_end using added_at/removed_at,
    so past periods stay frozen when the base is edited after they ended. Mid-period
    additions count for the full period retroactively; mid-period removals exclude the
    category from the whole period.
    """
    budget, base_budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.READ)
    responses = await _build_budget_utilization_responses(db, [(budget, base_budget)])
    return responses[0]


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_budget(
    budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a budget instance. Requires ADMIN access on the base budget."""
    budget, _ = await check_budget_access(db, budget_id, user.id, PermissionLevel.ADMIN)
    await db.delete(budget)
    await db.commit()


@router.patch("/{budget_id}", response_model=BudgetResponse)
async def update_budget(
    budget_id: uuid.UUID,
    data: UpdateBudgetRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a budget instance's overall_limit. Requires ADMIN access on the base budget.

    Period dates are derived from the base's cadence and cannot be edited — if
    the user wants a different period, they create a new instance.
    """
    budget, base_budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.ADMIN)

    changed_fields = data.model_dump(exclude_unset=True)
    if not changed_fields:
        return await _build_budget_response(db, budget, base_budget)

    # Reject explicit null — overall_limit is non-nullable on the model
    if "overall_limit" in changed_fields and changed_fields["overall_limit"] is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Cannot set to null: overall_limit",
        )

    for field, value in changed_fields.items():
        setattr(budget, field, value)

    await db.commit()
    await db.refresh(budget)
    return await _build_budget_response(db, budget, base_budget)


@router.get("", response_model=list[BudgetResponse])
async def list_budgets(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return all budget instances the user owns or has access to via their base budget."""
    query = (
        select(Budget, BaseBudget)
        .join(BaseBudget, Budget.base_budget_id == BaseBudget.id)
        .outerjoin(GroupMember, BaseBudget.group_id == GroupMember.group_id)
        .outerjoin(
            BudgetPermission,
            (BudgetPermission.base_budget_id == BaseBudget.id) & (BudgetPermission.user_id == user.id),
        )
        .where(
            (BaseBudget.owner_id == user.id)
            | ((GroupMember.user_id == user.id) & (GroupMember.is_admin.is_(True)))
            | (BudgetPermission.user_id == user.id),
        )
        .order_by(Budget.period_end.desc(), BaseBudget.name)
    )
    result = await db.execute(query)
    rows = result.unique().all()

    # Batch-load tracked categories for all base budgets in one query to avoid N+1
    cats_by_base = await load_tracked_categories(db, list({base.id for _, base in rows}))
    return [
        build_budget_response(budget, base, cats_by_base.get(base.id, []))
        for budget, base in rows
    ]
