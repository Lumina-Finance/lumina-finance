"""Deciding bank items: adding a new one to the ledger or dismissing it, and accepting or declining a correction

Adding writes the ledger transaction and accepts the bank transaction in one save, so neither
exists without the other, and accepting a correction writes the bank's values to the same ledger
transaction and closes it in one save. Each action locks the bank transaction before deciding, then
any ledger transaction it writes, so a double submission or any other write to the item, a sync's
included, queues behind it and then finds the item as that write left it. A repeated action answers
as the first did without writing again. A decision that leaves 50 or fewer new items waiting lifts
the account's review pause and queues its sync, so each action first locks the connection that
sync would need, then the account's links, the order every writer takes connections, links, bank
transactions and their ledger transactions in
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_connection import BankAccountLink
from app.models.bank_transaction import OBSERVATION_COLUMNS, BankTransaction, BankTransactionDisposition, OpenReviewKind
from app.models.base import PermissionLevel
from app.models.transaction import Transaction
from app.models.user import User
from app.permissions import check_transaction_access
from app.schemas.bank_review import AddReviewItemRequest
from app.schemas.transaction import CreateTransactionRequest, TransactionResponse, UpdateTransactionRequest
from app.services.accounts.access import get_own_personal_account, own_personal_account_condition
from app.services.bank_sync.review_pause import lift_review_pauses, lock_account_links
from app.services.bank_sync.review_state import EDITABLE_COLUMNS, align_with_bank, bank_values
from app.services.cache_state import mark_user_cache_changed
from app.services.transactions.creation import insert_transaction
from app.services.transactions.response_helpers import get_transaction_response
from app.services.transactions.update import apply_transaction_update

REVIEW_ITEM_NOT_FOUND = "Review item not found"

# Why an added item refuses a transfer counterparty the user can see but doesn't own alone
_COUNTERPARTY_NOT_OWN_DETAIL = "Transfers from a bank item can't go to an account shared with a group"

# Why a correction's decisions refuse an item that never reached the ledger
_NOT_IN_LEDGER_DETAIL = "This item isn't in the ledger, so it has no bank change to decide"

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
        item_id: The item to add, which is its bank transaction's id
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
        item_id: The item to dismiss, which is its bank transaction's id

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
    await mark_user_cache_changed(db, user.id)
    await db.commit()


async def accept_bank_change(db: AsyncSession, user: User, item_id: uuid.UUID) -> TransactionResponse:
    """Write the bank's values for the fields a correction changes to its ledger transaction and close it, in one save

    The ledger transaction keeps its id and bank source and passes the checks an edit does, and its
    balances are rebuilt from the earlier of its old and new dates. Fields the correction doesn't
    change keep the ledger's values. Each field written is aligned with the bank, so a value the user
    had edited is replaced and no longer counts as edited. The bank's description has no ledger
    field, so accepting it only closes the correction. A correction already decided answers with
    the transaction as it stands, so a double submission accepts it once

    Args:
        db: Active database session
        user: The user reviewing
        item_id: The correction, which is its bank transaction's id

    Returns:
        The ledger transaction, with its bank source

    Raises:
        HTTPException 404: The item isn't one of the user's
        HTTPException 409: The item isn't in the ledger, or another change held the transaction too long
        HTTPException 422: The bank's amount can't be stored exactly, or a value fails the checks an
            edit passes
    """
    record, account, _ = await _lock_review_item(db, user, item_id)
    _refuse_unless_in_ledger(record)
    if record.open_kind != OpenReviewKind.CORRECTION:
        return await get_transaction_response(db, await db.get_one(Transaction, record.transaction_id))
    changed = [field for field in EDITABLE_COLUMNS if field in record.previous_values]
    if "amount" in changed and record.observed_amount is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_UNSTORABLE_AMOUNT_DETAIL.format(currency=account.currency)
        )

    txn = await check_transaction_access(db, record.transaction_id, user.id, PermissionLevel.WRITE, lock_for_update=True)
    bank = {EDITABLE_COLUMNS[field].ledger: getattr(record, EDITABLE_COLUMNS[field].observed) for field in changed}
    await apply_transaction_update(db, user, txn, UpdateTransactionRequest(**bank))
    align_with_bank(record, changed)
    record.open_kind = None
    record.previous_values = None
    await db.flush()

    await mark_user_cache_changed(db, user.id)
    await db.commit()
    await db.refresh(txn)
    return await get_transaction_response(db, txn)


async def keep_current_value(db: AsyncSession, user: User, item_id: uuid.UUID) -> TransactionResponse:
    """Close a correction leaving the ledger transaction as it is, so the bank's values it proposed don't come back

    The bank's values stay stored as its latest, and the changed date and amount are aligned with
    them, so the ledger's own count as edited and a trusted correction later leaves them alone. The
    values declined are remembered, so the bank sending them again opens nothing. A correction
    already decided answers with the transaction as it stands, so a double submission keeps it once

    Args:
        db: Active database session
        user: The user reviewing
        item_id: The correction, which is its bank transaction's id

    Returns:
        The ledger transaction, with its bank source

    Raises:
        HTTPException 404: The item isn't one of the user's
        HTTPException 409: The item isn't in the ledger
    """
    record, _, _ = await _lock_review_item(db, user, item_id)
    _refuse_unless_in_ledger(record)
    if record.open_kind == OpenReviewKind.CORRECTION:
        align_with_bank(record, record.previous_values)
        record.declined_observation = bank_values(record)
        record.open_kind = None
        record.previous_values = None
        await db.flush()

        await mark_user_cache_changed(db, user.id)
        await db.commit()
    return await get_transaction_response(db, await db.get_one(Transaction, record.transaction_id))


def _refuse_unless_in_ledger(record: BankTransaction) -> None:
    """Refuse a correction's decision on an item still waiting to be added, or dismissed

    Raises:
        HTTPException 409: The item isn't in the ledger
    """
    if record.disposition != BankTransactionDisposition.ACCEPTED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NOT_IN_LEDGER_DETAIL)


async def _lock_review_item(db: AsyncSession, user: User, item_id: uuid.UUID) -> tuple[BankTransaction, Account, list[BankAccountLink]]:
    """Lock one of the user's bank transactions on their own personal accounts, after its account's connection and links

    The connection and links come first, as every writer takes them, since the decision may lift
    the account's review pause and queue its sync. An item's account never changes, so it is read
    before anything is locked. A request that waited on a lock reads the item as the write before it
    left it. The account itself isn't locked, so it stays free for the requests that lock it

    Returns:
        The item and its account, and the account's links, which a lift takes

    Raises:
        HTTPException 404: The item isn't one of the user's, or was withdrawn by the bank
    """
    account_id = await db.scalar(
        select(BankTransaction.account_id)
        .join(Account, Account.id == BankTransaction.account_id)
        .where(BankTransaction.id == item_id, own_personal_account_condition(user.id))
    )
    if account_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=REVIEW_ITEM_NOT_FOUND)
    links = await lock_account_links(db, [account_id])

    # Read again under its own lock, since the item may have changed or gone while the links were locked
    row = (
        await db.execute(
            select(BankTransaction, Account)
            .join(Account, Account.id == BankTransaction.account_id)
            .where(BankTransaction.id == item_id, own_personal_account_condition(user.id))
            .with_for_update(of=BankTransaction)
            .execution_options(populate_existing=True)
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=REVIEW_ITEM_NOT_FOUND)
    record, account = row.tuple()
    return record, account, links
