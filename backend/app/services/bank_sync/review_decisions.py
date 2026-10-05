"""Adding a new bank item to the ledger or dismissing it

Adding writes the ledger transaction and accepts the bank transaction in one save, so neither
exists without the other. Each action locks the bank transaction first, so a double submission or
any other write to the item queues behind it and then finds the item as that write left it. A
repeated action answers as the first did without writing again. Neither action writes the link, so
neither locks it
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_transaction import OBSERVATION_COLUMNS, BankTransaction, BankTransactionDisposition
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.bank_review import AddReviewItemRequest
from app.schemas.transaction import CreateTransactionRequest, TransactionResponse
from app.services.accounts.access import get_own_personal_account, own_personal_account_condition
from app.services.cache_state import mark_user_cache_changed
from app.services.transactions.creation import insert_transaction
from app.services.transactions.response_helpers import get_transaction_response

REVIEW_ITEM_NOT_FOUND = "Review item not found"

# Why an added item refuses a transfer counterparty the user can see but doesn't own alone
_COUNTERPARTY_NOT_OWN_DETAIL = "Transfers from a bank item can't go to an account shared with a group"


async def add_review_item_to_ledger(db: AsyncSession, user: User, item_id: uuid.UUID, request: AddReviewItemRequest) -> TransactionResponse:
    """Add a new bank item to the ledger with the user's values and accept it, in one save

    The ledger transaction passes the checks a hand-entered one does, except the days a linked
    account's bank supplies, since this one is the bank's. A transfer's counterparty has to be one
    of the user's own personal accounts, as for the item itself. It is aligned with the bank's date and
    amount, so a date or amount the user changed counts as edited, and so does any amount entered
    for one the bank sent that couldn't be stored. An item already added answers with its
    transaction, so a double submission adds it once

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
    record, account = await _lock_review_item(db, user, item_id)
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
    record, _ = await _lock_review_item(db, user, item_id)
    if record.disposition == BankTransactionDisposition.DISMISSED:
        return
    if record.disposition == BankTransactionDisposition.ACCEPTED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This item is already in the ledger, so it can't be dismissed")

    record.disposition = BankTransactionDisposition.DISMISSED
    for column in OBSERVATION_COLUMNS:
        setattr(record, column, None)
    await db.flush()

    await mark_user_cache_changed(db, user.id)
    await db.commit()


async def _lock_review_item(db: AsyncSession, user: User, item_id: uuid.UUID) -> tuple[BankTransaction, Account]:
    """Lock one of the user's bank transactions on their own personal accounts and return it with its account

    A request that waited on the lock reads the item as the write before it left it. Only the
    bank transaction is locked, so the account stays free for the requests that lock it

    Raises:
        HTTPException 404: The item isn't one of the user's, or was withdrawn by the bank
    """
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
    return row.tuple()
