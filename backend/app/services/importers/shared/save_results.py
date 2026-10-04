"""What every import's save does once its rows are written: mark caches changed and build the summary"""

import uuid
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.schemas.import_run import TransactionImportResponse
from app.services.cache_state import mark_cache_changed_for_scope, mark_user_cache_changed
from app.services.importers.shared.lookups import ImportLookups
from app.services.importers.shared.stats import ImportStats


async def mark_import_caches_changed(
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


def build_import_summary[Summary: TransactionImportResponse](
    summary_type: type[Summary],
    *,
    transactions_created: int,
    stats: ImportStats,
    import_lookups: ImportLookups,
    first_import_date_by_account_id: dict[uuid.UUID, date],
    **own_fields: object,
) -> Summary:
    """Build the summary a save returns, with the fields only its importer reports added

    Args:
        summary_type: The importer's summary, which extends the one every import returns
        transactions_created: Transactions the save wrote
        stats: Import summary counters updated during the import
        import_lookups: Lookup maps the rows were written from
        first_import_date_by_account_id: Earliest imported transaction date by affected account ID
        **own_fields: The fields the importer's summary adds

    Returns:
        Summary with created, reused, and affected account details
    """
    return summary_type(
        transactions_created=transactions_created,
        accounts_created=stats.accounts_created,
        accounts_reused=stats.accounts_reused,
        categories_created=stats.categories_created,
        categories_reused=stats.categories_reused,
        merchants_created=stats.merchants_created,
        merchants_reused=stats.merchants_reused,
        tags_created=stats.tags_created,
        tags_reused=stats.tags_reused,

        # Sorted so every import lists the same accounts in the same order, whatever order its rows
        # reached them in
        affected_account_ids=sorted(first_import_date_by_account_id, key=str),
        account_source_ids={source: account.id for source, account in import_lookups.accounts_by_source.items()},
        category_source_ids={source: category.id for source, category in import_lookups.categories_by_source.items()},
        created_account_ids=stats.created_account_ids,
        created_category_ids=stats.created_category_ids,
        created_merchant_ids=stats.created_merchant_ids,
        created_tag_ids=stats.created_tag_ids,
        **own_fields,
    )
