"""Transaction import account creation helpers"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountBalanceSnapshot
from app.models.base import ACCOUNT_KIND_BY_TYPE, AccountType
from app.models.currency import Currency
from app.models.institution import Institution
from app.models.user import User
from app.schemas.transaction import TransactionImportCreateAccount
from app.services.importers.shared.validation_helpers import strip_import_text_or_raise
from app.utils.dates import resolve_timezone


async def create_import_account(
    db: AsyncSession,
    user: User,
    create: TransactionImportCreateAccount,
) -> Account:
    """Create a personal account for an import source mapping

    Args:
        db: Active database session
        user: Authenticated user running the import
        create: New account fields from the import mapping

    Returns:
        Created account row
    """
    account_type = parse_import_account_type(create.account_type)
    currency = create.currency.upper()
    await validate_import_account_currency(db, currency)
    await validate_import_account_institution(db, create.institution_id)

    account = Account(
        owner_id=user.id,
        group_id=None,
        account_kind=ACCOUNT_KIND_BY_TYPE[account_type],
        account_type=account_type,
        tax_advantaged_category_id=None,
        name=strip_import_text_or_raise(create.name, "Account name"),
        institution_id=create.institution_id,
        currency=currency,
        credit_limit=None,
        is_archived=False,
    )
    db.add(account)
    await db.flush()

    _add_import_account_opening_snapshot(db, account, user.tz)
    return account


def _add_import_account_opening_snapshot(db: AsyncSession, account: Account, user_timezone: str) -> None:
    """Add the zero-balance snapshot that anchors a new import account

    Args:
        db: Active database session
        account: Account row created from the import mapping
        user_timezone: Time zone used to convert the account creation time into a local date

    Returns:
        None

    Raises:
        HTTPException: Stored timezone is not a zone the app recognizes
    """
    opening_snapshot = AccountBalanceSnapshot(
        account_id=account.id,
        dt=account.created_at.astimezone(resolve_timezone(user_timezone)).date(),
        balance=0,
    )

    # Anchor the imported account at zero before imported transactions are applied
    db.add(opening_snapshot)


async def validate_import_account_currency(db: AsyncSession, currency: str) -> None:
    """Validate that an import-created account currency exists

    Args:
        db: Active database session
        currency: Uppercase currency code requested for the account

    Returns:
        None

    Raises:
        HTTPException: Raised with 422 when the currency code does not exist
    """
    currency_query = select(Currency.id).where(Currency.id == currency)

    # Check the currency table before inserting an import-created account
    currency_exists = (await db.execute(currency_query)).scalar_one_or_none() is not None
    if not currency_exists:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Invalid currency code: {currency}")


async def validate_import_account_institution(db: AsyncSession, institution_id: uuid.UUID | None) -> None:
    """Validate that an optional import-created account institution exists

    Args:
        db: Active database session
        institution_id: Optional institution ID requested for the account

    Returns:
        None

    Raises:
        HTTPException: Raised with 422 when the institution ID does not exist
    """
    if institution_id is None:
        return

    institution_query = select(Institution.id).where(Institution.id == institution_id)

    # Check the institution table only when the import payload links a new account to an institution
    institution_exists = (await db.execute(institution_query)).scalar_one_or_none() is not None
    if not institution_exists:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Institution not found")


def parse_import_account_type(value: str) -> AccountType:
    """Return an account type enum for an import-created account

    Args:
        value: Raw account type value from the import payload

    Returns:
        Parsed account type enum

    Raises:
        HTTPException: Raised with 422 when the account type is unsupported
    """
    try:
        return AccountType(value)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid account type") from exc
