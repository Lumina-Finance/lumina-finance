"""Bulk transaction update service

One request sets shared details across several transactions. Every rule the single-transaction path
enforces is enforced here too, and a set holding one row that refuses the edit is rejected whole, so
a bulk edit can never write a state a single edit would have refused. The one divergence is a
transfer end sent over a row whose resulting category records no far side: the single path refuses a
far-side answer under such a category, and this path skips the end on that row instead

A field is applied when the request carried it, not when it is non-null, because the note takes null
as a real answer meaning clear it
"""
import uuid
from datetime import date
from typing import NamedTuple

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import PermissionLevel, TransferCounterpartyScope
from app.models.category import Category
from app.models.transaction import Transaction
from app.models.user import User
from app.permissions import check_account_access
from app.schemas.transaction import (
    BulkDirectionChange,
    BulkUpdateTransactionsRequest,
    BulkUpdateTransactionsResponse,
    TransferEnd,
)
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

# The own and far ends resolved for one row, either one None where that side is left alone
_TransferEndPair = tuple[TransferEnd | None, TransferEnd | None]


class _RowResolution(NamedTuple):
    """What one transaction ends up with once the request is applied."""

    category: Category
    account_id: uuid.UUID
    ends: _TransferEndPair | None


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
        HTTPException: A transaction was not found, an account refuses the write, a transfer end
            reached no row, or a row breaks a rule the single-transaction path enforces
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
    source_accounts_by_id = {account.id: account for account in source_accounts}

    target_account = None
    if "account_id" in sent:
        target_account = await _load_move_target(db, user, data.account_id)

    # Loaded by identifier alone, ahead of the scope check below, since which rows resolve a
    # transfer end at all turns on whether their resulting category records a far side
    chosen_category = await _load_chosen_category(db, data, sent)
    categories_by_id = await _load_current_categories(db, transactions) if chosen_category is None else {}

    if target_account is not None:
        group_ids: set[uuid.UUID | None] = {target_account.group_id}
        own_end_accounts: dict[uuid.UUID, Account] = {}
    else:
        own_end_accounts = await _load_own_end_accounts(
            db, user, transactions, data, chosen_category, categories_by_id,
        )
        group_ids = set()
        for transaction in transactions:
            own_account = _candidate_own_account(
                transaction, data, chosen_category, categories_by_id, own_end_accounts,
            )
            group_ids.add(
                own_account.group_id if own_account is not None
                else source_accounts_by_id[transaction.account_id].group_id,
            )
    await _validate_chosen_scope(db, user, data, sent, group_ids)

    resolutions = _resolve_rows(transactions, data, chosen_category, categories_by_id, target_account)
    _refuse_ends_reaching_no_row(data, resolutions)

    accounts_by_id = {**source_accounts_by_id, **own_end_accounts}
    if target_account is not None:
        accounts_by_id[target_account.id] = target_account
    await _refuse_rows_breaking_single_edit_rules(db, user, data, transactions, resolutions, accounts_by_id)

    # Collected before the update, because SQLAlchemy writes the new values back onto the loaded
    # rows and a date read afterwards is the new one
    snapshot_starts = _collect_snapshot_starts(data, sent, transactions, resolutions)

    await _apply_changes(db, data, sent, transactions, transaction_ids, resolutions)

    for account_id, from_date in snapshot_starts.items():
        await recompute_snapshots_from(db, account_id, from_date)

    affected_accounts = [*source_accounts]
    seen_account_ids = {account.id for account in source_accounts}
    for account in (*own_end_accounts.values(), *([target_account] if target_account is not None else [])):
        if account.id not in seen_account_ids:
            affected_accounts.append(account)
            seen_account_ids.add(account.id)

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
    """Return the account a move or a tracked transfer end sends the transactions to

    Args:
        db: Active database session
        user: Authenticated user applying the change
        account_id: Account identifier the transactions end up in

    Returns:
        The target account

    Raises:
        HTTPException: The account refuses the write, is closed, or is archived
    """
    # An account that is closed takes no new history, which is why a move asks for an open one
    account = await check_account_access(db, account_id, user.id, PermissionLevel.WRITE, require_open=True)
    validate_transaction_account_is_not_archived(account)
    return account


def _own_direction(transaction: Transaction) -> BulkDirectionChange:
    """Return the direction a transaction points on its own, before any request override

    Args:
        transaction: Transaction the request covers

    Returns:
        DEBIT for a negative amount, CREDIT otherwise
    """
    return BulkDirectionChange.DEBIT if transaction.amount < 0 else BulkDirectionChange.CREDIT


