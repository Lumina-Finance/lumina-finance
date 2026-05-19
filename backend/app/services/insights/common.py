"""Shared helpers for insights card services."""

from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.user import User
from app.services.dashboard import get_accessible_accounts


def previous_period_bounds(from_date: date, to_date: date) -> tuple[date, date]:
    """Return the immediately preceding inclusive period with the same length."""
    period_days = (to_date - from_date).days + 1
    previous_to_date = from_date - timedelta(days=1)
    previous_from_date = previous_to_date - timedelta(days=period_days - 1)
    return previous_from_date, previous_to_date


async def get_base_currency_accounts(db: AsyncSession, user: User) -> list[Account]:
    """Return readable, non-hidden accounts in the user's base currency."""
    accounts = await get_accessible_accounts(db, user)
    return [account for account in accounts if account.currency == user.base_currency]
