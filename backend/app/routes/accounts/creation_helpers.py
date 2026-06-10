"""Account creation helpers"""
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountBalanceSnapshot
from app.models.user import User
from app.routes.accounts.balance_adjustment_helpers import add_account_starting_balance_adjustment
from app.routes.accounts.creation_scope_helpers import AccountCreationScope, resolve_account_creation_scope
from app.routes.accounts.request_validation_helpers import validate_create_account_request
from app.routes.accounts.response_loading_helpers import get_account_for_response
from app.routes.accounts.tax_advantaged_category_link_helpers import validate_create_account_tax_advantaged_category_link
from app.schemas.account import CreateAccountRequest
from app.services.cache_state import mark_cache_changed_for_scope


async def create_account_for_user(
    db: AsyncSession,
    user: User,
    data: CreateAccountRequest,
) -> Account:
    """Create a personal or group account for a user

    Args:
        db: Active database session
        user: Authenticated user creating the account
        data: Account creation request body

    Returns:
        Created account with derived balance fields

    Raises:
        HTTPException: Account details, ownership, or linked tax-advantaged category are invalid
    """
    await validate_create_account_request(db, data)
    creation_scope = await resolve_account_creation_scope(db, user, data.group_id)
    await validate_create_account_tax_advantaged_category_link(db, data, creation_scope, user.id)

    account = await create_account_with_initial_balance_history(db, data, creation_scope, user)

    # Mark the account scope stale before returning the account with derived fields
    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
    await db.commit()

    response_date = datetime.now(ZoneInfo(user.tz)).date()
    response_account = await get_account_for_response(db, user, account.id, response_date)
    return response_account


async def create_account_with_initial_balance_history(
    db: AsyncSession,
    data: CreateAccountRequest,
    creation_scope: AccountCreationScope,
    user: User,
) -> Account:
    """Create an account with its initial balance history

    Args:
        db: Active database session
        data: Account creation request body
        creation_scope: Resolved ownership and date-anchor details
        user: Authenticated user creating the account

    Returns:
        Created account row pending commit
    """
    account = Account(
        owner_id=creation_scope.owner_id,
        group_id=creation_scope.group_id,
        account_kind=data.account_kind,
        account_type=data.account_type,
        tax_advantaged_category_id=data.tax_advantaged_category_id,
        name=data.name,
        institution_id=data.institution_id,
        currency=data.currency,
        credit_limit=data.credit_limit,
        is_archived=data.is_archived,
    )
    db.add(account)
    await db.flush()

    anchor_dt = account.created_at.astimezone(ZoneInfo(creation_scope.anchor_tz)).date()
    db.add(AccountBalanceSnapshot(
        account_id=account.id,
        dt=anchor_dt,
        balance=0,
    ))

    if data.starting_balance:
        await add_account_starting_balance_adjustment(
            db,
            account,
            user_id=user.id,
            amount=data.starting_balance,
            adjustment_date=anchor_dt,
        )

    return account
