"""Adding every waiting new item whose saved rule values give it a merchant and a category, in one save

The press matches no rules. It adds what each item holds at the moment of the press, rebuilt from
its saved values and the records as they are then, so a rule edited since the item arrived changes
nothing here until the rules are applied again. It takes new items only, never a correction or a
removal, over the accounts the list shows. The candidates are read without a lock, newest first, and
the first 1,000 that can be added are locked by their ids in the single decisions' order, connections
and links, then bank transactions in id order. What was decided elsewhere before the lock is left
out, and the rest are rebuilt and checked again as the lock read them. Items are then written
account by account, in the order the bulk add takes, and one failure of any write undoes the whole press
"""

import uuid
from collections.abc import Sequence
from contextlib import aclosing

from sqlalchemy import ColumnElement
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_transaction import BankTransaction, BankTransactionDisposition
from app.models.user import User
from app.schemas.bank_review import ApproveAllReviewItemsRequest, ApproveAllReviewItemsResponse
from app.schemas.transaction import MAX_BULK_UPDATE_TRANSACTIONS, TransactionEntry
from app.services.accounts.access import own_personal_accounts_scope
from app.services.accounts.snapshots import sort_by_snapshot_lock
from app.services.bank_sync.review_decisions import lock_bank_transactions, write_new_item
from app.services.bank_sync.review_items import REVIEW_NOT_OWN_DETAIL
from app.services.bank_sync.review_pause import lift_review_pauses
from app.services.bank_sync.saved_fills import (
    is_addable,
    keep_addable,
    read_saved_fill,
    read_saved_targets,
    saved_item_of,
    stream_candidates,
    writable_accounts_scope,
)
from app.services.cache_state import mark_user_cache_changed

# The most items one press adds, as many as a bulk add takes
MAX_ADDED_PER_PRESS = MAX_BULK_UPDATE_TRANSACTIONS


def _nothing_added() -> ApproveAllReviewItemsResponse:
    """Return the answer of a press that added nothing"""
    return ApproveAllReviewItemsResponse(added_ids=[], account_ids=[], more_to_add=False)


async def _pick_addable(db: AsyncSession, user_id: uuid.UUID, scope: Sequence[ColumnElement[bool]], limit: int) -> tuple[list[uuid.UUID], bool]:
    """Pick the newest candidates that can be added, and say whether more than the limit can"""
    picked: list[uuid.UUID] = []
    async with aclosing(stream_candidates(db, scope, newest_first=True)) as chunks:
        async for items in chunks:
            picked.extend(item.id for item in await keep_addable(db, user_id, items))

            # One past the limit is enough to know more are left
            if len(picked) > limit:
                break
    return picked[:limit], len(picked) > limit


async def approve_all_review_items(db: AsyncSession, user: User, request: ApproveAllReviewItemsRequest) -> ApproveAllReviewItemsResponse:
    """Add the waiting new items whose saved values give a merchant and a fitting category to the ledger, with those values and no notes

    The items of an account the installed check keeps read-only stay waiting, since nothing can be added to it

    Args:
        db: Active database session
        user: The user reviewing
        request: The accounts the list shows

    Returns:
        The items added, the accounts they went to, and whether more are left to add than one press takes

    Raises:
        HTTPException 403: An account is visible but isn't the user's own personal account
        HTTPException 404: An account isn't visible to the user
        HTTPException 422: Any write of an item failed, so nothing was added
    """
    scope = await own_personal_accounts_scope(
        db, user.id, request.account_ids, BankTransaction.account_id, not_own_detail=REVIEW_NOT_OWN_DETAIL
    )
    scope = [*scope, *await writable_accounts_scope(db, user)]

    # Read with no lock, so a sync is never held up while thousands of items are read. Only the ids picked here are locked
    picked, more_to_add = await _pick_addable(db, user.id, scope, MAX_ADDED_PER_PRESS)
    if not picked:
        return _nothing_added()

    rows, links = await lock_bank_transactions(db, user, BankTransaction.id.in_(picked))
    waiting = [(record, account) for record, account in rows if record.disposition == BankTransactionDisposition.AWAITING_REVIEW]
    items = [saved_item_of(record, account.is_archived) for record, account in waiting]
    targets = await read_saved_targets(db, user.id, items)
    chosen = []
    for (record, account), item in zip(waiting, items, strict=True):
        fill = read_saved_fill(item, targets)
        if is_addable(item, fill):
            chosen.append((record, account, fill))
    if not chosen:
        return _nothing_added()

    account_order = {account_id: place for place, account_id in enumerate(sort_by_snapshot_lock(account.id for _, account, _ in chosen))}
    for record, account, fill in sorted(chosen, key=lambda row: (account_order[row[1].id], row[0].id)):
        entry = TransactionEntry(
            dt=record.observed_date,
            amount=record.observed_amount,
            merchant_id=fill.merchant.value,
            category_id=fill.category.value,
            tag_ids=[tag.value for tag in fill.tags],
        )
        await write_new_item(db, user, record, account, entry)

    await lift_review_pauses(db, user.id, links)
    await mark_user_cache_changed(db, user.id)
    await db.commit()
    newest_first = {item_id: place for place, item_id in enumerate(picked)}
    return ApproveAllReviewItemsResponse(
        added_ids=sorted((record.id for record, _, _ in chosen), key=newest_first.__getitem__),
        account_ids=sorted({account.id for _, account, _ in chosen}),
        more_to_add=more_to_add,
    )
