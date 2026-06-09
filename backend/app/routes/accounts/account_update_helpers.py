"""Account update helpers"""
from collections.abc import Mapping
from datetime import date
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.user import User
from app.routes.accounts.account_balance_adjustment_helpers import zero_account_balance_for_archive


async def apply_account_updates(
    db: AsyncSession,
    account: Account,
    updates: Mapping[str, Any],
    user: User,
    archive_date: date,
) -> None:
    """Apply account update fields and archive balance adjustment

    Args:
        db: Active database session
        account: Account being updated
        updates: Explicit fields from the account update request
        user: Authenticated user updating the account
        archive_date: Date used for archive balance adjustment rows
    """
    should_archive = updates.get("is_archived") is True and not account.is_archived

    for field, value in updates.items():
        setattr(account, field, value)

    if should_archive:
        await zero_account_balance_for_archive(db, account, user, archive_date)
