"""Budget route handlers"""
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
from app.models.currency import Currency
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
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.fx import FxConverter

router = APIRouter(prefix="/budgets", tags=["budgets"])


async def _build_budget_response(
    db: AsyncSession, budget: Budget, base_budget: BaseBudget,
) -> BudgetResponse:
    """Return a budget instance response

    Args:
        db: Active database session
        budget: Budget instance row
        base_budget: Parent base budget row

    Returns:
        Budget instance response with tracked category IDs from the parent base budget
    """
    tracked_categories_by_base_budget = await load_tracked_categories(db, [base_budget.id])
    return build_budget_response(budget, base_budget, tracked_categories_by_base_budget.get(base_budget.id, []))


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Return minor-unit exponents keyed by currency code

    Args:
        db: Active database session
        currencies: Currency codes to load

    Returns:
        Minor-unit exponents keyed by currency code
    """
    result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    return {row.id: row.minor_unit_exponent for row in result}


def _fork_budget_converter(converter: FxConverter) -> FxConverter:
    """Return a converter with copied FX cache state

    Args:
        converter: Converter whose cached rates should be reused

    Returns:
        Independent converter with copied rates and failure tracking
    """
    budget_converter = FxConverter(
        provider=converter.provider,
        currency_exponents=converter.currency_exponents,
    )
    budget_converter.rates = converter.rates.copy()
    budget_converter.failed_rates = converter.failed_rates.copy()
    return budget_converter


async def _prefetch_budget_rates(converter: FxConverter, spend_rows) -> None:
    """Prefetch FX rates needed for budget spend rows

    Args:
        converter: Converter that will cache the fetched rates
        spend_rows: Aggregated spend rows with account and budget currencies
    """
    date_ranges_by_currency_pair: dict[tuple[str, str], tuple] = {}
    for row in spend_rows:
        base = row.account_currency
        quote = row.budget_currency
        if base == quote:
            continue
        start_date, end_date = date_ranges_by_currency_pair.get((base, quote), (row.date, row.date))
        date_ranges_by_currency_pair[(base, quote)] = (min(start_date, row.date), max(end_date, row.date))

    for (base, quote), (start_date, end_date) in sorted(date_ranges_by_currency_pair.items()):
        await converter.prefetch_rates(
            base=base,
            quote=quote,
            start_date=start_date,
            end_date=end_date,
        )


async def _build_budget_utilization_responses(
    db: AsyncSession,
    rows: list[tuple[Budget, BaseBudget]],
) -> list[BudgetUtilizationResponse]:
    """Return utilization responses for budget instances

    Args:
        db: Active database session
        rows: Budget instance rows with their parent base budget rows

    Returns:
        Utilization responses with per-category spend totals in budget currency
    """
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
            Transaction.account_id,
            Transaction.dt.label("date"),
            Account.currency.label("account_currency"),
            BaseBudget.currency.label("budget_currency"),
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
            (
                (BaseBudget.group_id.is_not(None) & (Account.group_id == BaseBudget.group_id))
                | (BaseBudget.group_id.is_(None) & (Account.owner_id == BaseBudget.owner_id))
            ),
        )
        .group_by(
            Budget.id,
            Transaction.category_id,
            Transaction.account_id,
            Transaction.dt,
            Account.currency,
            BaseBudget.currency,
        ),
    )
    spend_rows = spend_result.all()
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {
                *(base_budget.currency for _, base_budget in rows),
                *(row.account_currency for row in spend_rows),
            },
        ),
    )
    await _prefetch_budget_rates(converter, spend_rows)

    spend_rows_by_budget: dict[uuid.UUID, list] = {}
    for row in spend_rows:
        spend_rows_by_budget.setdefault(row.id, []).append(row)

    responses = []
    for budget, base_budget in rows:
        budget_converter = _fork_budget_converter(converter)
        spend_by_category = {
            category_id: 0
            for category_id in tracked_by_budget.get(budget.id, [])
        }
        for row in spend_rows_by_budget.get(budget.id, []):
            converted_amount = await budget_converter.convert_minor_units(
                int(row.amount_sum or 0),
                base=row.account_currency,
                quote=base_budget.currency,
                rate_date=row.date,
            )
            if converted_amount is None:
                continue

            spend_by_category[row.category_id] = spend_by_category.get(row.category_id, 0) - converted_amount

        categories = [
            BudgetCategoryUtilization(
                category_id=category_id,
                spent=spend_by_category.get(category_id, 0),
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
                fx_status=budget_converter.get_status(),
            ),
        )
    return responses


@router.get("/latest-utilizations", response_model=list[LatestBudgetUtilizationResponse])
async def get_latest_budget_utilizations(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return latest utilization for each accessible base budget

    Args:
        user: Authenticated user requesting utilization
        db: Active database session

    Returns:
        Latest budget utilization responses ordered by base budget name
    """
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
    """Return a single budget instance

    Args:
        budget_id: Budget instance identifier from the route path
        user: Authenticated user requesting the budget instance
        db: Active database session

    Returns:
        Budget instance response

    Raises:
        HTTPException: User does not have read access
    """
    budget, base_budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.READ)
    return await _build_budget_response(db, budget, base_budget)


