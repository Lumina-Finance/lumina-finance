"""Which days a bank import into an account may cover

The start step, the link request and a later date range import work the range out the same way,
here: any day from the provider's history limit through today. An import may reach into days the
ledger already covers, since everything it brings in waits for review and a bank transaction already
brought in is never brought in again. The ledger floor, the day after the account's latest
transaction dated today or earlier whatever its source, is returned as a fact for the start step's
"After the latest transaction" choice. Future-dated transactions don't count, and bank items still
waiting for review aren't ledger transactions, so they don't either. Today is the user's, in their
profile timezone
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.transaction import Transaction
from app.models.user import User
from app.services.accounts.access import get_own_personal_account
from app.services.bank_sync.availability import LINK_NOT_OWN_DETAIL, get_enabled_adapter, require_bank_linking
from app.utils.dates import format_day, get_shifted_month_start_date, resolve_timezone


@dataclass(frozen=True)
class ImportRange:
    """The days an import into one account may cover, as calendar dates in the user's profile timezone"""

    earliest_allowed: date
    latest_allowed: date

    # The day after the latest ledger transaction dated today or earlier, None for an account with none
    ledger_floor: date | None
    provider_limit_date: date
    provider_history_months: int

    def allows(self, day: date) -> bool:
        """Return whether an import may cover a day"""
        return self.earliest_allowed <= day <= self.latest_allowed


def check_import_days(import_range: ImportRange, first_day: date, last_day: date) -> None:
    """Refuse an import's first and last days, saying which to change, unless the range allows them

    Raises:
        HTTPException 422: A day falls outside the range, or the first is after the last
    """
    allowed = f"{format_day(import_range.earliest_allowed)} to {format_day(import_range.latest_allowed)}"
    if not import_range.allows(first_day):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Please choose a start date from {allowed}")
    if not import_range.allows(last_day):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Please choose an end date from {allowed}")
    if first_day > last_day:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Please choose a start date on or before the end date")


def calculate_import_range(*, today: date, latest_ledger_date: date | None, history_months: int) -> ImportRange:
    """Work out which days an import may cover from the provider's limit, with the account's ledger floor beside it

    Args:
        today: Today in the user's profile timezone
        latest_ledger_date: The account's latest transaction dated today or earlier, or None
        history_months: How many calendar months back the provider's limit reaches

    Returns:
        The allowed range and the facts the start step shows beside it
    """
    provider_limit_date = get_shifted_month_start_date(today, -history_months)
    return ImportRange(
        earliest_allowed=provider_limit_date,
        latest_allowed=today,
        ledger_floor=latest_ledger_date + timedelta(days=1) if latest_ledger_date is not None else None,
        provider_limit_date=provider_limit_date,
        provider_history_months=history_months,
    )


async def read_import_range(db: AsyncSession, account_id: uuid.UUID, *, history_months: int, today: date) -> ImportRange:
    """Return which days an import into an account may cover, with its ledger floor

    Args:
        db: Active database session
        account_id: The account an import would go into. The caller has checked the user may link it
        history_months: How many calendar months back the provider's limit reaches
        today: Today in the user's profile timezone

    Returns:
        The allowed range
    """
    latest_ledger_date = await db.scalar(select(func.max(Transaction.dt)).where(Transaction.account_id == account_id, Transaction.dt <= today))
    return calculate_import_range(today=today, latest_ledger_date=latest_ledger_date, history_months=history_months)


async def get_import_range(db: AsyncSession, user: User, account_id: uuid.UUID, provider: str) -> ImportRange:
    """Return which days an import from a provider into one of the user's own accounts may cover

    Args:
        db: Active database session
        user: The user linking the account
        account_id: The account to link
        provider: The provider the import would come from

    Returns:
        The allowed range, in the user's profile timezone

    Raises:
        HTTPException 403: The user may not link bank accounts, or the account isn't their own
            personal account
        HTTPException 404: The user can't see the account
        HTTPException 422: The deployment doesn't enable the provider, or the profile's timezone
            no longer resolves
    """
    require_bank_linking(user.id)
    adapter = get_enabled_adapter(provider)
    account = await get_own_personal_account(db, account_id, user.id, not_own_detail=LINK_NOT_OWN_DETAIL)
    today = datetime.now(resolve_timezone(user.tz)).date()
    return await read_import_range(db, account.id, history_months=adapter.history_limit_months, today=today)
