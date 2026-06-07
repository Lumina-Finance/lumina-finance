import calendar
import uuid
from datetime import date, datetime, timedelta
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
from app.schemas.fx import FxStatus
from app.schemas.user import (
    CacheScopeStatus,
    CacheStatus,
    RunwayAccountBalance,
    RunwayAccountsRequest,
    RunwayResponse,
    RunwaySettings,
    RunwayThresholds,
    UpdateProfileRequest,
    UserProfile,
)
from app.services.cache_state import get_visible_cache_status, mark_user_cache_changed
from app.services.dashboard import get_accessible_accounts
from app.services.fx import FxConverter
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


async def _accessible_non_archived_accounts(db: AsyncSession, user: User):
    return [
        account
        for account in await get_accessible_accounts(db, user, include_archived=True)
        if not account.is_archived
    ]


async def _runway_account_ids_by_archive_state(
    db: AsyncSession,
    user: User,
) -> tuple[list[uuid.UUID], list[uuid.UUID]]:
    accessible_accounts = await get_accessible_accounts(db, user, include_archived=True)
    active_ids = {account.id for account in accessible_accounts if not account.is_archived}
    archived_ids = {account.id for account in accessible_accounts if account.is_archived}
    stored = await db.execute(
        select(UserRunwayAccount.account_id).where(UserRunwayAccount.user_id == user.id),
    )
    active: list[uuid.UUID] = []
    archived: list[uuid.UUID] = []
    for account_id in stored.scalars().all():
        if account_id in active_ids:
            active.append(account_id)
        elif account_id in archived_ids:
            archived.append(account_id)
    return active, archived


async def _active_runway_account_ids(db: AsyncSession, user: User) -> list[uuid.UUID]:
    active, _archived = await _runway_account_ids_by_archive_state(db, user)
    return active


async def _replace_runway_account_ids(
    db: AsyncSession,
    user: User,
    account_ids: list[uuid.UUID],
) -> list[uuid.UUID]:
    requested_ids = set(account_ids)

    all_accessible = await get_accessible_accounts(db, user, include_archived=True)
    active_ids = {a.id for a in all_accessible if not a.is_archived}
    archived_ids = {a.id for a in all_accessible if a.is_archived}

    invalid = requested_ids - active_ids
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Inaccessible accounts: {sorted(str(x) for x in invalid)}",
        )

    # Replace the full set in a single transaction — simpler than diffing and
    # the runway selection is expected to be small (a handful of accounts).
    # Archived selections are left untouched so archiving an account is reversible.
    delete_query = delete(UserRunwayAccount).where(UserRunwayAccount.user_id == user.id)
    if archived_ids:
        delete_query = delete_query.where(UserRunwayAccount.account_id.not_in(archived_ids))
    await db.execute(delete_query)
    for account_id in requested_ids:
        db.add(UserRunwayAccount(user_id=user.id, account_id=account_id))

    return sorted(requested_ids)


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    result = await db.execute(select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)))
    return {row.id: row.minor_unit_exponent for row in result}


router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=UserProfile)
async def get_me(
    user: Annotated[User, Depends(get_current_user)],
):
    """Return the authenticated user's full profile."""
    return UserProfile.model_validate(user)


