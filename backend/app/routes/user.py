import calendar
import uuid
from datetime import date, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

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
    RunwaySettings,
    RunwayThresholds,
    UpdateProfileRequest,
    UserProfile,
)
from app.services.dashboard import get_accessible_accounts
from app.services.snapshots import get_current_balances

# Trailing window the runway average is taken over. 12 months gives enough data
# to smooth out seasonal spikes (e.g. insurance renewals, holiday spend) while
# staying current with lifestyle changes.
_RUNWAY_WINDOW_MONTHS = 12


def _add_months_anchored(start: date, months: int) -> date:
    month_index = (start.year * 12 + start.month - 1) + months
    year = month_index // 12
    month = month_index % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _runway_thresholds_from_user(user: User) -> RunwayThresholds:
    return RunwayThresholds(
        risky_below_months=user.runway_risky_below_months,
        healthy_at_months=user.runway_healthy_at_months,
    )


async def _active_runway_account_ids(db: AsyncSession, user: User) -> list[uuid.UUID]:
    accessible_ids = {a.id for a in await get_accessible_accounts(db, user)}
    stored = await db.execute(
        select(UserRunwayAccount.account_id).where(UserRunwayAccount.user_id == user.id),
    )
    return [aid for aid in stored.scalars().all() if aid in accessible_ids]


async def _replace_runway_account_ids(
    db: AsyncSession,
    user: User,
    account_ids: list[uuid.UUID],
) -> list[uuid.UUID]:
    requested_ids = set(account_ids)

    all_accessible = await get_accessible_accounts(db, user, include_hidden=True)
    visible_ids = {a.id for a in all_accessible if not a.is_hidden}
    hidden_ids = {a.id for a in all_accessible if a.is_hidden}

    invalid = requested_ids - visible_ids
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Inaccessible accounts: {sorted(str(x) for x in invalid)}",
        )

    # Replace the full set in a single transaction — simpler than diffing and
    # the runway selection is expected to be small (a handful of accounts).
    # Hidden selections are left untouched so hiding an account is reversible.
    delete_query = delete(UserRunwayAccount).where(UserRunwayAccount.user_id == user.id)
    if hidden_ids:
        delete_query = delete_query.where(UserRunwayAccount.account_id.not_in(hidden_ids))
    await db.execute(delete_query)
    for account_id in requested_ids:
        db.add(UserRunwayAccount(user_id=user.id, account_id=account_id))

    return sorted(requested_ids)


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

    Filters out any stored selections the user can no longer read or has
    hidden, so the response only surfaces currently active IDs.
    """
    return await _active_runway_account_ids(db, user)


@router.put("/runway-accounts", response_model=list[uuid.UUID])
async def replace_runway_accounts(
    data: RunwayAccountsRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Replace the user's runway account selection with the submitted set.

    Dedupes the submitted set. Rejects the whole request with 422 if any submitted
    account isn't readable by the user (personal, household admin, or explicit
    permission) and currently visible. Stored hidden selections are preserved
    so they become active again if the account is unhidden.
    """
    selected_ids = await _replace_runway_account_ids(db, user, data.account_ids)
    await db.commit()

    return selected_ids


@router.get("/runway-settings", response_model=RunwaySettings)
async def get_runway_settings(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the user's runway account selection and status thresholds."""
    return RunwaySettings(
        account_ids=await _active_runway_account_ids(db, user),
        thresholds=_runway_thresholds_from_user(user),
    )


@router.put("/runway-settings", response_model=RunwaySettings)
async def replace_runway_settings(
    data: RunwaySettings,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Replace the user's runway account selection and status thresholds."""
    selected_ids = await _replace_runway_account_ids(db, user, data.account_ids)
    user.runway_risky_below_months = data.thresholds.risky_below_months
    user.runway_healthy_at_months = data.thresholds.healthy_at_months
    await db.commit()

    return RunwaySettings(
        account_ids=selected_ids,
        thresholds=_runway_thresholds_from_user(user),
    )


@router.get("/runway", response_model=RunwayResponse)
async def get_runway(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Compute the user's cash runway in months.

    Runway = (sum of current balance across selected runway accounts) divided
    by the average monthly expense over the last 12 completed months. Transfer-category
    transactions are excluded from the denominator so inter-account moves and
    debt payments (which the app models as transfers) don't shorten runway.
    """
    accessible_ids = {a.id for a in await get_accessible_accounts(db, user)}
    stored = await db.execute(
        select(UserRunwayAccount.account_id).where(UserRunwayAccount.user_id == user.id),
    )
    selected_ids = [aid for aid in stored.scalars().all() if aid in accessible_ids]
    thresholds = _runway_thresholds_from_user(user)

    if not selected_ids:
        return RunwayResponse(
            months=None, reason="no_accounts",
            avg_monthly_expense=0, months_covered=0, liquid_balance=0,
            thresholds=thresholds,
        )

    balances = await get_current_balances(db, selected_ids)
    liquid_balance = sum(balances.values())

    today = datetime.now(ZoneInfo(user.tz)).date()
    window_end = date(today.year, today.month, 1)
    window_start = _add_months_anchored(window_end, -_RUNWAY_WINDOW_MONTHS)
    expense_filter = (Transaction.amount < 0) & (Category.kind == CategoryKind.EXPENSE)
    # COUNT(DISTINCT … FILTER …) only counts completed month buckets that
    # actually contain expenses, so missing history is not treated as zero spend.
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
        .where(Transaction.dt >= window_start)
        .where(Transaction.dt < window_end),
    )).one()

    months_covered = int(agg.months_covered)
    expense_outflow = int(agg.expense_outflow)

    if months_covered < 1 or expense_outflow >= 0:
        return RunwayResponse(
            months=None, reason="insufficient_history",
            avg_monthly_expense=0, months_covered=months_covered,
            liquid_balance=liquid_balance,
            thresholds=thresholds,
        )

    avg_monthly_expense = abs(expense_outflow) // months_covered
    months = liquid_balance / avg_monthly_expense if avg_monthly_expense > 0 else None
    return RunwayResponse(
        months=max(0.0, months) if months is not None else None,
        reason=None,
        avg_monthly_expense=avg_monthly_expense,
        months_covered=months_covered,
        liquid_balance=liquid_balance,
        thresholds=thresholds,
    )
