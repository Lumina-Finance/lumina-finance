"""Transaction import account mapping"""
import uuid
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import PermissionLevel
from app.models.user import User
from app.permissions import check_account_access
from app.schemas.transaction import TransactionImportAccountMapping
from app.services.importers.shared.account_creation_helpers import create_import_account
from app.services.importers.shared.stats import ImportStats
from app.services.importers.shared.validation_helpers import strip_import_text_or_raise


@dataclass
class ImportAccountSources:
    """Store what every declared account source resolves to

    Attributes:
        accounts_by_source: Account rows keyed by trimmed account source
        outside_sources: Trimmed sources answered as money outside the tracked accounts
    """

    accounts_by_source: dict[str, Account]
    outside_sources: set[str]


async def resolve_import_account_sources(
    db: AsyncSession,
    user: User,
    mappings: list[TransactionImportAccountMapping],
    stats: ImportStats,
) -> ImportAccountSources:
    """Resolve every declared account source to an account or to the outside answer

    Existing account mappings are checked for write access, while create
    mappings insert a new personal account and opening balance snapshot

    Args:
        db: Active database session
        user: Authenticated user running the import
        mappings: Account source mappings from the import payload
        stats: Import summary counters updated while accounts are matched or created

    Returns:
        Accounts keyed by source, and the sources answered as outside the tracked accounts

    Raises:
        HTTPException: Raised with 422 when a source is declared twice or maps to no single answer
    """
    accounts_by_source: dict[str, Account] = {}
    outside_sources: set[str] = set()

    # Build each declared account source once so import rows can use a stable lookup map
    for mapping in mappings:
        source = strip_import_text_or_raise(mapping.source, "Account source")
        if source in accounts_by_source or source in outside_sources:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Duplicate account source: {source}")

        if mapping.outside:
            if mapping.account_id is not None or mapping.create is not None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"Account source must map to exactly one account action: {source}",
                )
            outside_sources.add(source)
            continue

        accounts_by_source[source] = await _get_or_create_import_account_for_mapping(db, user, mapping, source, stats)
    return ImportAccountSources(accounts_by_source=accounts_by_source, outside_sources=outside_sources)


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

    account = await create_import_account(db, user, mapping.create)
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
