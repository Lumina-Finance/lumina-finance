"""Bulk transaction update service

One request sets shared details across several transactions. Every rule the single-transaction path
enforces is enforced here too, and a set holding one row that refuses the edit is rejected whole, so
a bulk edit can never write a state a single edit would have refused

A field is applied when the request carried it, not when it is non-null, because the note and the
counterparty pair each take null as a real answer meaning clear it
"""
import uuid
from datetime import date

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
from app.services.accounts.snapshots import recompute_snapshots_from
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

# Columns the request writes straight onto every row it covers. The counterparty pair is absent
# because it is written only onto the rows whose resulting category records one
_DIRECT_COLUMN_FIELDS = ("account_id", "dt", "category_id", "merchant_id", "notes")

_COUNTERPARTY_FIELDS = frozenset({"counterparty_account_id", "counterparty_account_scope"})


async def bulk_update_transactions(
    db: AsyncSession,
    user: User,
    data: BulkUpdateTransactionsRequest,
) -> BulkUpdateTransactionsResponse:
    """Apply one set of details across several transactions

    The service loads the requested transactions inside the caller's readable scope, checks write
    access on every account behind them and on any account they move to, refuses the whole set when
    any row breaks a rule the single-transaction path enforces, then applies the change, rebuilds
    the balances the change moved and commits once

    Args:
        db: Active database session
        user: Authenticated user applying the change
        data: Transactions to change and the details to set

    Returns:
        The number of transactions changed and the accounts affected

    Raises:
        HTTPException: A transaction was not found, an account refuses the write, or a row breaks a
            rule the single-transaction path enforces
    """
    sent = data.model_fields_set
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
    source_accounts = await _load_writable_accounts(db, user, {t.account_id for t in transactions})

    target_account = None
    if "account_id" in sent:
        target_account = await _load_move_target(db, user, data.account_id)

    # After a move every row sits in the target account's group, so that is the scope the chosen
    # records have to reach. Without one, each source account's scope still has to be satisfied
    group_ids = (
        {target_account.group_id} if target_account else {account.group_id for account in source_accounts}
    )
    chosen_category = await _validate_chosen_records(db, user, data, sent, group_ids)
    categories_by_id = await _load_current_categories(db, transactions) if chosen_category is None else {}

    await _refuse_rows_breaking_single_edit_rules(
        db, user, data, sent, transactions, chosen_category, categories_by_id, target_account,
    )

    # Collected before the update, because SQLAlchemy writes the new values back onto the loaded
    # rows and a date read afterwards is the new one
    snapshot_starts = _collect_snapshot_starts(data, sent, transactions, target_account)

    await _apply_changes(db, data, sent, transactions, transaction_ids, chosen_category, categories_by_id)

    for account_id, from_date in snapshot_starts.items():
        await recompute_snapshots_from(db, account_id, from_date)

    affected_accounts = [*source_accounts]
    if target_account is not None and target_account.id not in {a.id for a in source_accounts}:
        affected_accounts.append(target_account)

    # One mark per scope rather than one per transaction, since every row in a scope shares it
    for owner_id, group_id in {(account.owner_id, account.group_id) for account in affected_accounts}:
        await mark_cache_changed_for_scope(db, user_id=owner_id, group_id=group_id)

    await db.commit()

    return BulkUpdateTransactionsResponse(
        transactions_updated=len(transaction_ids),
        affected_account_ids=sorted({account.id for account in affected_accounts}),
    )


async def _load_writable_accounts(
    db: AsyncSession,
    user: User,
    account_ids: set[uuid.UUID],
) -> list[Account]:
    """Return the given accounts, refusing any the caller cannot write to

    Row-level security secures ``transactions`` with a check that passes any account permission
    whatever its level, so this application check is the only thing separating read from write

    Args:
        db: Active database session
        user: Authenticated user applying the change
        account_ids: Accounts to check

    Returns:
        One account row per identifier

    Raises:
        HTTPException: An account refuses the write or is archived
    """
    accounts = []
    for account_id in sorted(account_ids):
        account = await check_account_access(db, account_id, user.id, PermissionLevel.WRITE)
        validate_transaction_account_is_not_archived(account)
        accounts.append(account)
    return accounts


async def _load_move_target(db: AsyncSession, user: User, account_id: uuid.UUID) -> Account:
    """Return the account a move sends the transactions to

    Args:
        db: Active database session
        user: Authenticated user applying the change
        account_id: Account the request moves the transactions to

    Returns:
        The target account

    Raises:
        HTTPException: The account refuses the write, is closed, or is archived
    """
    # An account that is closed takes no new history, which is why the move asks for an open one
    account = await check_account_access(db, account_id, user.id, PermissionLevel.WRITE, require_open=True)
    validate_transaction_account_is_not_archived(account)
    return account


