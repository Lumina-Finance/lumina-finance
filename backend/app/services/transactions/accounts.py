"""Transaction account helper services"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.transaction import Transaction
from app.models.user import User
from app.services.allowance.currency import require_writable_record


async def get_parent_account_for_transaction(db: AsyncSession, txn: Transaction) -> Account:
    """Return the account that currently owns a transaction

    Mutation routes use the persisted parent account for archive checks and
    cache scope updates after the transaction access check has already loaded
    the transaction row

    Args:
        db: Active database session
        txn: Transaction whose parent account should be loaded

    Returns:
        Account row that owns the transaction
    """
    # Fetch the persisted parent account so archive checks and cache scope use current account data
    result = await db.execute(select(Account).where(Account.id == txn.account_id))
    return result.scalar_one()


def validate_transaction_account_is_not_archived(account: Account) -> None:
    """Ensure a transaction mutation can use an account

    Archived accounts stay readable, but transaction create, update, and
    delete paths cannot write new history for them

    Args:
        account: Account being used by a transaction mutation

    Raises:
        HTTPException: Account is archived
    """
    if account.is_archived:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Account is archived")


async def require_writable_account(db: AsyncSession, user: User, account: Account) -> None:
    """Ensure a transaction can be added to an account or changed in it

    An archived account takes no new history, and neither does one whose currency the installed
    check keeps read-only. Deleting a transaction asks only about archiving, so a read-only
    account's history can always be cleared

    Args:
        db: Active database session
        user: The user making the change
        account: Account being used by a transaction write

    Raises:
        HTTPException: 422 when the account is archived, 403 with the check's sentence when it is read-only
    """
    validate_transaction_account_is_not_archived(account)
    await require_writable_record(db, user, account)
