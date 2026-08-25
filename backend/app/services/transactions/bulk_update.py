"""Bulk transaction update service

One request sets a category, a merchant or extra tags across several transactions. Every rule the
single-transaction path enforces is enforced here too, and a set holding one row that refuses the
edit is rejected whole, so a bulk edit can never write a state a single edit would have refused
"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import PermissionLevel
from app.models.category import Category
from app.models.transaction import Transaction
from app.models.user import User
from app.permissions import check_account_access
from app.schemas.transaction import BulkUpdateTransactionsRequest, BulkUpdateTransactionsResponse
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.categories.transfer_rules import does_category_record_counterparty_account
from app.services.transactions.access_helpers import accessible_account_ids_subquery
from app.services.transactions.accounts import validate_transaction_account_is_not_archived
from app.services.transactions.tags import add_transaction_tag_assignments
from app.services.transactions.validation import (
    get_valid_transaction_tag_ids,
    validate_transaction_category_access,
    validate_transaction_merchant_access,
)


async def bulk_update_transactions(
    db: AsyncSession,
    user: User,
    data: BulkUpdateTransactionsRequest,
) -> BulkUpdateTransactionsResponse:
    """Apply one category, merchant or tag change across several transactions

    The service loads the requested transactions inside the caller's readable scope, checks write
    access on every account behind them, refuses the whole set when any row breaks a rule the
    single-transaction path enforces, then applies the change and commits once

    Args:
        db: Active database session
        user: Authenticated user applying the change
        data: Transactions to change and the fields to set

    Returns:
        The number of transactions changed and the accounts they belong to

    Raises:
        HTTPException: A transaction was not found, an account refuses the write, or a row breaks a
            rule the single-transaction path enforces
    """
    requested_ids = list(dict.fromkeys(data.transaction_ids))

    # Load the requested rows inside the caller's readable scope, so an id belonging to someone else
    # is missing from the result rather than silently changing nothing
    result = await db.execute(
        select(Transaction).where(
            Transaction.id.in_(requested_ids),
            Transaction.account_id.in_(accessible_account_ids_subquery(user.id)),
        ),
    )
    transactions = list(result.scalars().all())
    if len(transactions) != len(requested_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{len(requested_ids) - len(transactions)} of {len(requested_ids)} transactions were not found",
        )

    transaction_ids = [transaction.id for transaction in transactions]
    accounts = await _load_writable_accounts(db, user, transactions)
    group_ids = {account.group_id for account in accounts}

    chosen_category = await _validate_chosen_records(db, user, data, group_ids)
    categories_by_id = await _load_current_categories(db, transactions) if chosen_category is None else {}

    await _refuse_rows_breaking_single_edit_rules(db, user, data, transactions, chosen_category, categories_by_id)

    await _apply_changes(db, data, transactions, transaction_ids, chosen_category, categories_by_id)

    # One mark per scope rather than one per transaction, since every row in a scope shares it
    for owner_id, group_id in {(account.owner_id, account.group_id) for account in accounts}:
        await mark_cache_changed_for_scope(db, user_id=owner_id, group_id=group_id)

    await db.commit()

    return BulkUpdateTransactionsResponse(
        transactions_updated=len(transaction_ids),
        affected_account_ids=sorted({account.id for account in accounts}),
    )


async def _load_writable_accounts(
    db: AsyncSession,
    user: User,
    transactions: list[Transaction],
) -> list[Account]:
    """Return the accounts behind a set of transactions, refusing any the caller cannot write to

    Row-level security secures ``transactions`` with a check that passes any account permission
    whatever its level, so this application check is the only thing separating read from write

    Args:
        db: Active database session
        user: Authenticated user applying the change
        transactions: Transactions the request covers

    Returns:
        One account row per distinct account behind the transactions

    Raises:
        HTTPException: An account refuses the write or is archived
    """
    accounts = []
    for account_id in sorted({transaction.account_id for transaction in transactions}):
        account = await check_account_access(db, account_id, user.id, PermissionLevel.WRITE)
        validate_transaction_account_is_not_archived(account)
        accounts.append(account)
    return accounts


async def _validate_chosen_records(
    db: AsyncSession,
    user: User,
    data: BulkUpdateTransactionsRequest,
    group_ids: set[uuid.UUID | None],
) -> Category | None:
    """Confirm the chosen category, merchant and tags reach every group in the set

    A selection can span a personal account and a group account, and a record reaching one of them
    does not reach the other, so each scope is checked in its own right

    Args:
        db: Active database session
        user: Authenticated user applying the change
        data: Transactions to change and the fields to set
        group_ids: Distinct groups behind the accounts in the set, with None for personal accounts

    Returns:
        The chosen category, or None when the request sets no category

    Raises:
        HTTPException: A chosen record does not reach one of the groups
    """
    chosen_category = None
    for group_id in group_ids:
        if data.category_id is not None:
            chosen_category = await validate_transaction_category_access(db, data.category_id, user.id, group_id)
        if data.merchant_id is not None:
            await validate_transaction_merchant_access(db, data.merchant_id, user.id, group_id)
        if data.add_tag_ids:
            await get_valid_transaction_tag_ids(db, user.id, data.add_tag_ids, group_id)
    return chosen_category


async def _load_current_categories(
    db: AsyncSession,
    transactions: list[Transaction],
) -> dict[uuid.UUID, Category]:
    """Return the categories the transactions already use, keyed by identifier

    The counterparty rules read the category a row ends up with, which is its stored one whenever
    the request sets no category

    Args:
        db: Active database session
        transactions: Transactions the request covers

    Returns:
        Category rows keyed by identifier
    """
    category_ids = {transaction.category_id for transaction in transactions}
    result = await db.execute(select(Category).where(Category.id.in_(category_ids)))
    return {category.id: category for category in result.scalars().all()}


def _resulting_category(
    transaction: Transaction,
    chosen_category: Category | None,
    categories_by_id: dict[uuid.UUID, Category],
) -> Category:
    """Return the category a transaction ends up under once the request is applied.

    Args:
        transaction: Transaction the request covers
        chosen_category: Category the request sets, or None when it sets none
        categories_by_id: Stored categories keyed by identifier, used when the request sets none

    Returns:
        The category the transaction ends up under
    """
    return chosen_category if chosen_category is not None else categories_by_id[transaction.category_id]


async def _refuse_rows_breaking_single_edit_rules(
    db: AsyncSession,
    user: User,
    data: BulkUpdateTransactionsRequest,
    transactions: list[Transaction],
    chosen_category: Category | None,
    categories_by_id: dict[uuid.UUID, Category],
) -> None:
    """Reject the whole set when any row breaks a rule a single edit of it would break

    Counts are grouped by reason rather than listing identifiers, since a raw list of identifiers
    tells the person reading the message nothing about what to fix

    Args:
        db: Active database session
        user: Authenticated user applying the change
        data: Transactions to change and the fields to set
        transactions: Transactions the request covers
        chosen_category: Category the request sets, or None when it sets none
        categories_by_id: Stored categories keyed by identifier, used when the request sets none

    Raises:
        HTTPException: At least one row breaks a rule
    """
    without_merchant = []
    unanswered_transfers = []
    transfers_by_counterparty: dict[uuid.UUID, list[uuid.UUID]] = {}

    for transaction in transactions:
        # Editing brings a row onto the current rule, so one recorded before a merchant was required
        # has to gain one before any other change to it is accepted
        if data.merchant_id is None and transaction.merchant_id is None:
            without_merchant.append(transaction.id)

        category = _resulting_category(transaction, chosen_category, categories_by_id)
        if not does_category_record_counterparty_account(category):
            continue
        if transaction.counterparty_account_scope is None:
            unanswered_transfers.append(transaction.id)
        elif transaction.counterparty_account_id is not None:
            transfers_by_counterparty.setdefault(transaction.counterparty_account_id, []).append(transaction.id)

    unreachable_counterparties = await _find_unreachable_counterparties(db, user, transfers_by_counterparty)

    reasons = []
    if without_merchant:
        reasons.append(f"{len(without_merchant)} with no merchant recorded")
    if unanswered_transfers:
        reasons.append(f"{len(unanswered_transfers)} not recording the other account of a transfer")
    if unreachable_counterparties:
        reasons.append(f"{len(unreachable_counterparties)} recording an account you can no longer open")
    if not reasons:
        return

    refused_count = len({*without_merchant, *unanswered_transfers, *unreachable_counterparties})
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail=f"{refused_count} of these transactions cannot be changed: {', '.join(reasons)}",
    )


async def _find_unreachable_counterparties(
    db: AsyncSession,
    user: User,
    transfers_by_counterparty: dict[uuid.UUID, list[uuid.UUID]],
) -> list[uuid.UUID]:
    """Return the transfers recording an account the caller can no longer read

    The single-transaction path re-checks this on every edit, at the end of its counterparty
    validation, so a bulk edit that skipped it would accept a row a single edit of the same row
    refuses. One query covers the distinct accounts rather than one per transaction

    Args:
        db: Active database session
        user: Authenticated user applying the change
        transfers_by_counterparty: Transaction identifiers grouped by the account they record

    Returns:
        Identifiers of the transactions whose recorded account is out of reach
    """
    if not transfers_by_counterparty:
        return []

    result = await db.execute(
        select(Account.id).where(
            Account.id.in_(transfers_by_counterparty),
            Account.id.in_(accessible_account_ids_subquery(user.id)),
        ),
    )
    reachable_account_ids = set(result.scalars().all())
    return [
        transaction_id
        for account_id, transaction_ids in transfers_by_counterparty.items()
        if account_id not in reachable_account_ids
        for transaction_id in transaction_ids
    ]


async def _apply_changes(
    db: AsyncSession,
    data: BulkUpdateTransactionsRequest,
    transactions: list[Transaction],
    transaction_ids: list[uuid.UUID],
    chosen_category: Category | None,
    categories_by_id: dict[uuid.UUID, Category],
) -> None:
    """Write the requested change and normalise what the change invalidates

    Args:
        db: Active database session
        data: Transactions to change and the fields to set
        transactions: Transactions the request covers
        transaction_ids: Identifiers of those transactions
        chosen_category: Category the request sets, or None when it sets none
        categories_by_id: Stored categories keyed by identifier, used when the request sets none

    Returns:
        None
    """
    column_values = {}
    if data.category_id is not None:
        column_values["category_id"] = data.category_id
    if data.merchant_id is not None:
        column_values["merchant_id"] = data.merchant_id
    if column_values:
        await db.execute(update(Transaction).where(Transaction.id.in_(transaction_ids)).values(**column_values))

    # A category that records no counterparty account drops whatever the previous one recorded, on
    # every edit rather than only on one that changes the category, matching the single-transaction
    # path. The rows are picked one by one because the category a row ends up under is its own
    # whenever the request sets none, and clearing the whole set would take the counterparty off
    # every transfer in it
    clearable_ids = [
        transaction.id
        for transaction in transactions
        if transaction.counterparty_account_scope is not None
        and not does_category_record_counterparty_account(
            _resulting_category(transaction, chosen_category, categories_by_id),
        )
    ]
    if clearable_ids:
        await db.execute(
            update(Transaction)
            .where(Transaction.id.in_(clearable_ids))
            .values(counterparty_account_id=None, counterparty_account_scope=None),
        )

    if data.add_tag_ids:
        await add_transaction_tag_assignments(db, transaction_ids, list(dict.fromkeys(data.add_tag_ids)))