def _resulting_direction(transaction: Transaction, data: BulkUpdateTransactionsRequest) -> BulkDirectionChange:
    """Return the direction a transaction ends up pointing once the request is applied

    A set direction overrides the row's own outright, and reverse flips it instead of naming an
    absolute answer. Neither changes what the row's own direction was, which is what a concurrent
    change to the stored amount would disturb

    Args:
        transaction: Transaction the request covers
        data: Transactions to change and the details to set

    Returns:
        DEBIT for a row that ends up negative, CREDIT for one that ends up positive
    """
    own = _own_direction(transaction)
    if data.direction == BulkDirectionChange.REVERSE:
        return BulkDirectionChange.CREDIT if own == BulkDirectionChange.DEBIT else BulkDirectionChange.DEBIT
    if data.direction is not None:
        return data.direction
    return own


def _own_end(data: BulkUpdateTransactionsRequest, resulting_direction: BulkDirectionChange) -> TransferEnd | None:
    """Return the end that is a row's own, given the direction it resolves to

    Money out puts the row's own account at From, and money in puts it at To

    Args:
        data: Transactions to change and the details to set
        resulting_direction: Direction the transaction ends up pointing

    Returns:
        The end the request set for that side, or None when it left it unset
    """
    return data.transfer_from if resulting_direction == BulkDirectionChange.DEBIT else data.transfer_to


def _row_records_far_side(
    transaction: Transaction,
    chosen_category: Category | None,
    categories_by_id: dict[uuid.UUID, Category],
) -> bool:
    """Return whether a row's resulting category records a far side at all

    Args:
        transaction: Transaction the request covers
        chosen_category: Category the request sets, or None when it sets none
        categories_by_id: Stored categories keyed by identifier, used when the request sets none

    Returns:
        True when the row's resulting category records a far side
    """
    return does_category_record_counterparty_account(
        _resulting_category(transaction, chosen_category, categories_by_id),
    )


async def _load_own_end_accounts(
    db: AsyncSession,
    user: User,
    transactions: list[Transaction],
    data: BulkUpdateTransactionsRequest,
    chosen_category: Category | None,
    categories_by_id: dict[uuid.UUID, Category],
) -> dict[uuid.UUID, Account]:
    """Return the accounts a tracked transfer end may move a row into, refusing any the caller cannot write to

    Loaded from whichever of From and To resolves as each row's own end, and only for the rows whose
    resulting category records a far side, since a row that resolves no end reaches for no account at
    all. At most two accounts are ever candidates, since From and To are each a single value for the
    whole request

    Args:
        db: Active database session
        user: Authenticated user applying the change
        transactions: Transactions the request covers
        data: Transactions to change and the details to set
        chosen_category: Category the request sets, or None when it sets none
        categories_by_id: Stored categories keyed by identifier, used when the request sets none

    Returns:
        The target accounts keyed by identifier

    Raises:
        HTTPException: An account refuses the write, is closed, or is archived
    """
    candidate_ids: set[uuid.UUID] = set()
    for transaction in transactions:
        if not _row_records_far_side(transaction, chosen_category, categories_by_id):
            continue
        own_end = _own_end(data, _resulting_direction(transaction, data))
        if own_end is not None and own_end.scope == TransferCounterpartyScope.TRACKED:
            candidate_ids.add(own_end.account_id)

    accounts: dict[uuid.UUID, Account] = {}
    for account_id in sorted(candidate_ids):
        accounts[account_id] = await _load_move_target(db, user, account_id)
    return accounts


def _candidate_own_account(
    transaction: Transaction,
    data: BulkUpdateTransactionsRequest,
    chosen_category: Category | None,
    categories_by_id: dict[uuid.UUID, Category],
    own_end_accounts: dict[uuid.UUID, Account],
) -> Account | None:
    """Return the account a row's own transfer end names, when that end is a tracked account

    Args:
        transaction: Transaction the request covers
        data: Transactions to change and the details to set
        chosen_category: Category the request sets, or None when it sets none
        categories_by_id: Stored categories keyed by identifier, used when the request sets none
        own_end_accounts: Accounts a tracked own end may move a row into, keyed by identifier

    Returns:
        The account the row's own end names, or None when the row resolves no own end
    """
    if not _row_records_far_side(transaction, chosen_category, categories_by_id):
        return None
    own_end = _own_end(data, _resulting_direction(transaction, data))
    if own_end is None or own_end.scope != TransferCounterpartyScope.TRACKED:
        return None
    return own_end_accounts[own_end.account_id]


