"""CSV import row to transaction resolution"""

import uuid

from fastapi import HTTPException, status

from app.schemas.import_run import TransactionImportRow
from app.services.importers.generic.amounts import parse_import_amount_to_minor_units
from app.services.importers.shared.lookups import ImportLookups
from app.services.importers.shared.row_mappings import (
    get_import_row_account,
    get_import_row_category,
    get_import_row_counterparty_account,
    validate_import_category_can_be_used_for_account,
)
from app.services.importers.shared.transaction_writer import ImportedTransaction
from app.services.importers.shared.validation_helpers import strip_import_text_or_raise


def resolve_import_rows(
    rows: list[TransactionImportRow],
    import_lookups: ImportLookups,
    user_id: uuid.UUID,
) -> list[ImportedTransaction]:
    """Resolve every frontend-compiled row to the transaction it writes, refusing the first that cannot

    Every row is resolved before any transaction, merchant or tag is written, so a row refused here
    writes none of them

    Args:
        rows: Prepared transaction rows from the import payload, in file order
        import_lookups: Lookup maps the rows resolve against
        user_id: Identifier for the user running the import

    Returns:
        The resolved rows in file order

    Raises:
        HTTPException: Raised with 422 when a row cannot be written as the payload states it
    """
    return [_resolve_import_row(row, import_lookups, user_id) for row in rows]


def _resolve_import_row(row: TransactionImportRow, import_lookups: ImportLookups, user_id: uuid.UUID) -> ImportedTransaction:
    """Resolve one row to its account, category, counterparty and amount

    Args:
        row: Import row being resolved
        import_lookups: Lookup maps the row resolves against
        user_id: Identifier for the user running the import

    Returns:
        The resolved row

    Raises:
        HTTPException: Raised with 422 when the row is written to a source answered as outside, names
            a source or category it cannot use, or carries an amount the account currency cannot hold
    """
    account_source = strip_import_text_or_raise(row.account_source, "Account source")
    if account_source in import_lookups.outside_account_sources:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Map to one of your accounts: {account_source} has rows of its own, "
                "so it cannot be answered as outside."
            ),
        )

    account = get_import_row_account(import_lookups.accounts_by_source, row.account_source)
    category = get_import_row_category(import_lookups.categories_by_source, row.category_source)
    validate_import_category_can_be_used_for_account(category, account, user_id)
    counterparty_account_id, counterparty_account_scope = get_import_row_counterparty_account(
        import_lookups.accounts_by_source,
        import_lookups.outside_account_sources,
        row.counterparty_account_source,
        category,
        account,
    )

    currency = import_lookups.currencies_by_code[account.currency]
    return ImportedTransaction(
        account=account,
        dt=row.dt,
        amount=parse_import_amount_to_minor_units(row.amount, currency),
        category=category,
        merchant_name=row.merchant_name,
        notes=row.notes,
        tag_names=row.tag_names,
        counterparty_account_id=counterparty_account_id,
        counterparty_account_scope=counterparty_account_scope,
    )