@router.get("/cache-status", response_model=CacheStatus)
async def get_cache_status(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the latest app-data change timestamp visible to the user."""
    status = await get_visible_cache_status(db, user.id)
    return CacheStatus(
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

    await mark_user_cache_changed(db, user.id)
    await db.commit()
    return UserProfile.model_validate(user)


@router.get("/runway-accounts", response_model=list[uuid.UUID])
async def list_runway_accounts(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the account IDs currently feeding the runway calculation.

    Filters out any stored selections the user can no longer read or has
    archived, so the response only surfaces currently active IDs.
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
    permission) and currently non-archived. Stored archived selections are
    preserved so they become active again if the account is unarchived.
    """
    selected_ids = await _replace_runway_account_ids(db, user, data.account_ids)
    await mark_user_cache_changed(db, user.id)
    await db.commit()

    return selected_ids


@router.get("/runway-settings", response_model=RunwaySettings)
async def get_runway_settings(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the user's runway account selection and status thresholds."""
    active_account_ids, archived_account_ids = await _runway_account_ids_by_archive_state(db, user)
    return RunwaySettings(
        account_ids=active_account_ids,
        archived_account_ids=archived_account_ids,
        thresholds=_runway_thresholds_from_user(user),
    )


@router.put("/runway-settings", response_model=RunwaySettings)
async def replace_runway_settings(
    data: RunwaySettings,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Replace the user's runway account selection and status thresholds."""
    await _replace_runway_account_ids(db, user, data.account_ids)
    user.runway_risky_below_months = data.thresholds.risky_below_months
    user.runway_healthy_at_months = data.thresholds.healthy_at_months
    await mark_user_cache_changed(db, user.id)
    await db.commit()
    active_account_ids, archived_account_ids = await _runway_account_ids_by_archive_state(db, user)

    return RunwaySettings(
        account_ids=active_account_ids,
        archived_account_ids=archived_account_ids,
        thresholds=_runway_thresholds_from_user(user),
    )


@router.get("/runway", response_model=RunwayResponse)
async def get_runway(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Compute the user's cash runway in months.

    Runway = (sum of current balance across selected runway accounts) divided
    by the average monthly net expense over the last 12 completed months.
    Expense refunds reduce expenses, while income and transfer-category
    transactions are excluded.
    """
    accounts = await _accessible_non_archived_accounts(db, user)
    account_by_id = {account.id: account for account in accounts}
    accessible_ids = set(account_by_id)
    stored = await db.execute(
        select(UserRunwayAccount.account_id).where(UserRunwayAccount.user_id == user.id),
    )
    selected_ids = [aid for aid in stored.scalars().all() if aid in accessible_ids]
    selected_accounts = [account_by_id[account_id] for account_id in selected_ids]
    thresholds = _runway_thresholds_from_user(user)

    if not selected_ids:
        return RunwayResponse(
            months=None, reason="no_accounts",
            avg_monthly_expense=0, months_covered=0, liquid_balance=0,
            account_balances=[],
            thresholds=thresholds,
            fx_status=FxStatus(),
        )

    today = datetime.now(ZoneInfo(user.tz)).date()
    window_end = date(today.year, today.month, 1)
    window_start = _add_months_anchored(window_end, -_RUNWAY_WINDOW_MONTHS)

    expense_result = await db.execute(
        select(
            Transaction.dt,
            Transaction.account_id,
            Category.id.label("category_id"),
            sa.func.sum(Transaction.amount).label("total"),
        )
        .select_from(Transaction)
        .join(Category, Category.id == Transaction.category_id)
        .where(Transaction.account_id.in_(accessible_ids))
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
        # Transaction.amount is stored in the account currency; Transaction.currency is receipt metadata.
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
    # Negative expense category-month totals count toward runway. Refunds reduce
    # expenses; over-refunded categories, income, and transfers are ignored.
    expense_outflow = sum(total for _month, total in outflow_totals)
    fx_status = converter.get_status()

    if months_covered < 1 or expense_outflow >= 0:
        return RunwayResponse(
            months=None, reason="insufficient_history",
            avg_monthly_expense=0, months_covered=months_covered,
            liquid_balance=liquid_balance,
            account_balances=account_balances,
            thresholds=thresholds,
            fx_status=fx_status,
        )

    avg_monthly_expense = abs(expense_outflow) // months_covered
    months = liquid_balance / avg_monthly_expense if avg_monthly_expense > 0 else None
    return RunwayResponse(
        months=max(0.0, months) if months is not None else None,
        reason=None,
        avg_monthly_expense=avg_monthly_expense,
        months_covered=months_covered,
        liquid_balance=liquid_balance,
        account_balances=account_balances,
        thresholds=thresholds,
        fx_status=fx_status,
    )