async def _load_chosen_category(
    db: AsyncSession,
    data: BulkUpdateTransactionsRequest,
    sent: set[str],
) -> Category | None:
    """Return the category the request sets, ahead of checking it reaches any particular group

    Which rows resolve a transfer end at all turns on whether their resulting category records a far
    side, and that has to be known before `group_ids` can be computed, so this loads the category by
    identifier alone. `_validate_chosen_scope` runs the full per-group check once the groups the rows
    actually land in are known

    Args:
        db: Active database session
        data: Transactions to change and the details to set
        sent: Names of the fields the request carried

    Returns:
        The chosen category, or None when the request sets none

    Raises:
        HTTPException: The chosen category does not exist or is not visible to the caller
    """
    if "category_id" not in sent:
        return None
    category = await db.get(Category, data.category_id)
    if category is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")
    return category


async def _validate_chosen_scope(
    db: AsyncSession,
    user: User,
    data: BulkUpdateTransactionsRequest,
    sent: set[str],
    group_ids: set[uuid.UUID | None],
) -> None:
    """Confirm the chosen category, merchant and tags reach every group in play

    A selection can span a personal account and a group account, and a record reaching one of them
    does not reach the other, so each scope is checked in its own right

    Args:
        db: Active database session
        user: Authenticated user applying the change
        data: Transactions to change and the details to set
        sent: Names of the fields the request carried
        group_ids: Groups the rows end up in, with None for a personal account

    Raises:
        HTTPException: A chosen record does not reach one of the groups
    """
    for group_id in group_ids:
        if "category_id" in sent:
            await validate_transaction_category_access(db, data.category_id, user.id, group_id)
        if "merchant_id" in sent:
            await validate_transaction_merchant_access(db, data.merchant_id, user.id, group_id)
        if data.add_tag_ids:
            await get_valid_transaction_tag_ids(db, user.id, data.add_tag_ids, group_id)


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
    """Return the category a transaction ends up under once the request is applied

    Args:
        transaction: Transaction the request covers
        chosen_category: Category the request sets, or None when it sets none
        categories_by_id: Stored categories keyed by identifier, used when the request sets none

    Returns:
        The category the transaction ends up under
    """
    return chosen_category if chosen_category is not None else categories_by_id[transaction.category_id]


def _resolve_transfer_ends(
    transaction: Transaction,
    data: BulkUpdateTransactionsRequest,
    resulting_direction: BulkDirectionChange,
) -> _TransferEndPair | None:
    """Return the own and far transfer ends a row ends up with

    Money out puts the row's own account at From and its recorded account at To, and money in is the
    other way round. An end the request left out leaves that side of the row as it is

    Args:
        transaction: Transaction the request covers
        data: Transactions to change and the details to set
        resulting_direction: Direction the transaction ends up pointing

    Returns:
        The own and far ends to write, either one None where that side is left alone, or None when
        the request set neither end
    """
    if not {"transfer_from", "transfer_to"} & data.model_fields_set:
        return None
    if resulting_direction == BulkDirectionChange.DEBIT:
        return data.transfer_from, data.transfer_to
    return data.transfer_to, data.transfer_from


def _resulting_account_id(
    transaction: Transaction,
    target_account: Account | None,
    ends: _TransferEndPair | None,
) -> uuid.UUID:
    """Return the account a row ends up sitting in once the request is applied

    Args:
        transaction: Transaction the request covers
        target_account: Account a plain move sends the transactions to, or None
        ends: The row's resolved transfer ends, or None when none apply

    Returns:
        The account identifier the row ends up in
    """
    own_end = ends[0] if ends is not None else None
    if own_end is not None and own_end.scope == TransferCounterpartyScope.TRACKED:
        return own_end.account_id
    if target_account is not None:
        return target_account.id
    return transaction.account_id


