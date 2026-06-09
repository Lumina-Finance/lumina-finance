"""User profile and runway routes"""
import calendar
import uuid
from datetime import date, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.models.user import User
from app.routes.user_runway_account_helpers import (
    get_active_runway_account_ids,
    get_readable_non_archived_accounts_for_runway,
    get_runway_account_ids_by_archive_state,
    get_runway_thresholds_from_user,
    replace_runway_account_ids,
)
from app.schemas.fx import FxStatus
from app.schemas.user import (
    CacheScopeStatus,
    CacheStatus,
    RunwayAccountBalance,
    RunwayAccountsRequest,
    RunwayResponse,
    RunwaySettings,
    UpdateProfileRequest,
    UserProfile,
)
from app.services.cache_state import get_visible_cache_status, mark_user_cache_changed
from app.services.fx import FxConverter
from app.services.snapshots import get_current_balances

# Trailing window used to smooth seasonal spikes while staying current with lifestyle changes
_RUNWAY_WINDOW_MONTHS = 12


def _add_months_anchored(start: date, months: int) -> date:
    """Return a date shifted by whole calendar months

    Args:
        start: Starting date
        months: Number of months to shift

    Returns:
        Shifted date anchored to the closest valid day in the target month
    """
    month_index = (start.year * 12 + start.month - 1) + months
    year = month_index // 12
    month = month_index % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Return minor-unit exponents for currency codes

    Args:
        db: Active database session
        currencies: Currency codes to fetch

    Returns:
        Minor-unit exponent keyed by currency code
    """
    requested_currencies = currencies

    # Fetch currency exponents so balance and transaction amounts can be converted correctly
    currency_result = await db.execute(select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(requested_currencies)))
    currency_exponents = {row.id: row.minor_unit_exponent for row in currency_result}
    return currency_exponents


router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=UserProfile)
async def get_me(
    user: Annotated[User, Depends(get_current_user)],
):
    """Return the authenticated user's full profile"""
    return UserProfile.model_validate(user)


