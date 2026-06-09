"""Account creation helpers"""
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountBalanceSnapshot
from app.models.user import User
from app.routes.accounts.account_balance_adjustment_helpers import add_account_starting_balance_adjustment
from app.routes.accounts.account_creation_scope_helpers import AccountCreationScope
from app.schemas.account import CreateAccountRequest


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
        tax_advantaged_plan_id=data.tax_advantaged_plan_id,
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
