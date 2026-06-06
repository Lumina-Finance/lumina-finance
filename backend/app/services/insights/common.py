"""Shared helpers for insights card services."""

from calendar import monthrange
from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.user import User
from app.schemas.insights import InsightsComparisonPeriod
from app.services.dashboard import get_accessible_accounts


def previous_period_bounds(from_date: date, to_date: date) -> tuple[date, date]:
    """Return the immediately preceding inclusive period with the same length."""
    period_days = (to_date - from_date).days + 1
    previous_to_date = from_date - timedelta(days=1)
    previous_from_date = previous_to_date - timedelta(days=period_days - 1)
    return previous_from_date, previous_to_date


def comparison_period_bounds(
    from_date: date,
    to_date: date,
    comparison_period: InsightsComparisonPeriod,
) -> tuple[date, date]:
    """Return comparison bounds for the requested insights comparison mode."""
    if comparison_period == "previous_month":
        return _previous_calendar_month_bounds(from_date)
    if comparison_period == "previous_year":
        return _previous_calendar_year_bounds(from_date)
    return previous_period_bounds(from_date, to_date)


def _previous_calendar_month_bounds(from_date: date) -> tuple[date, date]:
    month = from_date.month - 1
    year = from_date.year
    if month == 0:
        month = 12
        year -= 1
    return date(year, month, 1), date(year, month, monthrange(year, month)[1])


def _previous_calendar_year_bounds(from_date: date) -> tuple[date, date]:
    year = from_date.year - 1
    return date(year, 1, 1), date(year, 12, 31)


async def get_base_currency_accounts(db: AsyncSession, user: User) -> list[Account]:
    """Return readable accounts in the user's base currency."""
    accounts = await get_accessible_accounts(db, user)
    return [account for account in accounts if account.currency == user.base_currency]
