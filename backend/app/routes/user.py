import uuid
from datetime import date, timedelta
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.models.user import User, UserRunwayAccount
from app.schemas.user import (
    RunwayAccountsRequest,
    RunwayResponse,
    UpdateProfileRequest,
    UserProfile,
)
from app.services.dashboard import get_accessible_accounts
from app.services.snapshots import get_current_balances

# Trailing window the runway average is taken over. 12 months gives enough data
# to smooth out seasonal spikes (e.g. insurance renewals, holiday spend) while
# staying current with lifestyle changes.
_RUNWAY_WINDOW_DAYS = 365

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=UserProfile)
async def get_me(
    user: Annotated[User, Depends(get_current_user)],
):
    """Return the authenticated user's full profile."""
    return UserProfile.model_validate(user)


@router.patch("", response_model=UserProfile)
async def update_me(
    data: UpdateProfileRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update the authenticated user's profile. Only provided fields are changed."""
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return UserProfile.model_validate(user)

    # Non-nullable fields cannot be explicitly set to null
    _non_nullable = {"first_name", "tz", "base_currency"}
    null_fields = [f for f in _non_nullable if f in updates and updates[f] is None]
    if null_fields:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Cannot set to null: {', '.join(sorted(null_fields))}",
        )

    # Validate currency exists if being changed
    if "base_currency" in updates:
        result = await db.execute(select(Currency).where(Currency.id == updates["base_currency"]))
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")

    for field, value in updates.items():
        setattr(user, field, value)

    await db.commit()
    return UserProfile.model_validate(user)


@router.get("/runway-accounts", response_model=list[uuid.UUID])
async def list_runway_accounts(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the account IDs the user has picked to feed the runway calculation.

    Filters out any stored selections the user can no longer read (e.g., a
    household account they've lost permission to) so the response only
    surfaces currently valid IDs.
    """
    accessible_ids = {a.id for a in await get_accessible_accounts(db, user)}
    stored = await db.execute(
        select(UserRunwayAccount.account_id).where(UserRunwayAccount.user_id == user.id),
    )
    return [aid for aid in stored.scalars().all() if aid in accessible_ids]


@router.put("/runway-accounts", response_model=list[uuid.UUID])
async def replace_runway_accounts(
    data: RunwayAccountsRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Replace the user's runway account selection with the submitted set.

    Dedupes the submitted set. Rejects the whole request with 422 if any submitted
    account isn't readable by the user (personal, household admin, or explicit
    permission).
    """
    requested_ids = set(data.account_ids)

    if requested_ids:
        accessible_ids = {a.id for a in await get_accessible_accounts(db, user)}
        invalid = requested_ids - accessible_ids
        if invalid:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Inaccessible accounts: {sorted(str(x) for x in invalid)}",
            )

    # Replace the full set in a single transaction — simpler than diffing and
    # the runway selection is expected to be small (a handful of accounts).
    await db.execute(delete(UserRunwayAccount).where(UserRunwayAccount.user_id == user.id))
    for account_id in requested_ids:
        db.add(UserRunwayAccount(user_id=user.id, account_id=account_id))
    await db.commit()

    return sorted(requested_ids)


@router.get("/runway", response_model=RunwayResponse)
async def get_runway(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Compute the user's cash runway in months.

    Runway = (sum of current balance across selected runway accounts) divided
    by the trailing 12-month average monthly expense. Transfer-category
    transactions are excluded from the denominator so inter-account moves and
    debt payments (which the app models as transfers) don't shorten runway.
    """
    accessible_ids = {a.id for a in await get_accessible_accounts(db, user)}
    stored = await db.execute(
        select(UserRunwayAccount.account_id).where(UserRunwayAccount.user_id == user.id),
    )
    selected_ids = [aid for aid in stored.scalars().all() if aid in accessible_ids]

    if not selected_ids:
        return RunwayResponse(
            months=None, reason="no_accounts",
            avg_monthly_expense=0, months_covered=0, liquid_balance=0,
        )

    balances = await get_current_balances(db, selected_ids)
    liquid_balance = sum(balances.values())

    # Aggregate expense outflow and count distinct months-with-expenses in a
    # single query. COUNT(DISTINCT … FILTER …) only counts month buckets that
    # actually contain expenses, so a user with only income activity averages
    # against zero months (handled as insufficient_history below).
    window_start = date.today() - timedelta(days=_RUNWAY_WINDOW_DAYS - 1)
    expense_filter = (Transaction.amount < 0) & (Category.kind == CategoryKind.EXPENSE)
    agg = (await db.execute(
        select(
            sa.func.count(sa.distinct(sa.func.date_trunc("month", Transaction.dt)))
                .filter(expense_filter).label("months_covered"),
            sa.func.coalesce(
                sa.func.sum(sa.case((expense_filter, Transaction.amount), else_=0)), 0,
            ).label("expense_outflow"),
        )
        .select_from(Transaction)
        .join(Category, Category.id == Transaction.category_id)
        .where(Transaction.account_id.in_(accessible_ids))
        .where(Transaction.dt >= window_start),
    )).one()

    # Cap at 12 — if a user has activity in 13+ month buckets via backdated
    # entries at the edge of the window, we still only average over the window.
    months_covered = min(int(agg.months_covered), 12)
    expense_outflow = int(agg.expense_outflow)

    if months_covered < 1 or expense_outflow >= 0:
        return RunwayResponse(
            months=None, reason="insufficient_history",
            avg_monthly_expense=0, months_covered=months_covered,
            liquid_balance=liquid_balance,
        )

    avg_monthly_expense = abs(expense_outflow) // months_covered
    months = liquid_balance / avg_monthly_expense if avg_monthly_expense > 0 else None
    return RunwayResponse(
        months=max(0.0, months) if months is not None else None,
        reason=None,
        avg_monthly_expense=avg_monthly_expense,
        months_covered=months_covered,
        liquid_balance=liquid_balance,
    )