def _resolve_rows(
    transactions: list[Transaction],
    data: BulkUpdateTransactionsRequest,
    chosen_category: Category | None,
    categories_by_id: dict[uuid.UUID, Category],
    target_account: Account | None,
) -> dict[uuid.UUID, _RowResolution]:
    """Resolve the category, resulting account and transfer ends of every row

    Done once before any write, since a value read off a row after `_apply_changes` has run may
    already be the new one rather than the one the checks judged

    Args:
        transactions: Transactions the request covers
        data: Transactions to change and the details to set
        chosen_category: Category the request sets, or None when it sets none
        categories_by_id: Stored categories keyed by identifier, used when the request sets none
        target_account: Account a plain move sends the transactions to, or None

    Returns:
        Each transaction's resolution, keyed by identifier
    """
    resolutions: dict[uuid.UUID, _RowResolution] = {}
    for transaction in transactions:
        category = _resulting_category(transaction, chosen_category, categories_by_id)
        ends = (
            _resolve_transfer_ends(transaction, data, _resulting_direction(transaction, data))
            if does_category_record_counterparty_account(category)
            else None
        )
        resolutions[transaction.id] = _RowResolution(
            category=category,
            account_id=_resulting_account_id(transaction, target_account, ends),
            ends=ends,
        )
    return resolutions


def _refuse_ends_reaching_no_row(
    data: BulkUpdateTransactionsRequest,
    resolutions: dict[uuid.UUID, _RowResolution],
) -> None:
    """Reject a request whose transfer ends land on no row at all

    An end reaches only the rows whose resulting category records a far side, and a selection
    holding none of those would otherwise report a count for a write it never made

    Args:
        data: Transactions to change and the details to set
        resolutions: Every transaction's resolution, keyed by identifier

    Raises:
        HTTPException: The request set a transfer end but no row in the selection resolves one
    """
    if not {"transfer_from", "transfer_to"} & data.model_fields_set:
        return
    if any(resolution.ends is not None for resolution in resolutions.values()):
        return
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail="None of these transactions record the other side of a transfer",
    )


