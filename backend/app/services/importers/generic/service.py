"""Transaction import orchestration service"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.import_run import TransactionImportRequest, TransactionImportResponse
from app.services.accounts.snapshots import recompute_account_snapshots
from app.services.importers.generic.row_resolution import resolve_import_rows
from app.services.importers.shared.lookups import load_import_lookups
from app.services.importers.shared.save_results import build_import_summary, mark_import_caches_changed
from app.services.importers.shared.stats import ImportStats
from app.services.importers.shared.transaction_writer import write_imported_transactions


async def import_transactions(
    db: AsyncSession,
    user: User,
    data: TransactionImportRequest,
    import_run_id: uuid.UUID,
) -> TransactionImportResponse:
    """Create transactions from a whole staged import file

    The caller owns the transaction, so nothing here is durable until it commits. That is what lets
    the rows, the clearing of what was staged and the run's own stamp land together or not at all

    Args:
        db: Active database session
        user: Authenticated user running the import
        data: The whole file, rebuilt from its run
        import_run_id: Run being committed, which every written transaction is stamped with

    Returns:
        Import summary containing transaction, account, category, merchant, tag, and affected account counts
    """
    stats = ImportStats()
    import_lookups = await load_import_lookups(
        db,
        user,
        data.accounts,
        data.categories,
        stats,
        _get_counterparty_only_sources(data),
    )
    first_import_date_by_account_id = await write_imported_transactions(
        db,
        user_id=user.id,
        import_run_id=import_run_id,
        transactions=resolve_import_rows(data.rows, import_lookups, user.id),
        merchant_mappings=data.merchants,
        import_lookups=import_lookups,
        stats=stats,
    )

    await recompute_account_snapshots(db, first_import_date_by_account_id)
    await mark_import_caches_changed(
        db,
        user.id,
        import_lookups.accounts_by_source,
        first_import_date_by_account_id,
    )

    return build_import_summary(
        TransactionImportResponse,
        transactions_created=len(data.rows),
        stats=stats,
        import_lookups=import_lookups,
        first_import_date_by_account_id=first_import_date_by_account_id,
    )


def _get_counterparty_only_sources(data: TransactionImportRequest) -> set[str]:
    """Return the declared account sources no row in the file is written to

    Worked out from the rows rather than read off the payload, because these resolve under a
    weaker rule than an account rows are written to, and a client that could declare one would be
    choosing its own permission check. A source used both ways keeps the strict rule, since the
    rows using it are still written, and the whole file is resolved at once, so that holds across
    every row rather than within a part of it

    Args:
        data: The whole file, rebuilt from its run

    Returns:
        Trimmed sources that appear as no row's account source
    """
    row_account_sources = {row.account_source.strip() for row in data.rows}
    return {mapping.source.strip() for mapping in data.accounts} - row_account_sources
