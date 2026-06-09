"""Transaction import account mapping"""
import uuid
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountBalanceSnapshot
from app.models.base import ACCOUNT_KIND_BY_TYPE, AccountType, PermissionLevel
from app.models.currency import Currency
from app.models.institution import Institution
from app.models.user import User
from app.permissions import check_account_access
from app.schemas.transaction import TransactionImportAccountMapping, TransactionImportCreateAccount
from app.services.transactions.imports.stats import ImportStats
from app.services.transactions.imports.validation import strip_import_text_or_raise


async def get_or_create_import_accounts_by_source(
    db: AsyncSession,
    user: User,
    mappings: list[TransactionImportAccountMapping],
    stats: ImportStats,
) -> dict[str, Account]:
    """Return account rows keyed by import source

    Existing account mappings are checked for write access, while create
    mappings insert a new personal account and opening balance snapshot

    Args:
        db: Active database session
        user: Authenticated user running the import
        mappings: Account source mappings from the import payload
        stats: Import summary counters updated while accounts are matched or created

    Returns:
        Account rows keyed by trimmed account source
    """
    accounts_by_source: dict[str, Account] = {}

    # Build each declared account source once so import rows can use a stable lookup map
    for mapping in mappings:
        source = strip_import_text_or_raise(mapping.source, "Account source")
        if source in accounts_by_source:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Duplicate account source: {source}")

        accounts_by_source[source] = await _get_or_create_import_account_for_mapping(db, user, mapping, source, stats)
    return accounts_by_source


async def _get_or_create_import_account_for_mapping(
    db: AsyncSession,
    user: User,
    mapping: TransactionImportAccountMapping,
    source: str,
    stats: ImportStats,
) -> Account:
    """Return the account selected by one import account source mapping

    Args:
        db: Active database session
        user: Authenticated user running the import
        mapping: Account source mapping from the import payload
        source: Trimmed account source used in validation messages
        stats: Import summary counters updated when an account is reused or created

    Returns:
        Existing or newly created account row for the import source

    Raises:
        HTTPException: Raised with 422 when the source does not map to exactly one account action
    """
    if (mapping.account_id is None) == (mapping.create is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Account source must map to exactly one account action: {source}",
        )

    if mapping.account_id is not None:
        account = await _get_existing_import_account(db, user, mapping.account_id)
        stats.accounts_reused += 1
        return account

    account = await _create_import_account(db, user, mapping.create)
    stats.accounts_created += 1
    stats.created_account_ids.append(account.id)
    return account


async def _get_existing_import_account(db: AsyncSession, user: User, account_id: uuid.UUID) -> Account:
    """Return an existing account after validating import write access

    Args:
        db: Active database session
        user: Authenticated user running the import
        account_id: Existing account ID selected for an import source

    Returns:
        Writable, non-archived account row

    Raises:
        HTTPException: Raised with 422 when the account is archived
    """
    # Load the existing account through the shared permission check before reusing it
    account = await check_account_access(
        db,
        account_id,
        user.id,
        PermissionLevel.WRITE,
        require_open=True,
    )
    if account.is_archived:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Account is archived")
    return account


async def _create_import_account(
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
    account_type = _parse_account_type(create.account_type)
    currency = create.currency.upper()
    await _validate_import_account_currency(db, currency)
    await _validate_import_account_institution(db, create.institution_id)

    account = Account(
        owner_id=user.id,
        group_id=None,
        account_kind=ACCOUNT_KIND_BY_TYPE[account_type],
        account_type=account_type,
        tax_advantaged_plan_id=None,
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
    """
    # Anchor the imported account at zero before imported transactions are applied
    db.add(AccountBalanceSnapshot(
        account_id=account.id,
        dt=account.created_at.astimezone(ZoneInfo(user_timezone)).date(),
        balance=0,
    ))


async def _validate_import_account_currency(db: AsyncSession, currency: str) -> None:
    """Validate that an import-created account currency exists

    Args:
        db: Active database session
        currency: Uppercase currency code requested for the account

    Returns:
        None

    Raises:
        HTTPException: Raised with 422 when the currency code does not exist
    """
    # Check the currency table before inserting an import-created account
    currency_exists = (await db.execute(select(Currency.id).where(Currency.id == currency))).scalar_one_or_none() is not None
    if not currency_exists:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Invalid currency code: {currency}")


async def _validate_import_account_institution(db: AsyncSession, institution_id: uuid.UUID | None) -> None:
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

    # Check the institution table only when the import payload links a new account to an institution
    institution_exists = (await db.execute(select(Institution.id).where(Institution.id == institution_id))).scalar_one_or_none() is not None
    if not institution_exists:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Institution not found")


def _parse_account_type(value: str) -> AccountType:
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
