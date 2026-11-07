"""Deciding bank items and the bank values of transactions already in the ledger

The actions are adding a new item or dismissing it, accepting or declining a correction, removing
or keeping a removed transaction, and restoring a bank value the user edited.

Adding writes the ledger transaction and accepts the bank transaction in one save, so neither
exists without the other, accepting a correction or restoring a bank value writes the bank's values
to the same ledger transaction and aligns it with them in one save, and removing deletes the ledger
transaction, its bank transaction with it, and rebuilds its balances in one save. Each action locks
the bank transaction before deciding, then any ledger transaction it writes, so a double submission
or any other write to the item, a sync's included, queues behind it and then finds the item as that
write left it. A repeated action answers as the first did without writing again, except a repeated
removal. That one finds nothing left and answers that the item wasn't found. Adding or dismissing can
leave 50 or fewer new items waiting. That lifts the account's review pause and queues its sync, so
every action first locks the connection that sync would need, then the account's links, the order
every writer takes connections, links, bank transactions and their ledger transactions in. Either
can also leave none of the import's items waiting. That offers the account's opening adjustment
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_connection import BankAccountLink
from app.models.bank_transaction import (
    OBSERVATION_COLUMNS,
    BankTransaction,
    BankTransactionDisposition,
    EditableBankField,
    OpenReviewKind,
)
from app.models.base import PermissionLevel
from app.models.transaction import Transaction
from app.models.user import User
from app.permissions import check_transaction_access
from app.schemas.bank_review import AddReviewItemRequest
from app.schemas.transaction import CreateTransactionRequest, TransactionResponse, UpdateTransactionRequest
from app.services.accounts.access import get_own_personal_account, own_personal_account_condition
from app.services.bank_sync.opening_adjustment import offer_opening_adjustments
from app.services.bank_sync.review_pause import lift_review_pauses, lock_account_links
from app.services.bank_sync.review_state import EDITABLE_COLUMNS, align_with_bank, approved_description, bank_values, edited_fields
from app.services.cache_state import mark_user_cache_changed, mark_user_status_changed
from app.services.transactions.creation import insert_transaction
from app.services.transactions.deletion import delete_transaction
from app.services.transactions.response_helpers import get_transaction_response
from app.services.transactions.update import apply_transaction_update

REVIEW_ITEM_NOT_FOUND = "Review item not found"

# Why restoring refuses a transaction that isn't the user's, was entered by hand, or is no longer
# tied to the bank
BANK_SOURCE_NOT_FOUND = "Bank source not found"

# Why restoring refuses a bank amount the account's currency can't hold without rounding
_UNSTORABLE_RESTORE_DETAIL = "The bank's amount has more decimal places than {currency} allows, so it can't be restored"

# Why an added item refuses a transfer counterparty the user can see but doesn't own alone
_COUNTERPARTY_NOT_OWN_DETAIL = "Transfers from a bank item can't go to an account shared with a group"

# Why the decisions on a correction or removal refuse an item that never reached the ledger
_NOT_IN_LEDGER_DETAIL = "This item isn't in the ledger, so it has no bank change to decide"

# Why removing refuses a transaction the bank hasn't asked to remove, or whose removal the user kept
_NO_REMOVAL_DETAIL = "This transaction has no bank removal waiting, so it stays in your ledger"

# Why a correction's decisions refuse a correction a removal has since taken the place of
_REMOVAL_WAITING_DETAIL = "This transaction has a bank removal waiting, so decide that first"

# Why accepting refuses a bank amount the account's currency can't hold without rounding
_UNSTORABLE_AMOUNT_DETAIL = (
    "The bank's amount has more decimal places than {currency} allows. Keep your current value and edit the amount instead"
)


async def add_review_item_to_ledger(db: AsyncSession, user: User, item_id: uuid.UUID, request: AddReviewItemRequest) -> TransactionResponse:
    """Add a new bank item to the ledger with the user's values and accept it, in one save

    The ledger transaction passes the checks a hand-entered one does, except the days a linked
    account's bank supplies, since this one is the bank's. A transfer's counterparty has to be one
    of the user's own personal accounts, as for the item itself. The ledger transaction is aligned
    with the bank's date and amount, so a date or amount the user changed counts as edited, and so
    does any amount entered for one the bank sent that couldn't be stored. An item already added
    answers with its transaction, so a double submission adds it once

    Args:
        db: Active database session
        user: The user reviewing
        item_id: The item to add: its bank transaction's id
        request: The date, amount, merchant, category and other values to add it with

    Returns:
        The ledger transaction, with its bank source

    Raises:
        HTTPException 403: The transfer counterparty is visible but isn't the user's own personal account
        HTTPException 404: The item isn't one of the user's, or was withdrawn by the bank, or the
            transfer counterparty isn't visible to the user
        HTTPException 409: The item was dismissed
        HTTPException 422: A value fails the checks a new transaction passes
    """
    record, account, links = await _lock_review_item(db, user, item_id)
    if record.disposition == BankTransactionDisposition.ACCEPTED:
        return await get_transaction_response(db, await db.get_one(Transaction, record.transaction_id))
    if record.disposition == BankTransactionDisposition.DISMISSED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This item was dismissed, so it can't be added to the ledger")
    if request.counterparty_account_id is not None:
        await get_own_personal_account(db, request.counterparty_account_id, user.id, not_own_detail=_COUNTERPARTY_NOT_OWN_DETAIL)

    txn = await insert_transaction(
        db,
        user,
        account,
        CreateTransactionRequest(account_id=account.id, currency=account.currency, **request.model_dump()),
    )
    record.disposition = BankTransactionDisposition.ACCEPTED
    record.transaction_id = txn.id
    record.aligned_date = record.observed_date
    record.aligned_amount = record.observed_amount
    await db.flush()

    await lift_review_pauses(db, user.id, links)
    await offer_opening_adjustments(db, links, tz=user.tz)
    await mark_user_cache_changed(db, user.id)
    await db.commit()
    await db.refresh(txn)
    return await get_transaction_response(db, txn)


async def dismiss_review_item(db: AsyncSession, user: User, item_id: uuid.UUID) -> None:
    """Dismiss a new bank item, keeping only its identity so the bank sending it again doesn't bring it back

    An item already dismissed is left as it is, so a double submission dismisses it once

    Args:
        db: Active database session
        user: The user reviewing
        item_id: The item to dismiss: its bank transaction's id

    Raises:
        HTTPException 404: The item isn't one of the user's, or was withdrawn by the bank
        HTTPException 409: The item is already in the ledger
    """
    record, _, links = await _lock_review_item(db, user, item_id)
    if record.disposition == BankTransactionDisposition.DISMISSED:
        return
    if record.disposition == BankTransactionDisposition.ACCEPTED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This item is already in the ledger, so it can't be dismissed")

    record.disposition = BankTransactionDisposition.DISMISSED
    for column in OBSERVATION_COLUMNS:
        setattr(record, column, None)
    await db.flush()

    await lift_review_pauses(db, user.id, links)
    await offer_opening_adjustments(db, links, tz=user.tz)

    # A dismissal changes none of the ledger, so the data mark an import's undo compares with stays
    # where it was
    await mark_user_status_changed(db, user.id)
    await db.commit()


async def accept_bank_change(db: AsyncSession, user: User, item_id: uuid.UUID) -> TransactionResponse:
    """Write the bank's values for the fields a correction changes to its ledger transaction and close it, in one save

    The ledger transaction keeps its id and bank source and passes the checks an edit does, and its
    balances are rebuilt from the earlier of its old and new dates. Fields the correction doesn't
    change keep the ledger's values. Each field written is aligned with the bank, so a value the user
    had edited is replaced and no longer counts as edited. The bank's description has no ledger
    field, so accepting it only closes the correction and ends any description the user kept, so
    the ledger follows the bank's. Values the user declined before no longer stand, so the bank
    sending them again asks again. A correction already decided answers with the transaction as it
    stands, so a double submission accepts it once

    Args:
        db: Active database session
        user: The user reviewing
        item_id: The correction: its bank transaction's id

    Returns:
        The ledger transaction, with its bank source

    Raises:
        HTTPException 404: The item isn't one of the user's
        HTTPException 409: The item isn't in the ledger, a removal has taken the correction's place,
            or another change held the transaction too long
        HTTPException 422: The bank's amount can't be stored exactly, or a value fails the checks an
            edit passes
    """
    record, account, _ = await _lock_review_item(db, user, item_id)
    _refuse_unless_in_ledger(record)
    if record.open_kind == OpenReviewKind.REMOVAL:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_REMOVAL_WAITING_DETAIL)
    if record.open_kind != OpenReviewKind.CORRECTION:
        return await get_transaction_response(db, await db.get_one(Transaction, record.transaction_id))

    txn = await write_bank_change(db, user, record, account)
    await mark_user_cache_changed(db, user.id)
    await db.commit()
    await db.refresh(txn)
    return await get_transaction_response(db, txn)


async def write_bank_change(db: AsyncSession, user: User, record: BankTransaction, account: Account) -> Transaction:
    """Write the bank's values for the fields an open correction changes to its ledger transaction and close it, without committing

    The caller locked the bank transaction, after its account's links, then marks the cache and
    commits, so accepting one correction and approving many write the same way

    Args:
        db: Active database session
        user: The user reviewing
        record: The bank transaction, locked, with a correction open
        account: The account it belongs to

    Returns:
        The ledger transaction, written

    Raises:
        HTTPException 409: Another change held the transaction too long
        HTTPException 422: The bank's amount can't be stored exactly, or a value fails the checks an
            edit passes
    """
    if not is_bank_change_storable(record):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_UNSTORABLE_AMOUNT_DETAIL.format(currency=account.currency)
        )

    changed = [field for field in EDITABLE_COLUMNS if field in record.previous_values]
    txn = await check_transaction_access(db, record.transaction_id, user.id, PermissionLevel.WRITE, lock_for_update=True)
    bank = {EDITABLE_COLUMNS[field].ledger: getattr(record, EDITABLE_COLUMNS[field].observed) for field in changed}
    await apply_transaction_update(db, user, txn, UpdateTransactionRequest(**bank))
    align_with_bank(record, record.previous_values)
    record.open_kind = None
    record.previous_values = None
    await db.flush()
    return txn


def is_bank_change_storable(record: BankTransaction) -> bool:
    """Return whether the ledger can take every value an open correction changes, unless it's an amount the currency can't hold"""
    return "amount" not in record.previous_values or record.observed_amount is not None


async def keep_current_value(db: AsyncSession, user: User, item_id: uuid.UUID) -> TransactionResponse:
    """Close a correction leaving the ledger transaction as it is, so the bank's values it proposed don't come back

    The bank's values stay stored as its latest, and the changed date and amount are aligned with
    them, so the ledger's own count as edited and a trusted correction later leaves them alone. The
    ledger has no description, so the one it was decided with is kept in its place while the bank's
    differs, and a trusted correction leaves that alone too. The values declined are remembered, so
    the bank sending them again opens nothing until accepting a change, a trusted correction
    applying one, or the bank matching the ledger or the description kept aligns a field and
    replaces them. A correction already decided answers with the transaction as it stands, so a
    double submission keeps it once

    Args:
        db: Active database session
        user: The user reviewing
        item_id: The correction: its bank transaction's id

    Returns:
        The ledger transaction, with its bank source

    Raises:
        HTTPException 404: The item isn't one of the user's
        HTTPException 409: The item isn't in the ledger, or a removal has taken the correction's place
    """
    record, _, _ = await _lock_review_item(db, user, item_id)
    _refuse_unless_in_ledger(record)
    if record.open_kind == OpenReviewKind.REMOVAL:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_REMOVAL_WAITING_DETAIL)
    if record.open_kind == OpenReviewKind.CORRECTION:
        kept = approved_description(record)
        align_with_bank(record, record.previous_values)

        # The ledger keeps the description it was decided with, as it keeps its date and amount
        record.kept_description = kept if kept != record.description else None
        record.declined_observation = bank_values(record)
        record.open_kind = None
        record.previous_values = None
        await db.flush()

        # Keeping the current value changes none of the ledger, so the data mark an import's undo
        # compares with stays where it was
        await mark_user_status_changed(db, user.id)
        await db.commit()
    return await get_transaction_response(db, await db.get_one(Transaction, record.transaction_id))


async def remove_from_ledger(db: AsyncSession, user: User, item_id: uuid.UUID) -> None:
    """Delete the ledger transaction the bank removed, with its bank transaction, and rebuild its balances, in one save

    It works while the account is linked, since the bank asked for it. The bank transaction is
    locked before the ledger transaction, the order the sync and the other decisions take them in.
    Nothing of the bank transaction is kept, so a repeated removal finds no item, and the bank
    sending the same transaction again later brings it in as a new item

    Args:
        db: Active database session
        user: The user reviewing
        item_id: The removal: its bank transaction's id

    Raises:
        HTTPException 404: The item isn't one of the user's, or is already removed
        HTTPException 409: The item isn't in the ledger, has no removal waiting, or another change
            held the transaction too long
        HTTPException 422: The account is archived
    """
    record, _, _ = await _lock_review_item(db, user, item_id)
    _refuse_unless_in_ledger(record)
    if record.open_kind != OpenReviewKind.REMOVAL:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NO_REMOVAL_DETAIL)

    await delete_removed_transaction(db, user, record)
    await mark_user_cache_changed(db, user.id)
    await db.commit()


async def delete_removed_transaction(db: AsyncSession, user: User, record: BankTransaction) -> None:
    """Delete the ledger transaction an open removal names, its bank transaction with it, and rebuild its balances, without committing

    The caller locked the bank transaction, after its account's links, then marks the cache and
    commits, so removing one transaction and approving many removals write the same way. The bank
    transaction is gone once this returns, so the caller reads nothing more from it

    Raises:
        HTTPException 409: Another change held the transaction too long
        HTTPException 422: The account is archived
    """
    txn = await check_transaction_access(db, record.transaction_id, user.id, PermissionLevel.WRITE, lock_for_update=True)
    await delete_transaction(db, txn)


async def keep_transaction(db: AsyncSession, user: User, item_id: uuid.UUID) -> TransactionResponse:
    """Close a removal leaving the ledger transaction as it is

    The removal stays recorded, so the bank sending it again opens nothing. A correction the
    removal took the place of is still undecided, so it opens again. A removal already decided
    answers with the transaction as it stands, so a double submission keeps it once

    Args:
        db: Active database session
        user: The user reviewing
        item_id: The removal: its bank transaction's id

    Returns:
        The ledger transaction, with its bank source

    Raises:
        HTTPException 404: The item isn't one of the user's
        HTTPException 409: The item isn't in the ledger
    """
    record, _, _ = await _lock_review_item(db, user, item_id)
    _refuse_unless_in_ledger(record)
    if record.open_kind == OpenReviewKind.REMOVAL:
        record.open_kind = OpenReviewKind.CORRECTION if record.previous_values else None
        await db.flush()

        # Keeping the transaction changes none of the ledger, so the data mark an import's undo
        # compares with stays where it was
        await mark_user_status_changed(db, user.id)
        await db.commit()
    return await get_transaction_response(db, await db.get_one(Transaction, record.transaction_id))


async def restore_bank_value(db: AsyncSession, user: User, transaction_id: uuid.UUID, field: EditableBankField) -> TransactionResponse:
    """Write the bank's latest date or amount to a bank-imported transaction where the user edited it, in one save

    The transaction keeps its id and bank source and passes the checks an edit does, and its
    balances are rebuilt from the earlier of its old and new dates. An amount brings the bank's sign
    with it, so the direction follows the bank. The field is aligned with the bank, so it no longer
    counts as edited and a trusted correction applies to it again, and the values the user declined
    before no longer stand. A correction waiting on the field is settled, since the ledger now holds
    the bank's value, and closes once it has no field left. A field that isn't edited answers with
    the transaction as it stands, so a double submission restores it once, and a correction waiting
    on a field the user left alone stays theirs to decide

    Args:
        db: Active database session
        user: The user restoring the value
        transaction_id: The bank-imported ledger transaction
        field: The edited field to put the bank's value back on

    Returns:
        The ledger transaction, with its bank source

    Raises:
        HTTPException 404: The user has no bank-imported transaction with this id. That covers one
            that is someone else's or was entered by hand, since only a personal account is linked
        HTTPException 409: Another change held the transaction too long
        HTTPException 422: The bank's amount can't be stored exactly, or the bank's value fails the
            checks an edit passes
    """
    record, account, _ = await _lock_bank_transaction(db, user, BankTransaction.transaction_id == transaction_id, BANK_SOURCE_NOT_FOUND)

    txn = await check_transaction_access(db, transaction_id, user.id, PermissionLevel.WRITE, lock_for_update=True)
    if field not in edited_fields(record, txn.dt, txn.amount):
        return await get_transaction_response(db, txn)
    columns = EDITABLE_COLUMNS[field]
    bank = getattr(record, columns.observed)
    if bank is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_UNSTORABLE_RESTORE_DETAIL.format(currency=account.currency)
        )

    await apply_transaction_update(db, user, txn, UpdateTransactionRequest(**{columns.ledger: bank}))
    align_with_bank(record, [field])
    if record.previous_values is not None:
        record.previous_values = {name: value for name, value in record.previous_values.items() if name != field} or None

    # A removal stays open, keeping what is left of a correction it took the place of
    if record.open_kind == OpenReviewKind.CORRECTION and record.previous_values is None:
        record.open_kind = None
    await db.flush()

    await mark_user_cache_changed(db, user.id)
    await db.commit()
    await db.refresh(txn)
    return await get_transaction_response(db, txn)


def _refuse_unless_in_ledger(record: BankTransaction) -> None:
    """Refuse a decision on a correction or removal for an item still waiting to be added, or dismissed

    Raises:
        HTTPException 409: The item isn't in the ledger
    """
    if record.disposition != BankTransactionDisposition.ACCEPTED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NOT_IN_LEDGER_DETAIL)


async def _lock_review_item(db: AsyncSession, user: User, item_id: uuid.UUID) -> tuple[BankTransaction, Account, list[BankAccountLink]]:
    """Lock the bank transaction an item id names, as _lock_bank_transaction does

    Raises:
        HTTPException 404: The item isn't one of the user's, or is gone, withdrawn by the bank or
            removed from the ledger
    """
    return await _lock_bank_transaction(db, user, BankTransaction.id == item_id, REVIEW_ITEM_NOT_FOUND)


async def _lock_bank_transaction(
    db: AsyncSession, user: User, which: ColumnElement[bool], not_found_detail: str
) -> tuple[BankTransaction, Account, list[BankAccountLink]]:
    """Lock the one bank transaction of the user's own that meets a condition, as lock_bank_transactions does

    Args:
        db: Active database session
        user: The user acting
        which: The condition picking out the one bank transaction
        not_found_detail: Why there is nothing to lock, as the caller names what it looked for

    Returns:
        The bank transaction and its account, and the account's links, for a lift to take

    Raises:
        HTTPException 404: No bank transaction of the user's own meets the condition
    """
    rows, links = await lock_bank_transactions(db, user, which)
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail)
    record, account = rows[0]
    return record, account, links


async def lock_bank_transactions(
    db: AsyncSession, user: User, which: ColumnElement[bool]
) -> tuple[list[tuple[BankTransaction, Account]], list[BankAccountLink]]:
    """Lock the user's bank transactions on their own personal accounts that meet a condition, in id order, after their links

    The connections and links come first, as every writer takes them, since adding or dismissing may
    lift an account's review pause and queue its sync. A bank transaction's account never changes,
    so the accounts are read before anything is locked. A request that waited on a lock reads each
    bank transaction as the write before it left it, and one that write deleted is left out. The
    accounts themselves aren't locked, so they stay free for the requests that lock them

    Args:
        db: Active database session
        user: The user acting
        which: The condition picking out the bank transactions

    Returns:
        Each bank transaction with its account, in id order, and the accounts' links, for a lift to take
    """
    own = [which, own_personal_account_condition(user.id)]
    account_ids = list(
        await db.scalars(select(BankTransaction.account_id).join(Account, Account.id == BankTransaction.account_id).where(*own).distinct())
    )
    if not account_ids:
        return [], []
    links = await lock_account_links(db, account_ids)

    # Read again under their own locks, since they may have changed or gone while the links were locked
    rows = await db.execute(
        select(BankTransaction, Account)
        .join(Account, Account.id == BankTransaction.account_id)
        .where(*own)
        .order_by(BankTransaction.id)
        .with_for_update(of=BankTransaction)
        .execution_options(populate_existing=True)
    )
    return [(record, account) for record, account in rows], links
