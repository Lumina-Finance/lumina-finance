"""Firefly III transaction import orchestration service"""

import logging
import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import TransferCounterpartyScope
from app.models.tag import TransactionTag
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.firefly_import import (
    FireflySkippedRow,
    FireflyTransactionImportRequest,
    FireflyTransactionImportResponse,
    FireflyTransactionRow,
)
from app.services.accounts.snapshots import recompute_account_snapshots
from app.services.cache_state import mark_cache_changed_for_scope, mark_user_cache_changed
from app.services.categories.transfer_rules import does_category_record_counterparty_account
from app.services.importers.firefly.constants import FIREFLY_GENERIC_SKIP_REASON
from app.services.importers.firefly.row_resolution import (
    FireflyLeg,
    FireflyResolutionContext,
    FireflyRowSkipError,
    resolve_firefly_row,
)
from app.services.importers.firefly.system_categories import get_firefly_system_categories
from app.services.importers.shared.accounts import resolve_import_account_sources
from app.services.importers.shared.categories import get_or_create_import_categories_by_source
from app.services.importers.shared.currencies import get_import_currencies_by_code
from app.services.importers.shared.merchants import (
    ImportMerchants,
    create_missing_import_merchants,
    get_import_merchant,
    get_no_payee_merchants,
    load_import_merchants,
)
from app.services.importers.shared.stats import ImportStats
from app.services.importers.shared.tags import (
    create_missing_import_tags,
    get_import_row_tags,
    get_personal_import_tags_by_name,
)

# Transactions inserted per flush so imports of tens of thousands of rows use
# batched INSERTs instead of one round trip per row
INSERT_CHUNK_SIZE = 1000

# Skipped-row details returned to the client, the full count is always exact
SKIPPED_DETAIL_LIMIT = 50

logger = logging.getLogger(__name__)


async def import_firefly_transactions(
    db: AsyncSession,
    user: User,
    data: FireflyTransactionImportRequest,
) -> FireflyTransactionImportResponse:
    """Create transactions from a frontend-compiled Firefly III export payload

    Args:
        db: Active database session
        user: Authenticated user running the import
        data: Prepared Firefly III import payload from the frontend compiler

    Returns:
        Import summary with converted, skipped, and created record counts
    """
    stats = ImportStats()
    # Both legs of a Firefly transfer get a row written, so every source here is an account the
    # import writes to and none of them takes the weaker counterparty rule
    account_sources = await resolve_import_account_sources(db, user, data.accounts, stats, set())

    # Every Firefly source is an endpoint rows are written to, and the export states both sides of a
    # transfer itself, so there is nothing here an outside answer could describe
    if account_sources.outside_sources:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Account source cannot be outside the tracked accounts: {sorted(account_sources.outside_sources)[0]}",
        )

    accounts_by_source = account_sources.accounts_by_source
    categories_by_source = await get_or_create_import_categories_by_source(db, user, data.categories, stats)

    # Load currencies after account mappings because new accounts can introduce new currency codes
    account_currency_codes = {account.currency for account in accounts_by_source.values()}
    currencies_by_code = await get_import_currencies_by_code(db, account_currency_codes)
    merchants = await load_import_merchants(db, user.id)
    tags_by_name = await get_personal_import_tags_by_name(db, user.id)
    transfer_category, balance_adjustment_category = await get_firefly_system_categories(db)

    context = FireflyResolutionContext(
        user_id=user.id,
        accounts_by_source=accounts_by_source,
        categories_by_source=categories_by_source,
        currencies_by_code=currencies_by_code,
        transfer_category=transfer_category,
        balance_adjustment_category=balance_adjustment_category,
    )
    legs_by_row, skipped = _resolve_rows(data.rows, context)
    legs = [leg for row_legs in legs_by_row for leg in row_legs]

    first_import_date_by_account_id = await _write_legs(
        db,
        user_id=user.id,
        legs=legs,
        merchants=merchants,
        tags_by_name=tags_by_name,
        stats=stats,
    )

    await db.flush()

    # Recompute every affected account together so concurrent writers use one lock order
    await recompute_account_snapshots(db, first_import_date_by_account_id)
    await _mark_caches_changed_for_imported_accounts(
        db,
        user.id,
        accounts_by_source,
        first_import_date_by_account_id,
    )
    await db.commit()

    return _build_response(
        data=data,
        stats=stats,
        skipped=skipped,
        legs_created=len(legs),
        accounts_by_source=accounts_by_source,
        categories_by_source=categories_by_source,
        first_import_date_by_account_id=first_import_date_by_account_id,
    )


def _resolve_rows(
    rows: list[FireflyTransactionRow],
    context: FireflyResolutionContext,
) -> tuple[list[list[FireflyLeg]], list[FireflySkippedRow]]:
    """Resolve payload rows into transaction legs and skipped-row records

    Args:
        rows: Firefly III journal rows from the import payload
        context: Lookups needed to resolve rows

    Returns:
        Legs per converted row and records for rows that could not convert
    """
    legs_by_row: list[list[FireflyLeg]] = []
    skipped: list[FireflySkippedRow] = []

    for row in rows:
        try:
            legs_by_row.append(resolve_firefly_row(row, context))
        except FireflyRowSkipError as skip:
            skipped.append(FireflySkippedRow(journal_id=row.journal_id, reason=skip.reason))
        except HTTPException:

            # Mapping-contract violations still fail the whole batch because
            # the frontend must supply a mapping for every tracked account
            raise
        except Exception:

            # A row failing in a way no skip rule anticipated must not sink
            # the rest of the batch, so it is skipped with a generic reason
            # and the specifics are kept in the server log
            logger.exception("Firefly III journal %s could not be converted", row.journal_id)
            skipped.append(FireflySkippedRow(journal_id=row.journal_id, reason=FIREFLY_GENERIC_SKIP_REASON))
    return legs_by_row, skipped