async def _refuse_rows_breaking_single_edit_rules(
    db: AsyncSession,
    user: User,
    data: BulkUpdateTransactionsRequest,
    transactions: list[Transaction],
    resolutions: dict[uuid.UUID, _RowResolution],
    accounts_by_id: dict[uuid.UUID, Account],
) -> None:
    """Reject the whole set when any row breaks a rule a single edit of it would break

    Counts are grouped by reason rather than listing identifiers, since a raw list of identifiers
    tells the person reading the message nothing about what to fix

    Args:
        db: Active database session
        user: Authenticated user applying the change
        data: Transactions to change and the details to set
        transactions: Transactions the request covers
        resolutions: Every transaction's resolution, keyed by identifier
        accounts_by_id: Every account a row might end up in, keyed by identifier

    Raises:
        HTTPException: At least one row breaks a rule
    """
    without_merchant = []
    missing_fx_rate = []
    sits_outside = []
    unanswered_transfers = []
    own_account_counterparty = []
    transfers_by_counterparty: dict[uuid.UUID, list[uuid.UUID]] = {}

    for transaction in transactions:
        # Editing brings a row onto the current rule, so one recorded before a merchant was required
        # has to gain one before any other change to it is accepted
        if "merchant_id" not in data.model_fields_set and transaction.merchant_id is None:
            without_merchant.append(transaction.id)

        resolution = resolutions[transaction.id]
        resulting_account = accounts_by_id[resolution.account_id]

        # Checked only where the row actually moves, whether that move came from account_id or from
        # a tracked own end, matching the single-transaction path, which re-checks the rate only when
        # account_id changes. A row keeping its own account is not asked to justify a currency
        # mismatch this edit did not create, however it came to have one
        if (
            resolution.account_id != transaction.account_id
            and transaction.currency != resulting_account.currency
            and transaction.fx_rate is None
        ):
            missing_fx_rate.append(transaction.id)

        if not does_category_record_counterparty_account(resolution.category):
            continue

        own_end, far_end = resolution.ends if resolution.ends is not None else (None, None)
        if own_end is not None and own_end.scope == TransferCounterpartyScope.OUTSIDE:
            sits_outside.append(transaction.id)
            continue

        far_scope = far_end.scope if far_end is not None else transaction.counterparty_account_scope
        far_account_id = far_end.account_id if far_end is not None else transaction.counterparty_account_id

        if far_scope is None:
            unanswered_transfers.append(transaction.id)
        elif far_account_id is not None:
            if far_account_id == resolution.account_id:
                own_account_counterparty.append(transaction.id)
            else:
                transfers_by_counterparty.setdefault(far_account_id, []).append(transaction.id)

    unreachable_counterparties = await _find_unreachable_counterparties(db, user, transfers_by_counterparty)

    reasons = []
    if without_merchant:
        reasons.append(f"{len(without_merchant)} with no merchant recorded")
    if missing_fx_rate:
        reasons.append(f"{len(missing_fx_rate)} in another currency with no exchange rate recorded")
    if sits_outside:
        reasons.append(f"{len(sits_outside)} that would sit outside this app")
    if unanswered_transfers:
        reasons.append(f"{len(unanswered_transfers)} not recording the other account of a transfer")
    if own_account_counterparty:
        reasons.append(f"{len(own_account_counterparty)} that would record their own account")
    if unreachable_counterparties:
        reasons.append(f"{len(unreachable_counterparties)} recording an account you can no longer open")
    if not reasons:
        return

    refused_count = len({
        *without_merchant,
        *missing_fx_rate,
        *sits_outside,
        *unanswered_transfers,
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
    resolutions: dict[uuid.UUID, _RowResolution],
) -> dict[uuid.UUID, date]:
    """Return the earliest date each affected account has to be rebuilt from

    A balance moves when a row changes account, changes date, or changes the sign of its amount, so
    nothing is rebuilt unless one of those is asked for. Every row counts twice, once for where it
    was and once for where it ends up, so an account keeping a row that only changes date still
    rebuilds from that row's earlier date

    Read before the change is written, since SQLAlchemy writes the new values back onto the loaded
    rows and a column read afterwards is the new one rather than the one this collection needs

    Args:
        data: Transactions to change and the details to set
        sent: Names of the fields the request carried
        transactions: Transactions the request covers
        resolutions: Every transaction's resolution, keyed by identifier

    Returns:
        The earliest date to rebuild from, keyed by account
    """
    if not ({"account_id", "dt", "direction", "transfer_from", "transfer_to"} & sent):
        return {}

    starts: dict[uuid.UUID, date] = {}
    for transaction in transactions:
        resulting_account_id = resolutions[transaction.id].account_id
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
    resolutions: dict[uuid.UUID, _RowResolution],
) -> None:
    """Write the requested change and normalise what the change invalidates

    Args:
        db: Active database session
        data: Transactions to change and the details to set
        sent: Names of the fields the request carried
        transactions: Transactions the request covers
        transaction_ids: Identifiers of those transactions
        resolutions: Every transaction's resolution, keyed by identifier

    Returns:
        None

    Raises:
        HTTPException: A row's sign no longer matches the one its transfer ends were resolved for
    """
    column_values = {field: getattr(data, field) for field in _DIRECT_COLUMN_FIELDS if field in sent}
    if column_values:
        await db.execute(update(Transaction).where(Transaction.id.in_(transaction_ids)).values(**column_values))

    # Split into at most two buckets, keyed by each row's own sign rather than by its resulting
    # direction, since a race is a change to that stored sign specifically. Direction is one value
    # for the whole request, so every row sharing a sign also shares the resulting direction that
    # produced its own and far ends, and the bucket can use either row's ends for the whole group.
    # The WHERE clause re-reads the sign at write time, so a row whose sign changed between the
    # checks and here drops out of its bucket's count and the whole request is turned down rather
    # than written for a direction the row no longer has
    for own_direction in (BulkDirectionChange.DEBIT, BulkDirectionChange.CREDIT):
        bucket_ids = [
            transaction.id
            for transaction in transactions
            if _own_direction(transaction) == own_direction and resolutions[transaction.id].ends is not None
        ]
        if not bucket_ids:
            continue

        own_end, far_end = resolutions[bucket_ids[0]].ends
        values: dict[str, object] = {}
        if own_end is not None:
            values["account_id"] = own_end.account_id
        if far_end is not None:
            values["counterparty_account_scope"] = far_end.scope
            values["counterparty_account_id"] = far_end.account_id

        sign_condition = (
            Transaction.amount < 0 if own_direction == BulkDirectionChange.DEBIT else Transaction.amount >= 0
        )
        written = await db.execute(
            update(Transaction).where(Transaction.id.in_(bucket_ids), sign_condition).values(**values),
        )
        if written.rowcount != len(bucket_ids):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Another change reached one of these transactions first. Try again.",
            )

    if "direction" in sent:
        magnitude = func.abs(Transaction.amount)
        if data.direction == BulkDirectionChange.REVERSE:
            new_amount = -Transaction.amount
        elif data.direction == BulkDirectionChange.CREDIT:
            new_amount = magnitude
        else:
            new_amount = -magnitude
        await db.execute(
            update(Transaction)
            .where(Transaction.id.in_(transaction_ids))
            .values(amount=new_amount)
            .execution_options(synchronize_session=False),
        )

    records_counterparty = [
        transaction.id
        for transaction in transactions
        if does_category_record_counterparty_account(resolutions[transaction.id].category)
    ]

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
