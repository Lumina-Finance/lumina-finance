"""Account response loading helpers"""
import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.account import Account
from app.models.base import PermissionLevel
from app.models.user import User
from app.permissions import check_account_access
from app.permissions.accounts import attach_account_write_capabilities
from app.routes.accounts.balance_field_helpers import attach_account_balance_fields


async def get_account_response_for_user(
    db: AsyncSession,
    account_id: uuid.UUID,
    user: User,
    as_of_date: date,
) -> Account:
    """Return an account response after checking read access

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        user: Authenticated user requesting the account
        as_of_date: Date used for current balance fields

    Returns:
        Account with derived balance fields

    Raises:
        HTTPException: User does not have read access
    """
    account = await check_account_access(db, account_id, user.id, PermissionLevel.READ)
    await attach_account_write_capabilities(db, [account], user.id)
    await attach_account_balance_fields(db, [account], user, as_of_date)
    return account


async def get_account_for_response(
    db: AsyncSession,
    user: User,
    account_id: uuid.UUID,
    as_of_date: date,
    *,
    refresh_cached_account: bool = False,
) -> Account:
    """Return an account with API response relationships and balance fields

    Args:
        db: Active database session
        user: Authenticated user receiving the response
        account_id: Account identifier to load
        as_of_date: Date used for current balance fields
        refresh_cached_account: Whether to overwrite a cached account instance

    Returns:
        Account prepared for route response serialization
    """
    query = (
        select(Account)
        .where(Account.id == account_id)
        .options(selectinload(Account.institution))
    )
    if refresh_cached_account:
        query = query.execution_options(populate_existing=True)

    # Fetch the account with response relationships and optional identity-map refresh
    result = await db.execute(query)
    account = result.scalar_one()
    await attach_account_write_capabilities(db, [account], user.id)
    await attach_account_balance_fields(db, [account], user, as_of_date)
    return account