@router.get("/cache-status", response_model=CacheStatus)
async def get_cache_status(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the latest app-data change timestamp visible to the user"""
    status = await get_visible_cache_status(db, user.id)
    cache_status = CacheStatus(
        changed_at=status.changed_at,
        personal=CacheScopeStatus(
            changed_at=status.personal.changed_at,
            last_change_from_current_session=status.personal.last_change_from_current_session,
        ),
        groups={
            group_id: CacheScopeStatus(
                changed_at=group_status.changed_at,
                last_change_from_current_session=group_status.last_change_from_current_session,
            )
            for group_id, group_status in status.groups.items()
        },
    )
    return cache_status


@router.patch("", response_model=UserProfile)
async def update_me(
    data: UpdateProfileRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update the authenticated user's profile"""
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

    if "base_currency" in updates:
        base_currency = updates["base_currency"]

        # Fetch the target currency so users cannot save an unsupported base currency
        result = await db.execute(select(Currency).where(Currency.id == base_currency))
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")

    for field, value in updates.items():
        setattr(user, field, value)

    await mark_user_cache_changed(db, user.id)
    await db.commit()
    return UserProfile.model_validate(user)


@router.get("/runway-accounts", response_model=list[uuid.UUID])
async def list_runway_accounts(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the account IDs currently feeding the runway calculation

    Filters out any stored selections the user can no longer read or has
    archived, so the response only surfaces currently active IDs
    """
    active_account_ids = await get_active_runway_account_ids(db, user)
    return active_account_ids


@router.put("/runway-accounts", response_model=list[uuid.UUID])
async def replace_runway_accounts(
    data: RunwayAccountsRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Replace the user's runway account selection with the submitted set

    Dedupes the submitted set and rejects the whole request with 422 if any submitted
    account isn't readable by the user (personal, household admin, or explicit
    permission) and currently non-archived while stored archived selections are
    preserved so they become active again if the account is unarchived
    """
    selected_ids = await replace_runway_account_ids(db, user, data.account_ids)
    await mark_user_cache_changed(db, user.id)
    await db.commit()

    return selected_ids


@router.get("/runway-settings", response_model=RunwaySettings)
async def get_runway_settings(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the user's runway account selection and status thresholds"""
    active_account_ids, archived_account_ids = await get_runway_account_ids_by_archive_state(db, user)
    runway_settings = RunwaySettings(
        account_ids=active_account_ids,
        archived_account_ids=archived_account_ids,
        thresholds=get_runway_thresholds_from_user(user),
    )
    return runway_settings


@router.put("/runway-settings", response_model=RunwaySettings)
async def replace_runway_settings(
    data: RunwaySettings,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Replace the user's runway account selection and status thresholds"""
    await replace_runway_account_ids(db, user, data.account_ids)
    user.runway_risky_below_months = data.thresholds.risky_below_months
    user.runway_healthy_at_months = data.thresholds.healthy_at_months
    await mark_user_cache_changed(db, user.id)
    await db.commit()
    active_account_ids, archived_account_ids = await get_runway_account_ids_by_archive_state(db, user)

    runway_settings = RunwaySettings(
        account_ids=active_account_ids,
        archived_account_ids=archived_account_ids,
        thresholds=get_runway_thresholds_from_user(user),
    )
    return runway_settings


@router.get("/runway", response_model=RunwayResponse)
async def get_runway(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Compute the user's cash runway in months

    Runway = (sum of current balance across selected runway accounts) divided
    by the average monthly net expense over the last 12 completed months
    Expense refunds reduce expenses, while income and transfer-category
    transactions are excluded
    """
    accounts = await get_readable_non_archived_accounts_for_runway(db, user)
    account_by_id = {account.id: account for account in accounts}
    readable_account_ids = set(account_by_id)
    active_runway_account_ids = await get_active_runway_account_ids(db, user)
    selected_ids = [account_id for account_id in active_runway_account_ids if account_id in readable_account_ids]
    selected_accounts = [account_by_id[account_id] for account_id in selected_ids]
    thresholds = get_runway_thresholds_from_user(user)

    if not selected_ids:
        response = RunwayResponse(
            months=None, reason="no_accounts",
            avg_monthly_expense=0, months_covered=0, liquid_balance=0,
            account_balances=[],
            thresholds=thresholds,
            fx_status=FxStatus(),
        )
        return response

    today = datetime.now(ZoneInfo(user.tz)).date()
    window_end = date(today.year, today.month, 1)
    window_start = _add_months_anchored(window_end, -_RUNWAY_WINDOW_MONTHS)

    # Fetch expense totals by transaction date, account, and category inside the completed-month runway window
    expense_result = await db.execute(
        select(
            Transaction.dt,
            Transaction.account_id,
            Category.id.label("category_id"),
            sa.func.sum(Transaction.amount).label("total"),
        )
        .select_from(Transaction)
        .join(Category, Category.id == Transaction.category_id)
        .where(Transaction.account_id.in_(readable_account_ids))
        .where(Transaction.dt >= window_start)
        .where(Transaction.dt < window_end)
        .where(Category.kind == CategoryKind.EXPENSE)
        .group_by(Transaction.dt, Transaction.account_id, Category.id)
    )
    expense_rows = list(expense_result)
    expense_currencies = {account_by_id[row.account_id].currency for row in expense_rows}
    selected_currencies = {account.currency for account in selected_accounts}
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {user.base_currency, *expense_currencies, *selected_currencies},
        ),
    )
    for currency in sorted((expense_currencies | selected_currencies) - {user.base_currency}):
        await converter.prefetch_rates(
            base=currency,
            quote=user.base_currency,
            start_date=window_start if currency in expense_currencies else today,
            end_date=today if currency in selected_currencies else window_end - timedelta(days=1),
        )

    balances = await get_current_balances(db, selected_ids)
    account_balances: list[RunwayAccountBalance] = []
    liquid_balance = 0
    for account in selected_accounts:
        converted_balance = await converter.convert_minor_units(
            balances.get(account.id, 0),
            base=account.currency,
            quote=user.base_currency,
            rate_date=today,
        )
        if converted_balance is None:
            continue

        liquid_balance += converted_balance
        account_balances.append(RunwayAccountBalance(account_id=account.id, balance=converted_balance))

    category_month_totals: dict[tuple[date, uuid.UUID], int] = {}
    for row in expense_rows:

        # Convert account-currency expense totals into the user's base currency by transaction date
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=account_by_id[row.account_id].currency,
            quote=user.base_currency,
            rate_date=row.dt,
        )
        if converted_total is None:
            continue

        key = (date(row.dt.year, row.dt.month, 1), row.category_id)
        category_month_totals[key] = category_month_totals.get(key, 0) + converted_total

    outflow_totals = [
        (month, total)
        for (month, _category_id), total in category_month_totals.items()
        if total < 0
    ]
    months_covered = len({month for month, _total in outflow_totals})

    # Negative expense category-month totals count toward runway while refunds reduce expenses
    expense_outflow = sum(total for _month, total in outflow_totals)
    fx_status = converter.get_status()

    if months_covered < 1 or expense_outflow >= 0:
        response = RunwayResponse(
            months=None, reason="insufficient_history",
            avg_monthly_expense=0, months_covered=months_covered,
            liquid_balance=liquid_balance,
            account_balances=account_balances,
            thresholds=thresholds,
            fx_status=fx_status,
        )
        return response

    avg_monthly_expense = abs(expense_outflow) // months_covered
    months = liquid_balance / avg_monthly_expense if avg_monthly_expense > 0 else None
    response = RunwayResponse(
        months=max(0.0, months) if months is not None else None,
        reason=None,
        avg_monthly_expense=avg_monthly_expense,
        months_covered=months_covered,
        liquid_balance=liquid_balance,
        account_balances=account_balances,
        thresholds=thresholds,
        fx_status=fx_status,
    )
    return response
