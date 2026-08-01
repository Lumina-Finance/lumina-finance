"""Account balance adjustment helpers"""
import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.models.user import User
from app.services.accounts.snapshots import get_current_balances, recompute_snapshots_from
from app.services.merchants.defaults import SELF_MERCHANT_NAME

_BALANCE_ADJUSTMENT_CATEGORY_NAME = "Balance Adjustment"
_STARTING_BALANCE_NOTE = "Starting balance"
_ARCHIVE_BALANCE_ADJUSTMENT_NOTE = "Account archived"


async def add_account_starting_balance_adjustment(
    db: AsyncSession,
    account: Account,
    *,
    user_id: uuid.UUID,
    amount: int,
    adjustment_date: date,
) -> None:
    """Add the starting balance adjustment for an account

    Args:
        db: Active database session
        account: Account receiving the starting balance
        user_id: User creating the account
        amount: Starting balance amount in minor units
        adjustment_date: Date used for the adjustment transaction

    Raises:
        HTTPException: Balance adjustment category or the Myself merchant is not configured
    """
    db.add(Transaction(
        created_by_user_id=user_id,
        account_id=account.id,
        dt=adjustment_date,
        category_id=await _get_system_balance_adjustment_category_id(db),
        merchant_id=await _get_self_merchant_id(db),
        amount=amount,
        currency=account.currency,
        fx_rate=None,
        notes=_STARTING_BALANCE_NOTE,
    ))
    await db.flush()
    await recompute_snapshots_from(db, account.id, adjustment_date)


async def zero_account_balance_for_archive(
    db: AsyncSession,
    account: Account,
    user: User,
    archive_date: date,
) -> None:
    """Add an archive adjustment when an account has a nonzero balance

    Args:
        db: Active database session
        account: Account being archived
        user: Authenticated user archiving the account
        archive_date: Date used for the archive adjustment transaction

    Raises:
        HTTPException: Balance adjustment category or the Myself merchant is not configured
    """
    current_balance = (await get_current_balances(db, [account.id])).get(account.id, 0)
    if current_balance == 0:
        return

    db.add(Transaction(
        created_by_user_id=user.id,
        account_id=account.id,
        dt=archive_date,
        category_id=await _get_system_balance_adjustment_category_id(db),
        merchant_id=await _get_self_merchant_id(db),
        amount=-current_balance,
        currency=account.currency,
        fx_rate=None,
        notes=_ARCHIVE_BALANCE_ADJUSTMENT_NOTE,
    ))
    await db.flush()
    await recompute_snapshots_from(db, account.id, archive_date)


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
