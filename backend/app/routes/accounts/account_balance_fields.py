"""Account balance field attachment helpers"""
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.user import User
from app.services.accounts import attach_base_currency_current_balances
from app.services.snapshots import attach_current_balances


async def attach_account_balance_fields(
    db: AsyncSession,
    accounts: list[Account],
    user: User,
    rate_date: date,
) -> None:
    """Attach current and base-currency balance fields to accounts

    Args:
        db: Active database session
        accounts: Accounts receiving derived balance fields
        user: Authenticated user requesting the account data
        rate_date: Date used for FX conversion
    """
    await attach_current_balances(db, accounts)
    await attach_base_currency_current_balances(
        db,
        accounts,
        user.base_currency,
        rate_date,
    )
