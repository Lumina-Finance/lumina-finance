"""Firefly III transaction import orchestration service"""

import logging
import uuid
from dataclasses import dataclass
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import TransferCounterpartyScope
from app.models.category import Category
from app.models.tag import TransactionTag
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.firefly_import import FireflyTransactionRow
from app.schemas.transaction import TransactionImportAccountMapping, TransactionImportCategoryMapping
from app.services.accounts.snapshots import recompute_account_snapshots
from app.services.cache_state import mark_cache_changed_for_scope, mark_user_cache_changed
from app.services.categories.transfer_rules import does_category_record_counterparty_account
from app.services.importers.firefly.constants import FIREFLY_GENERIC_REFUSAL_REASON
from app.services.importers.firefly.row_resolution import (
    FireflyLeg,
    FireflyResolutionContext,
    FireflyRowRefusedError,
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

logger = logging.getLogger(__name__)


@dataclass
class FireflyWriteResult:
    """What writing a Firefly III export's rows created, before anything is committed"""

    stats: ImportStats
    legs_created: int
    accounts_by_source: dict[str, Account]
    categories_by_source: dict[str, Category]
    first_import_date_by_account_id: dict[uuid.UUID, date]


async def write_firefly_transactions(
    db: AsyncSession,
    user: User,
    accounts: list[TransactionImportAccountMapping],
    categories: list[TransactionImportCategoryMapping],
    rows: list[FireflyTransactionRow],
) -> FireflyWriteResult:
    """Write a Firefly III export's rows and everything they reference, without committing

    Args:
        db: Active database session
        user: Authenticated user running the import
        accounts: Account mappings covering every account source the rows name
        categories: Category mappings covering every category the rows read
        rows: Journal rows in export order

    Returns:
        What the rows created

    Raises:
        HTTPException: Raised with 422 for the first row that cannot be converted, naming the row's
            journal
    """
    stats = ImportStats()

    # Both legs of a Firefly transfer get a row written, so every source here is an account the
    # import writes to and none of them takes the weaker counterparty rule. Staging refuses an
    # outside answer for a Firefly run, so every source resolves to an account
    account_sources = await resolve_import_account_sources(db, user, accounts, stats, set())
    accounts_by_source = account_sources.accounts_by_source
    categories_by_source = await get_or_create_import_categories_by_source(db, user, categories, stats)

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
    legs_by_row = _resolve_rows(rows, context)
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
    return FireflyWriteResult(
        stats=stats,
        legs_created=len(legs),
        accounts_by_source=accounts_by_source,
        categories_by_source=categories_by_source,
        first_import_date_by_account_id=first_import_date_by_account_id,
    )


def _resolve_rows(
    rows: list[FireflyTransactionRow],
    context: FireflyResolutionContext,
) -> list[list[FireflyLeg]]:
    """Resolve payload rows into transaction legs, refusing the first row that cannot convert

    The browser leaves out every row it can tell will not convert, so a row refused here fails the
    whole import rather than being dropped from it

    Args:
        rows: Firefly III journal rows in export order
        context: Lookups needed to resolve rows

    Returns:
        Legs per row

    Raises:
        HTTPException: Raised naming the row's journal, which the browser can find in the file
            whichever rows it left out, with the status of a mapping the row cannot use, or 422 for
            a row that cannot convert
    """
    legs_by_row: list[list[FireflyLeg]] = []

    for row in rows:
        try:
            legs_by_row.append(resolve_firefly_row(row, context))
            continue
        except FireflyRowRefusedError as refusal:
            status_code, reason = status.HTTP_422_UNPROCESSABLE_CONTENT, refusal.reason
        except HTTPException as exc:

            # The frontend must supply a mapping for every source a row names, so one it cannot use
            # keeps the status the mapping check gave it
            status_code, reason = exc.status_code, exc.detail
        except Exception:

            # A row failing in a way no refusal rule anticipated is refused with a generic reason, and
            # the specifics are kept in the server log
            logger.exception("Firefly III journal %s could not be converted", row.journal_id)
            status_code, reason = status.HTTP_422_UNPROCESSABLE_CONTENT, FIREFLY_GENERIC_REFUSAL_REASON

        raise HTTPException(
            status_code=status_code,
            detail=f"Firefly III journal {row.journal_id}: {reason}",
        )
    return legs_by_row


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
