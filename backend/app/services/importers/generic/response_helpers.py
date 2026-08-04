"""Transaction import response helpers"""

import uuid
from datetime import date

from app.schemas.transaction import TransactionImportRequest, TransactionImportResponse
from app.services.importers.generic.lookup_helpers import TransactionImportLookups
from app.services.importers.shared.stats import ImportStats


def build_transaction_import_response(
    data: TransactionImportRequest,
    stats: ImportStats,
    import_lookups: TransactionImportLookups,
    first_import_date_by_account_id: dict[uuid.UUID, date],
) -> TransactionImportResponse:
    """Build the API summary returned after importing transactions

    Args:
        data: The whole file, rebuilt from its run
        stats: Import summary counters updated during the import
        import_lookups: Lookup maps used while creating imported transactions
        first_import_date_by_account_id: Earliest imported transaction date by affected account ID

    Returns:
        Import response with created, reused, and affected account details
    """
    account_source_ids = {source: account.id for source, account in import_lookups.accounts_by_source.items()}
    category_source_ids = {source: category.id for source, category in import_lookups.categories_by_source.items()}

    # Sort affected account IDs for deterministic API responses
    affected_account_ids = sorted(first_import_date_by_account_id, key=str)

    transaction_import_response = TransactionImportResponse(
        transactions_created=len(data.rows),
        accounts_created=stats.accounts_created,
        accounts_reused=stats.accounts_reused,
        categories_created=stats.categories_created,
        categories_reused=stats.categories_reused,
        merchants_created=stats.merchants_created,
        merchants_reused=stats.merchants_reused,
        tags_created=stats.tags_created,
        tags_reused=stats.tags_reused,
        affected_account_ids=affected_account_ids,
        account_source_ids=account_source_ids,
        category_source_ids=category_source_ids,
        created_account_ids=stats.created_account_ids,
        created_category_ids=stats.created_category_ids,
        created_merchant_ids=stats.created_merchant_ids,
        created_tag_ids=stats.created_tag_ids,
    )
    return transaction_import_response