async def _validate_chosen_records(
    db: AsyncSession,
    user: User,
    data: BulkUpdateTransactionsRequest,
    sent: set[str],
    group_ids: set[uuid.UUID | None],
) -> Category | None:
    """Confirm the chosen category, merchant and tags reach every group in play

    A selection can span a personal account and a group account, and a record reaching one of them
    does not reach the other, so each scope is checked in its own right

    Args:
        db: Active database session
        user: Authenticated user applying the change
        data: Transactions to change and the details to set
        sent: Names of the fields the request carried
        group_ids: Groups the rows end up in, with None for a personal account

    Returns:
        The chosen category, or None when the request sets no category

    Raises:
        HTTPException: A chosen record does not reach one of the groups
    """
    chosen_category = None
    for group_id in group_ids:
        if "category_id" in sent:
            chosen_category = await validate_transaction_category_access(db, data.category_id, user.id, group_id)
        if "merchant_id" in sent:
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

    Raises:
        HTTPException: A row uses a category the caller cannot read
    """
    category_ids = {transaction.category_id for transaction in transactions}
    result = await db.execute(select(Category).where(Category.id.in_(category_ids)))
    categories_by_id = {category.id: category for category in result.scalars().all()}

    # A row on a shared account can use the personal category of whoever recorded it, which nobody
    # else can read. Refusing says so, where indexing the missing key would answer 500
    missing = category_ids - categories_by_id.keys()
    if missing:
        refused = sum(1 for transaction in transactions if transaction.category_id in missing)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"{refused} of these transactions cannot be changed: "
            f"{refused} using a category you cannot open",
        )

    return categories_by_id


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


def _resulting_counterparty(
    transaction: Transaction,
    data: BulkUpdateTransactionsRequest,
    sent: set[str],
) -> tuple[uuid.UUID | None, object]:
    """Return the counterparty account and scope a transaction ends up with.

    Args:
        transaction: Transaction the request covers
        data: Transactions to change and the details to set
        sent: Names of the fields the request carried

    Returns:
        The resulting counterparty account identifier and scope
    """
    if _COUNTERPARTY_FIELDS & sent:
        return data.counterparty_account_id, data.counterparty_account_scope
    return transaction.counterparty_account_id, transaction.counterparty_account_scope


async def _refuse_rows_breaking_single_edit_rules(
    db: AsyncSession,
    user: User,
    data: BulkUpdateTransactionsRequest,
    sent: set[str],
    transactions: list[Transaction],
    chosen_category: Category | None,
    categories_by_id: dict[uuid.UUID, Category],
    target_account: Account | None,
) -> None:
    """Reject the whole set when any row breaks a rule a single edit of it would break

    Counts are grouped by reason rather than listing identifiers, since a raw list of identifiers
    tells the person reading the message nothing about what to fix

    Args:
        db: Active database session
        user: Authenticated user applying the change
        data: Transactions to change and the details to set
        sent: Names of the fields the request carried
        transactions: Transactions the request covers
        chosen_category: Category the request sets, or None when it sets none
        categories_by_id: Stored categories keyed by identifier, used when the request sets none
        target_account: Account the request moves the transactions to, or None

    Raises:
        HTTPException: At least one row breaks a rule
    """
    without_merchant = []
    unanswered_transfers = []
    counterparty_not_allowed = []
    own_account_counterparty = []
    missing_fx_rate = []
    transfers_by_counterparty: dict[uuid.UUID, list[uuid.UUID]] = {}

    for transaction in transactions:
        # Editing brings a row onto the current rule, so one recorded before a merchant was required
        # has to gain one before any other change to it is accepted
        if "merchant_id" not in sent and transaction.merchant_id is None:
            without_merchant.append(transaction.id)

        # A row keeps its stored rate across a move, and without one it cannot sit in an account of
        # another currency at all
        if (
            target_account is not None
            and transaction.currency != target_account.currency
            and transaction.fx_rate is None
        ):
            missing_fx_rate.append(transaction.id)

        category = _resulting_category(transaction, chosen_category, categories_by_id)
        counterparty_id, counterparty_scope = _resulting_counterparty(transaction, data, sent)
        resulting_account_id = target_account.id if target_account is not None else transaction.account_id

        if not does_category_record_counterparty_account(category):
            if _COUNTERPARTY_FIELDS & sent and data.counterparty_account_id is not None:
                counterparty_not_allowed.append(transaction.id)
            continue

        if counterparty_scope is None:
            unanswered_transfers.append(transaction.id)
        elif counterparty_id is not None:
            if counterparty_id == resulting_account_id:
                own_account_counterparty.append(transaction.id)
            else:
                transfers_by_counterparty.setdefault(counterparty_id, []).append(transaction.id)

    unreachable_counterparties = await _find_unreachable_counterparties(db, user, transfers_by_counterparty)

    reasons = []
    if without_merchant:
        reasons.append(f"{len(without_merchant)} with no merchant recorded")
    if missing_fx_rate:
        reasons.append(f"{len(missing_fx_rate)} in another currency with no exchange rate recorded")
    if unanswered_transfers:
        reasons.append(f"{len(unanswered_transfers)} not recording the other account of a transfer")
    if counterparty_not_allowed:
        reasons.append(f"{len(counterparty_not_allowed)} under a category that records no other account")
    if own_account_counterparty:
        reasons.append(f"{len(own_account_counterparty)} that would record their own account")
    if unreachable_counterparties:
        reasons.append(f"{len(unreachable_counterparties)} recording an account you can no longer open")
    if not reasons:
        return

    refused_count = len({
        *without_merchant,
        *missing_fx_rate,
        *unanswered_transfers,
        *counterparty_not_allowed,
        *own_account_counterparty,
        *unreachable_counterparties,
    })
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail=f"{refused_count} of these transactions cannot be changed: {', '.join(reasons)}",
    )


async def _find_unreachable_counterparties(
    db: AsyncSession,
    user: User,
    transfers_by_counterparty: dict[uuid.UUID, list[uuid.UUID]],
) -> list[uuid.UUID]:
    """Return the transfers recording an account the caller cannot read

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