@router.get("/{budget_id}/utilization", response_model=BudgetUtilizationResponse)
async def get_budget_utilization(
    budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return per-category spending totals for a budget period

    Requires read access on the base budget. The tracked-category set is
    reconstructed as of period end so past periods stay frozen when the base is
    edited after they ended. Mid-period additions count for the full period
    retroactively, while mid-period removals exclude the category from the whole
    period

    Args:
        budget_id: Budget instance identifier from the route path
        user: Authenticated user requesting utilization
        db: Active database session

    Returns:
        Budget utilization response

    Raises:
        HTTPException: User does not have read access
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
    """Delete a budget instance

    Args:
        budget_id: Budget instance identifier from the route path
        user: Authenticated user deleting the budget instance
        db: Active database session

    Raises:
        HTTPException: User does not have admin access
    """
    budget, base_budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.ADMIN)
    await mark_cache_changed_for_scope(db, user_id=base_budget.owner_id, group_id=base_budget.group_id)
    await db.delete(budget)
    await db.commit()


@router.patch("/{budget_id}", response_model=BudgetResponse)
async def update_budget(
    budget_id: uuid.UUID,
    data: UpdateBudgetRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a budget instance

    Period dates are derived from the base budget cadence and cannot be edited.
    Users create a new instance when they need a different period

    Args:
        budget_id: Budget instance identifier from the route path
        data: Budget instance fields to update
        user: Authenticated user updating the budget instance
        db: Active database session

    Returns:
        Updated budget instance response

    Raises:
        HTTPException: User does not have admin access or update fields are invalid
    """
    budget, base_budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.ADMIN)

    changed_fields = data.model_dump(exclude_unset=True)
    if not changed_fields:
        return await _build_budget_response(db, budget, base_budget)

    # Reject explicit null because overall_limit is non-nullable on the model
    if "overall_limit" in changed_fields and changed_fields["overall_limit"] is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Cannot set to null: overall_limit",
        )

    for field, value in changed_fields.items():
        setattr(budget, field, value)

    await mark_cache_changed_for_scope(db, user_id=base_budget.owner_id, group_id=base_budget.group_id)
    await db.commit()
    await db.refresh(budget)
    return await _build_budget_response(db, budget, base_budget)


@router.get("", response_model=list[BudgetResponse])
async def get_budgets(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return budget instances visible to the user

    Args:
        user: Authenticated user requesting budget instances
        db: Active database session

    Returns:
        Budget instances visible through ownership, group admin membership, or explicit permission
    """
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
    tracked_categories_by_base_budget = await load_tracked_categories(db, list({base.id for _, base in rows}))
    return [
        build_budget_response(budget, base, tracked_categories_by_base_budget.get(base.id, []))
        for budget, base in rows
    ]
