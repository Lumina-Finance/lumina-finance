"""Storage for the credit accounts a user leaves out of the dashboard credit widget"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.user import User, UserCreditExcludedAccount
from app.services.dashboard_widgets.credit import get_credit_widget_accounts


async def get_excluded_credit_account_ids(db: AsyncSession, user: User) -> set[uuid.UUID]:
    """Return every account the user left out, including ones they can no longer see

    Callers match these against the accounts they are working with, so a left-out account that was
    deleted or is no longer visible changes nothing

    Args:
        db: Active database session
        user: Authenticated user

    Returns:
        Account IDs stored as left out
    """
    result = await db.execute(
        select(UserCreditExcludedAccount.account_id).where(UserCreditExcludedAccount.user_id == user.id),
    )
    return set(result.scalars().all())


async def replace_excluded_credit_account_ids(
    db: AsyncSession,
    user: User,
    accounts: list[Account],
    requested_ids: set[uuid.UUID],
) -> None:
    """Replace the credit accounts the user leaves out among the ones the widget can count

    Stored rows for accounts outside `accounts` are kept, so the choice returns if the user regains
    access to one

    Args:
        db: Active database session
        user: Authenticated user
        accounts: Accounts the user can read
        requested_ids: Credit accounts to leave out

    Raises:
        HTTPException: A requested account is not readable, or is not a credit account with a limit
    """
    credit_account_ids = {account.id for account in get_credit_widget_accounts(accounts)}
    readable_account_ids = {account.id for account in accounts}
    if requested_ids - readable_account_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    if requested_ids - credit_account_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Only credit accounts with a limit count toward credit utilization",
        )

    await db.execute(
        delete(UserCreditExcludedAccount).where(
            UserCreditExcludedAccount.user_id == user.id,
            UserCreditExcludedAccount.account_id.in_(credit_account_ids),
        ),
    )
    if requested_ids:
        # Two saves racing for the same user both insert the same rows, which the key makes harmless
        await db.execute(
            insert(UserCreditExcludedAccount)
            .values([{"user_id": user.id, "account_id": account_id} for account_id in requested_ids])
            .on_conflict_do_nothing(),
        )
