"""Firefly III transaction import orchestration service"""

import logging
import uuid
from datetime import date

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.tag import TransactionTag
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.firefly_import import (
    FireflySkippedRow,
    FireflyTransactionImportRequest,
    FireflyTransactionImportResponse,
    FireflyTransactionRow,
)
from app.services.accounts.snapshots import recompute_snapshots_from
from app.services.cache_state import mark_cache_changed_for_scope, mark_user_cache_changed
from app.services.transactions.imports.firefly.constants import FIREFLY_GENERIC_SKIP_REASON
from app.services.transactions.imports.firefly.row_resolution import (
    FireflyLeg,
    FireflyResolutionContext,
    FireflyRowSkipError,
    resolve_firefly_row,
)
from app.services.transactions.imports.firefly.system_categories import get_firefly_system_categories
from app.services.transactions.imports.shared.accounts import get_or_create_import_accounts_by_source
from app.services.transactions.imports.shared.categories import get_or_create_import_categories_by_source
from app.services.transactions.imports.shared.currencies import get_import_currencies_by_code
from app.services.transactions.imports.shared.merchants import (
    get_or_create_import_merchant,
    get_personal_import_merchants_by_name,
)
from app.services.transactions.imports.shared.stats import ImportStats
from app.services.transactions.imports.shared.tags import (
    get_or_create_import_tags,
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
    accounts_by_source = await get_or_create_import_accounts_by_source(db, user, data.accounts, stats)
    categories_by_source = await get_or_create_import_categories_by_source(db, user, data.categories, stats)

    # Load currencies after account mappings because new accounts can introduce new currency codes
    account_currency_codes = {account.currency for account in accounts_by_source.values()}
    currencies_by_code = await get_import_currencies_by_code(db, account_currency_codes)
    merchants_by_name = await get_personal_import_merchants_by_name(db, user.id)
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
        merchants_by_name=merchants_by_name,
        tags_by_name=tags_by_name,
        stats=stats,
    )

    await db.flush()

    # Recompute each account from its earliest imported date to keep later balances aligned
    for account_id, first_import_date in first_import_date_by_account_id.items():
        await recompute_snapshots_from(db, account_id, first_import_date)
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
    merchants_by_name: dict,
    tags_by_name: dict,
    stats: ImportStats,
) -> dict[uuid.UUID, date]:
    """Insert transaction legs in chunks and return first dates by account

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        legs: Transaction legs resolved from the import payload
        merchants_by_name: Request-local merchant lookup keyed by merchant name
        tags_by_name: Request-local tag lookup keyed by tag name
        stats: Import summary counters updated during the import

    Returns:
        Earliest imported transaction date by affected account ID
    """
    first_import_date_by_account_id: dict[uuid.UUID, date] = {}

    for chunk_start in range(0, len(legs), INSERT_CHUNK_SIZE):
        chunk = legs[chunk_start:chunk_start + INSERT_CHUNK_SIZE]
        pending: list[tuple[Transaction, list]] = []

        for leg in chunk:
            merchant = await get_or_create_import_merchant(
                db,
                user_id,
                leg.merchant_name,
                merchants_by_name,
                stats,
            )
            tags = await get_or_create_import_tags(db, user_id, leg.tag_names, tags_by_name, stats)
            transaction = Transaction(
                created_by_user_id=user_id,
                account_id=leg.account.id,
                dt=leg.dt,
                merchant_id=merchant.id if merchant else None,
                category_id=leg.category.id,
                amount=leg.amount,
                currency=leg.account.currency,
                fx_rate=None,
                notes=leg.notes,
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
