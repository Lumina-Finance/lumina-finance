"""Adding every waiting new item the user's import rules give a merchant and a category, in one save

The press has no preview, so it only runs against the rules the list showed: the version the list
answered with is sent back, and rules changed since refuse the whole press before anything is written.
It takes new items only, never a correction or a removal, over the accounts the list shows. The
waiting items are read without a lock, newest first, and the first 1,000 the rules can add are
locked by their ids in the single decisions' order, connections and links, then bank transactions in
id order. What was decided elsewhere before the lock is left out, and the rest are matched again as
the lock read them, so an item a sync changed meanwhile is added as it now stands. Items are then
written account by account, in the order the bulk add takes, and one failure of any write undoes
the whole press
"""

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_transaction import BankTransaction, BankTransactionDisposition
from app.models.user import User
from app.schemas.bank_review import ApplyImportRulesRequest, ApplyImportRulesResponse
from app.schemas.transaction import MAX_BULK_UPDATE_TRANSACTIONS, TransactionEntry
from app.services.accounts.access import own_personal_accounts_scope
from app.services.accounts.snapshots import sort_by_snapshot_lock
from app.services.bank_sync.review_decisions import lock_bank_transactions, write_new_item
from app.services.bank_sync.review_items import REVIEW_NOT_OWN_DETAIL
from app.services.bank_sync.review_pause import lift_review_pauses
from app.services.bank_sync.rule_fills import (
    fill_items,
    is_addable,
    load_rule_fill_context,
    pick_addable,
    stream_waiting_items,
    waiting_item_of,
)
from app.services.cache_state import mark_user_cache_changed

# The most items one press adds, as many as a bulk add takes
MAX_ADDED_PER_PRESS = MAX_BULK_UPDATE_TRANSACTIONS

# Answered when the rules changed since the list the press was made from loaded
RULES_CHANGED_DETAIL = "Your import rules changed, so nothing was added"


def _nothing_added() -> ApplyImportRulesResponse:
    """Return the answer of a press that added nothing"""
    return ApplyImportRulesResponse(added_ids=[], account_ids=[], more_to_add=False)


async def apply_import_rules_to_review_items(db: AsyncSession, user: User, request: ApplyImportRulesRequest) -> ApplyImportRulesResponse:
    """Add the waiting new items the rules give a merchant and a fitting category to the ledger, with those values and no notes

    Args:
        db: Active database session
        user: The user reviewing
        request: The accounts the list shows and the version of the rules it answered with

    Returns:
        The items added, the accounts they went to, and whether more are left to add than one press takes

    Raises:
        HTTPException 403: An account is visible but isn't the user's own personal account
        HTTPException 404: An account isn't visible to the user
        HTTPException 409: The rules changed since the list loaded, so nothing was added
        HTTPException 422: Any write of an item failed, so nothing was added
    """
    scope = await own_personal_accounts_scope(
        db, user.id, request.account_ids, BankTransaction.account_id, not_own_detail=REVIEW_NOT_OWN_DETAIL
    )
    context = await load_rule_fill_context(db, user.id)
    if context.version != request.rules_version:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=RULES_CHANGED_DETAIL)
    if not context.has_rules:
        return _nothing_added()

    # Read with no lock, so a sync is never held up while thousands of items are matched. Only the ids
    # picked here are locked
    picked, more_to_add = await pick_addable(stream_waiting_items(db, scope, newest_first=True), context, MAX_ADDED_PER_PRESS)
    if not picked:
        return _nothing_added()

    rows, links = await lock_bank_transactions(db, user, BankTransaction.id.in_(picked))
    waiting = [(record, account) for record, account in rows if record.disposition == BankTransactionDisposition.AWAITING_REVIEW]
    items = [waiting_item_of(record, account.currency, account.is_archived) for record, account in waiting]
    chosen = [
        (record, account, fill)
        for (record, account), item, fill in zip(waiting, items, await fill_items(context, items), strict=True)
        if is_addable(item, fill)
    ]
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
    return ApplyImportRulesResponse(
        added_ids=sorted((record.id for record, _, _ in chosen), key=newest_first.__getitem__),
        account_ids=sorted({account.id for _, account, _ in chosen}),
        more_to_add=more_to_add,
    )
