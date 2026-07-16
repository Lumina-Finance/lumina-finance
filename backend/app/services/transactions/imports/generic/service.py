"""Transaction import orchestration service"""
import uuid
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.user import User
from app.schemas.transaction import TransactionImportRequest, TransactionImportResponse
from app.services.accounts.snapshots import recompute_snapshots_from
from app.services.cache_state import mark_cache_changed_for_scope, mark_user_cache_changed
from app.services.transactions.imports.generic.imported_transaction_helpers import create_imported_transactions
from app.services.transactions.imports.generic.lookup_helpers import (
    load_transaction_import_lookups,
)
from app.services.transactions.imports.generic.response_helpers import build_transaction_import_response
from app.services.transactions.imports.shared.stats import ImportStats


async def import_transactions(
    db: AsyncSession,
    user: User,
    data: TransactionImportRequest,
) -> TransactionImportResponse:
    """Create transactions from a frontend-compiled import payload

    Args:
        db: Active database session
        user: Authenticated user running the import
        data: Prepared import payload from the frontend compiler

    Returns:
        Import summary containing transaction, account, category, merchant, tag, and affected account counts
    """
    stats = ImportStats()
    import_lookups = await load_transaction_import_lookups(db, user, data, stats)
    first_import_date_by_account_id = await create_imported_transactions(
        db,
        user_id=user.id,
        rows=data.rows,
        import_lookups=import_lookups,
        stats=stats,
    )

    await db.flush()
    await _recompute_snapshots_for_imported_accounts(db, first_import_date_by_account_id)
    await _mark_caches_changed_for_imported_accounts(
        db,
        user.id,
        import_lookups.accounts_by_source,
        first_import_date_by_account_id,
    )
    await db.commit()

    transaction_import_response = build_transaction_import_response(
        data,
        stats,
        import_lookups,
        first_import_date_by_account_id,
    )
    return transaction_import_response


async def _recompute_snapshots_for_imported_accounts(
    db: AsyncSession,
    first_import_date_by_account_id: dict[uuid.UUID, date],
) -> None:
    """Recompute balance snapshots for accounts touched by imported transactions

    Args:
        db: Active database session
        first_import_date_by_account_id: Earliest imported transaction date by affected account ID

    Returns:
        None
    """
    # Recompute each account from its earliest imported date to keep later balances aligned
    for account_id, first_import_date in first_import_date_by_account_id.items():
        await recompute_snapshots_from(db, account_id, first_import_date)


async def _mark_caches_changed_for_imported_accounts(
    db: AsyncSession,
    user_id: uuid.UUID,
    accounts_by_source: dict[str, Account],
    first_import_date_by_account_id: dict[uuid.UUID, date],
) -> None:
    """Mark user and account-scope caches changed after importing transactions

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        accounts_by_source: Account rows keyed by import source
        first_import_date_by_account_id: Earliest imported transaction date by affected account ID

    Returns:
        None
    """
    await mark_user_cache_changed(db, user_id)
    affected_accounts = {account.id: account for account in accounts_by_source.values()}

    # Mark each affected account scope so personal and group cache entries refresh
    for account_id in first_import_date_by_account_id:
        account = affected_accounts[account_id]
        await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