def _collect_snapshot_starts(
    data: BulkUpdateTransactionsRequest,
    sent: set[str],
    transactions: list[Transaction],
    target_account: Account | None,
) -> dict[uuid.UUID, date]:
    """Return the earliest date each affected account has to be rebuilt from

    Only the account and the date move a balance, so nothing is rebuilt unless one of them is set.
    Every row counts twice, once for where it was and once for where it ends up, so an account
    keeping a row that only changes date still rebuilds from that row's earlier date

    Args:
        data: Transactions to change and the details to set
        sent: Names of the fields the request carried
        transactions: Transactions the request covers
        target_account: Account the request moves the transactions to, or None

    Returns:
        The earliest date to rebuild from, keyed by account
    """
    if "account_id" not in sent and "dt" not in sent:
        return {}

    starts: dict[uuid.UUID, date] = {}
    for transaction in transactions:
        resulting_account_id = target_account.id if target_account is not None else transaction.account_id
        resulting_date = data.dt if "dt" in sent else transaction.dt

        for account_id, from_date in (
            (transaction.account_id, transaction.dt),
            (resulting_account_id, resulting_date),
        ):
            existing = starts.get(account_id)
            if existing is None or from_date < existing:
                starts[account_id] = from_date

    return starts


async def _apply_changes(
    db: AsyncSession,
    data: BulkUpdateTransactionsRequest,
    sent: set[str],
    transactions: list[Transaction],
    transaction_ids: list[uuid.UUID],
    chosen_category: Category | None,
    categories_by_id: dict[uuid.UUID, Category],
) -> None:
    """Write the requested change and normalise what the change invalidates

    Args:
        db: Active database session
        data: Transactions to change and the details to set
        sent: Names of the fields the request carried
        transactions: Transactions the request covers
        transaction_ids: Identifiers of those transactions
        chosen_category: Category the request sets, or None when it sets none
        categories_by_id: Stored categories keyed by identifier, used when the request sets none

    Returns:
        None
    """
    column_values = {field: getattr(data, field) for field in _DIRECT_COLUMN_FIELDS if field in sent}
    if column_values:
        await db.execute(update(Transaction).where(Transaction.id.in_(transaction_ids)).values(**column_values))

    records_counterparty = [
        transaction.id
        for transaction in transactions
        if does_category_record_counterparty_account(
            _resulting_category(transaction, chosen_category, categories_by_id),
        )
    ]

    if _COUNTERPARTY_FIELDS & sent and records_counterparty:
        await db.execute(
            update(Transaction)
            .where(Transaction.id.in_(records_counterparty))
            .values(
                counterparty_account_id=data.counterparty_account_id,
                counterparty_account_scope=data.counterparty_account_scope,
            ),
        )

    # A category that records no counterparty account drops whatever the previous one recorded, on
    # every edit rather than only on one that changes the category, matching the single-transaction
    # path. Picked row by row because the category a row ends up under is its own whenever the
    # request sets none, and clearing the whole set would take the counterparty off every transfer
    clearable_ids = [
        transaction.id
        for transaction in transactions
        if transaction.counterparty_account_scope is not None and transaction.id not in set(records_counterparty)
    ]
    if clearable_ids:
        await db.execute(
            update(Transaction)
            .where(Transaction.id.in_(clearable_ids))
            .values(counterparty_account_id=None, counterparty_account_scope=None),
        )

    if data.add_tag_ids:
        await add_transaction_tag_assignments(db, transaction_ids, list(dict.fromkeys(data.add_tag_ids)))
