"""Journal transaction import orchestration service, shared by the Firefly III and Actual Budget imports"""

import logging
import uuid
from dataclasses import dataclass
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import TransferCounterpartyScope
from app.models.import_run import ImportRunSource
from app.models.user import User
from app.schemas.import_run import JournalTransactionRow, TransactionImportAccountMapping, TransactionImportCategoryMapping
from app.services.accounts.snapshots import recompute_account_snapshots
from app.services.categories.transfer_rules import does_category_record_counterparty_account
from app.services.importers.journal.constants import JOURNAL_GENERIC_REFUSAL_REASON, JOURNAL_ROW_LABELS
from app.services.importers.journal.row_resolution import (
    JournalLeg,
    JournalResolutionContext,
    JournalRowRefusedError,
    resolve_journal_row,
)
from app.services.importers.journal.system_categories import get_journal_system_categories
from app.services.importers.shared.lookups import ImportLookups, load_import_lookups
from app.services.importers.shared.save_results import mark_import_caches_changed
from app.services.importers.shared.stats import ImportStats
from app.services.importers.shared.transaction_writer import ImportedTransaction, write_imported_transactions

logger = logging.getLogger(__name__)


@dataclass
class JournalWriteResult:
    """What writing a journal export's rows created, before anything is committed"""

    stats: ImportStats
    legs_created: int
    import_lookups: ImportLookups
    first_import_date_by_account_id: dict[uuid.UUID, date]


async def write_journal_transactions(
    db: AsyncSession,
    user: User,
    source: ImportRunSource,
    import_run_id: uuid.UUID,
    accounts: list[TransactionImportAccountMapping],
    categories: list[TransactionImportCategoryMapping],
    rows: list[JournalTransactionRow],
) -> JournalWriteResult:
    """Write a journal export's rows and everything they reference, without committing

    Args:
        db: Active database session
        user: Authenticated user running the import
        source: Importer that opened the run, which decides how a refusal names a row
        import_run_id: Run being committed, which every written transaction is stamped with
        accounts: Account mappings covering every account source the rows name
        categories: Category mappings covering every category the rows read
        rows: Journal rows in export order

    Returns:
        What the rows created

    Raises:
        HTTPException: Raised with 422 for the first row that cannot be converted, naming the row
            as the export does
    """
    stats = ImportStats()

    # Both legs of a journal transfer get a row written, so every source here is an account the
    # import writes to and none of them takes the weaker counterparty rule. Staging refuses an
    # outside answer for a journal run, so every source resolves to an account
    import_lookups = await load_import_lookups(db, user, accounts, categories, stats, set())
    transfer_category, balance_adjustment_category = await get_journal_system_categories(db)

    context = JournalResolutionContext(
        user_id=user.id,
        accounts_by_source=import_lookups.accounts_by_source,
        categories_by_source=import_lookups.categories_by_source,
        currencies_by_code=import_lookups.currencies_by_code,
        transfer_category=transfer_category,
        balance_adjustment_category=balance_adjustment_category,
    )
    legs_by_row = _resolve_rows(rows, context, JOURNAL_ROW_LABELS[source])
    legs = [leg for row_legs in legs_by_row for leg in row_legs]

    # The journal flow has no step asking about a payee, so every value keeps what the importer does
    # unasked: matching an existing merchant by name, and creating one where nothing matches
    first_import_date_by_account_id = await write_imported_transactions(
        db,
        user_id=user.id,
        import_run_id=import_run_id,
        transactions=[_to_imported_transaction(leg) for leg in legs],
        merchant_mappings=[],
        import_lookups=import_lookups,
        stats=stats,
    )

    # Recompute every affected account together so concurrent writers use one lock order
    await recompute_account_snapshots(db, first_import_date_by_account_id)
    await mark_import_caches_changed(
        db,
        user.id,
        import_lookups.accounts_by_source,
        first_import_date_by_account_id,
    )
    return JournalWriteResult(
        stats=stats,
        legs_created=len(legs),
        import_lookups=import_lookups,
        first_import_date_by_account_id=first_import_date_by_account_id,
    )


def _resolve_rows(
    rows: list[JournalTransactionRow],
    context: JournalResolutionContext,
    row_label: str,
) -> list[list[JournalLeg]]:
    """Resolve payload rows into transaction legs, refusing the first row that cannot convert

    The browser leaves out every row it can tell will not convert, so a row refused here fails the
    whole import rather than being dropped from it

    Args:
        rows: Journal rows in export order
        context: Lookups needed to resolve rows
        row_label: What the export calls a row, which a refusal names it by

    Returns:
        Legs per row

    Raises:
        HTTPException: Raised naming the row by its journal id, which the browser can find in the file
            whichever rows it left out, with the status of a mapping the row cannot use, or 422 for
            a row that cannot convert
    """
    legs_by_row: list[list[JournalLeg]] = []

    for row in rows:
        try:
            legs_by_row.append(resolve_journal_row(row, context))
            continue
        except JournalRowRefusedError as refusal:
            status_code, reason = status.HTTP_422_UNPROCESSABLE_CONTENT, refusal.reason
        except HTTPException as exc:

            # The frontend must supply a mapping for every source a row names, so one it cannot use
            # keeps the status the mapping check gave it
            status_code, reason = exc.status_code, exc.detail
        except Exception:

            # A row failing in a way no refusal rule anticipated is refused with a generic reason, and
            # the specifics are kept in the server log
            logger.exception("%s %s could not be converted", row_label, row.journal_id)
            status_code, reason = status.HTTP_422_UNPROCESSABLE_CONTENT, JOURNAL_GENERIC_REFUSAL_REASON

        raise HTTPException(
            status_code=status_code,
            detail=f"{row_label} {row.journal_id}: {reason}",
        )
    return legs_by_row


def _to_imported_transaction(leg: JournalLeg) -> ImportedTransaction:
    """Return the transaction one leg writes

    Args:
        leg: Transaction leg resolved from the import payload

    Returns:
        The leg as the shared writer takes it
    """
    return ImportedTransaction(
        account=leg.account,
        dt=leg.dt,
        amount=leg.amount,
        category=leg.category,
        merchant_name=leg.merchant_name,
        notes=leg.notes,
        tag_names=leg.tag_names,
        counterparty_account_id=leg.counterparty_account.id if leg.counterparty_account else None,
        counterparty_account_scope=_get_leg_counterparty_scope(leg),
    )


def _get_leg_counterparty_scope(leg: JournalLeg) -> TransferCounterpartyScope | None:
    """Return what a leg records about where its money went

    A pair states both ends, so each leg points at the other. Every other leg of a category that
    records a counterparty account had no second endpoint in the export, which is what money
    leaving the tracked accounts means

    Args:
        leg: Transaction leg resolved from the import payload

    Returns:
        Scope for the leg, or None for a category that records neither
    """
    if leg.counterparty_account is not None:
        return TransferCounterpartyScope.TRACKED
    if does_category_record_counterparty_account(leg.category):
        return TransferCounterpartyScope.OUTSIDE
    return None
