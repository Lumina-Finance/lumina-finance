"""Account balance adjustment helpers"""

import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import AccountKind, CategoryKind
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.models.user import User
from app.services.accounts.snapshots import (
    get_current_balances,
    recompute_account_snapshots,
    refuse_unstorable_balance,
)
from app.services.merchants.defaults import SELF_MERCHANT_NAME

_BALANCE_ADJUSTMENT_CATEGORY_NAME = "Balance Adjustment"
_STARTING_BALANCE_NOTE = "Starting balance"
_ARCHIVE_BALANCE_ADJUSTMENT_NOTE = "Account archived"


async def record_account_starting_balance(
    db: AsyncSession,
    account: Account,
    *,
    user_id: uuid.UUID,
    amount: int,
    adjustment_date: date,
) -> None:
    """Record the starting balance of a personal account that has no transactions yet

    The amount is the balance as the user states it, so a liability's, which is what is owed, is
    saved negated. The account row is locked before its transactions are looked for, so a
    transaction still being saved, or a repeat of this request, is seen once it commits and this
    one is refused rather than adding a second starting balance. An archived account is not refused,
    since an account can be created archived and still needs its starting balance

    Args:
        db: Active database session
        account: The user's own personal account, which receives the starting balance
        user_id: User recording the starting balance
        amount: Starting balance in minor units, above zero
        adjustment_date: The user's today, which dates the adjustment

    Raises:
        HTTPException: The account already has transactions, the amount is outside the range an account
            balance can hold, or the Balance Adjustment category or the Myself merchant is not configured
    """
    # The row lock conflicts with the key share lock a transaction insert takes on its account
    await db.execute(select(Account.id).where(Account.id == account.id).with_for_update())
    first_transaction_id = await db.scalar(
        select(Transaction.id).where(Transaction.account_id == account.id).limit(1),
    )
    if first_transaction_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="This account already has transactions, so a starting balance can't be recorded",
        )

    signed_amount = amount if account.account_kind == AccountKind.ASSET else -amount

    # The account holds nothing else yet, so the amount is its whole balance
    refuse_unstorable_balance(account.name, signed_amount)
    db.add(
        Transaction(
            created_by_user_id=user_id,
            account_id=account.id,
            dt=adjustment_date,
            category_id=await _get_system_balance_adjustment_category_id(db),
            merchant_id=await _get_self_merchant_id(db),
            amount=signed_amount,
            currency=account.currency,
            fx_rate=None,
            notes=_STARTING_BALANCE_NOTE,
        )
    )
    await db.flush()
    await recompute_account_snapshots(db, {account.id: adjustment_date})


async def has_transactions_after(db: AsyncSession, account_id: uuid.UUID, after_date: date) -> bool:
    """Return whether an account holds any transaction dated after a date

    Args:
        db: Active database session
        account_id: Account whose transactions are checked
        after_date: Latest date that does not count as later

    Returns:
        True when at least one transaction is dated after the date
    """
    later_transaction_id = await db.scalar(
        select(Transaction.id).where(Transaction.account_id == account_id, Transaction.dt > after_date).limit(1),
    )
    return later_transaction_id is not None


async def validate_no_transactions_after_archive_date(
    db: AsyncSession,
    account: Account,
    archive_date: date,
) -> None:
    """Refuse to archive an account that holds transactions dated after the archive date

    The archive adjustment zeroes the balance on the archive date, and archived accounts refuse
    transaction edits, so a later-dated row would move the balance off zero once its date arrived
    with no way to remove it

    Args:
        db: Active database session
        account: Account being archived
        archive_date: Date used for the archive adjustment transaction

    Raises:
        HTTPException: The account has transactions dated after the archive date
    """
    if await has_transactions_after(db, account.id, archive_date):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "This account can't be archived because it has future dated transactions. "
                "Please delete them or adjust date before archiving the account."
            ),
        )


async def zero_account_balance_for_archive(
    db: AsyncSession,
    account: Account,
    user: User,
    archive_date: date,
    import_run_id: uuid.UUID | None = None,
) -> bool:
    """Add an archive adjustment when an account has a nonzero balance

    Args:
        db: Active database session
        account: Account being archived
        user: Authenticated user archiving the account
        archive_date: Date used for the archive adjustment transaction
        import_run_id: Import run archiving the account, which the adjustment is stamped with so
            undoing the import deletes it with the rest

    Returns:
        Whether an adjustment was added

    Raises:
        HTTPException: Balance adjustment category or the Myself merchant is not configured
    """
    current_balance = (await get_current_balances(db, [account.id], archive_date)).get(account.id, 0)
    if current_balance == 0:
        return False

    db.add(
        Transaction(
            created_by_user_id=user.id,
            account_id=account.id,
            dt=archive_date,
            category_id=await _get_system_balance_adjustment_category_id(db),
            merchant_id=await _get_self_merchant_id(db),
            amount=-current_balance,
            currency=account.currency,
            fx_rate=None,
            notes=_ARCHIVE_BALANCE_ADJUSTMENT_NOTE,
            import_run_id=import_run_id,
        )
    )
    await db.flush()
    await recompute_account_snapshots(db, {account.id: archive_date})
    return True


async def _get_self_merchant_id(db: AsyncSession) -> uuid.UUID:
    """Return the shared Myself merchant identifier

    Args:
        db: Active database session

    Returns:
        Myself merchant identifier

    Raises:
        HTTPException: Myself merchant is not configured
    """
    # Fetch the merchant the app attributes its own balance adjustments to
    merchant_id = await db.scalar(
        select(Merchant.id).where(
            Merchant.is_system.is_(True),
            Merchant.name == SELF_MERCHANT_NAME,
        ),
    )
    if merchant_id is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Myself merchant is not configured",
        )
    return merchant_id


async def _get_system_balance_adjustment_category_id(db: AsyncSession) -> uuid.UUID:
    """Return the system balance adjustment category identifier

    Args:
        db: Active database session

    Returns:
        Balance adjustment category identifier

    Raises:
        HTTPException: Balance adjustment category is not configured
    """
    # Fetch the system transfer category used for synthetic balance adjustment transactions
    category_id = await db.scalar(
        select(Category.id).where(
            Category.is_system.is_(True),
            Category.kind == CategoryKind.TRANSFER,
            Category.name == _BALANCE_ADJUSTMENT_CATEGORY_NAME,
        ),
    )
    if category_id is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Balance adjustment category is not configured",
        )
    return category_id