async def _write_legs(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    legs: list[FireflyLeg],
    merchants: ImportMerchants,
    tags_by_name: dict,
    stats: ImportStats,
) -> dict[uuid.UUID, date]:
    """Insert transaction legs in chunks and return first dates by account

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        legs: Transaction legs resolved from the import payload
        merchants: Request-local merchant lookup holding what each payee value resolves to
        tags_by_name: Request-local tag lookup keyed by tag name
        stats: Import summary counters updated during the import

    Returns:
        Earliest imported transaction date by affected account ID
    """
    first_import_date_by_account_id: dict[uuid.UUID, date] = {}
    no_payee_merchants = get_no_payee_merchants(merchants)

    # Every merchant and tag the export introduces is created before the legs are walked, so each
    # costs one insert for the whole export rather than one per leg that first mentions it
    # The Firefly flow has no step asking about a payee, so every value keeps what the importer
    # does unasked: matching an existing merchant by name, and creating one where nothing matches
    await create_missing_import_merchants(db, user_id, (leg.merchant_name for leg in legs), [], merchants, stats)
    await create_missing_import_tags(
        db,
        user_id,
        (tag_name for leg in legs for tag_name in leg.tag_names),
        tags_by_name,
        stats,
    )

    for chunk_start in range(0, len(legs), INSERT_CHUNK_SIZE):
        chunk = legs[chunk_start:chunk_start + INSERT_CHUNK_SIZE]
        pending: list[tuple[Transaction, list]] = []

        for leg in chunk:
            # Every transaction carries a merchant, and a transfer leg or a balance adjustment has
            # no payee of its own, so the shared merchant for its kind stands in
            merchant = (
                get_import_merchant(leg.merchant_name, merchants, stats)
                or no_payee_merchants.get_for_category(leg.category)
            )
            tags = get_import_row_tags(leg.tag_names, tags_by_name, stats)
            transaction = Transaction(
                created_by_user_id=user_id,
                account_id=leg.account.id,
                dt=leg.dt,
                merchant_id=merchant.id,
                category_id=leg.category.id,
                amount=leg.amount,
                currency=leg.account.currency,
                fx_rate=None,
                notes=leg.notes,
                counterparty_account_id=leg.counterparty_account.id if leg.counterparty_account else None,
                counterparty_account_scope=_get_leg_counterparty_scope(leg),
            )
            pending.append((transaction, tags))

            current_first = first_import_date_by_account_id.get(leg.account.id)
            first_import_date_by_account_id[leg.account.id] = (
                leg.dt if current_first is None else min(current_first, leg.dt)
            )

        # One flush per chunk assigns ids to the whole batch so tag links can
        # be added without a round trip per transaction
        db.add_all([transaction for transaction, _ in pending])
        await db.flush()
        for transaction, tags in pending:
            for tag in tags:
                db.add(TransactionTag(transaction_id=transaction.id, tag_id=tag.id))

    return first_import_date_by_account_id


def _get_leg_counterparty_scope(leg: FireflyLeg) -> TransferCounterpartyScope | None:
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
    """
    await mark_user_cache_changed(db, user_id)
    affected_accounts = {account.id: account for account in accounts_by_source.values()}

    # Mark each affected account scope so personal and group cache entries refresh
    for account_id in first_import_date_by_account_id:
        account = affected_accounts[account_id]
        await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)


def _build_response(
    *,
    data: FireflyTransactionImportRequest,
    stats: ImportStats,
    skipped: list[FireflySkippedRow],
    legs_created: int,
    accounts_by_source: dict,
    categories_by_source: dict,
    first_import_date_by_account_id: dict[uuid.UUID, date],
) -> FireflyTransactionImportResponse:
    """Build the import summary response

    Args:
        data: Prepared Firefly III import payload from the frontend compiler
        stats: Import summary counters collected during the import
        skipped: Records for rows that could not convert
        legs_created: Number of Lumina transactions created
        accounts_by_source: Account rows keyed by import source
        categories_by_source: Category rows keyed by import source
        first_import_date_by_account_id: Earliest imported transaction date by affected account ID

    Returns:
        Import summary response
    """
    return FireflyTransactionImportResponse(
        rows_imported=len(data.rows) - len(skipped),
        rows_skipped=len(skipped),
        skipped=skipped[:SKIPPED_DETAIL_LIMIT],
        transactions_created=legs_created,
        accounts_created=stats.accounts_created,
        accounts_reused=stats.accounts_reused,
        categories_created=stats.categories_created,
        categories_reused=stats.categories_reused,
        merchants_created=stats.merchants_created,
        merchants_reused=stats.merchants_reused,
        tags_created=stats.tags_created,
        tags_reused=stats.tags_reused,
        affected_account_ids=list(first_import_date_by_account_id.keys()),
        account_source_ids={source: account.id for source, account in accounts_by_source.items()},
        category_source_ids={source: category.id for source, category in categories_by_source.items()},
        created_account_ids=stats.created_account_ids,
        created_category_ids=stats.created_category_ids,
        created_merchant_ids=stats.created_merchant_ids,
        created_tag_ids=stats.created_tag_ids,
    )
