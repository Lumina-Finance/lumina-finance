"""Adding or dismissing many new bank items at once, all in one save

Each item sent carries the version the review list showed. A bank transaction's version moves on
every write to it, so an item a sync changed since, one decided elsewhere and one a repeated request
already decided are skipped and reported, as are items that are gone or aren't the user's. Adding
also skips an item whose bank amount the account's currency can't hold, since its amount has to be
entered one item at a time. Any other refusal undoes the whole request.

The locks come in the single decisions' order, connections and links, then bank transactions in id
order. Items are then added account by account, in the order a rebuild of several accounts'
balances takes their locks, so a bulk add never holds one account's balances while waiting for
another's that such a rebuild holds
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_connection import BankAccountLink
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition
from app.models.user import User
from app.schemas.bank_review import BulkAddReviewItemsRequest, BulkDismissReviewItemsRequest, BulkReviewResultResponse
from app.schemas.transaction import TransactionEntry
from app.services.accounts.snapshots import sort_by_snapshot_lock
from app.services.bank_sync.review_decisions import lock_bank_transactions, write_dismissal, write_new_item
from app.services.bank_sync.review_pause import lift_review_pauses
from app.services.cache_state import mark_user_cache_changed, mark_user_status_changed


async def bulk_add_review_items(db: AsyncSession, user: User, request: BulkAddReviewItemsRequest) -> BulkReviewResultResponse:
    """Add each new item still at the version sent to the ledger with the values sent and its own bank amount, in one save

    Args:
        db: Active database session
        user: The user reviewing
        request: The items, each at the version the list showed, and the values to add them with

    Returns:
        The items added and the items skipped

    Raises:
        HTTPException: A value fails the checks a new transaction passes, so nothing was added
    """
    rows, links = await _lock_unchanged_new_items(db, user, request)
    addable = [(record, account) for record, account in rows if record.observed_amount is not None]
    account_order = {account_id: place for place, account_id in enumerate(sort_by_snapshot_lock(account.id for _, account in addable))}
    for record, account in sorted(addable, key=lambda row: (account_order[row[1].id], row[0].id)):
        entry = TransactionEntry(
            dt=request.dt or record.observed_date,
            amount=record.observed_amount,
            merchant_id=request.merchant_id,
            category_id=request.category_id,
            tag_ids=request.tag_ids,
            notes=request.notes,
        )
        await write_new_item(db, user, record, account, entry)

    decided = {record.id for record, _ in addable}
    if decided:
        await lift_review_pauses(db, user.id, links)
        await mark_user_cache_changed(db, user.id)
        await db.commit()
    return _result(request, decided)


async def bulk_dismiss_review_items(db: AsyncSession, user: User, request: BulkDismissReviewItemsRequest) -> BulkReviewResultResponse:
    """Dismiss each new item still at the version sent, keeping only its identity, in one save

    Args:
        db: Active database session
        user: The user reviewing
        request: The items, each at the version the list showed

    Returns:
        The items dismissed and the items skipped
    """
    rows, links = await _lock_unchanged_new_items(db, user, request)
    for record, _ in rows:
        await write_dismissal(db, record)

    decided = {record.id for record, _ in rows}
    if decided:
        await lift_review_pauses(db, user.id, links)

        # A dismissal changes none of the ledger, so the data mark an import's undo compares with stays
        # where it was
        await mark_user_status_changed(db, user.id)
        await db.commit()
    return _result(request, decided)


async def _lock_unchanged_new_items(
    db: AsyncSession, user: User, request: BulkDismissReviewItemsRequest
) -> tuple[list[tuple[BankTransaction, Account]], list[BankAccountLink]]:
    """Lock the user's items sent, as lock_bank_transactions does, keeping the new ones still at the version sent

    Returns:
        Each new item still at its version with its account, and the links of every account an item
        sent is on, for a lift to take
    """
    versions = {item.id: item.version for item in request.items}
    rows, links = await lock_bank_transactions(db, user, BankTransaction.id.in_(versions))
    unchanged = [
        (record, account)
        for record, account in rows
        if record.disposition == BankTransactionDisposition.AWAITING_REVIEW and record.version == versions[record.id]
    ]
    return unchanged, links


def _result(request: BulkDismissReviewItemsRequest, decided: set[uuid.UUID]) -> BulkReviewResultResponse:
    """Split the items sent into those decided and those skipped, each in the order sent, once each"""
    sent = list(dict.fromkeys(item.id for item in request.items))
    return BulkReviewResultResponse(
        decided_ids=[item_id for item_id in sent if item_id in decided],
        skipped_ids=[item_id for item_id in sent if item_id not in decided],
    )
