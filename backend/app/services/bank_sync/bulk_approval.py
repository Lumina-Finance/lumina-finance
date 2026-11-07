"""Approving the waiting bank items in bulk: what it would change, then applying exactly that

Bulk approval covers the corrections and removals of transactions already in the ledger. New items
stay waiting, since each needs a merchant and category no bank item comes with yet, and so does a
correction whose bank amount the account's currency can't hold. Accepting refuses it. The
preview groups the rest by kind, each with its net effect on balances in each currency: a
correction that changes the amount moves its account's balance by the bank's amount less the
ledger's, and a removal by the ledger amount it takes out.

Applying takes the items a preview listed, each at the version it showed, and decides each through
the steps accepting or removing it alone takes, all in one save. A bank transaction's version moves
on every write to it, so an item a sync changed, one decided elsewhere and one a repeated approval
already applied are each left as they are. One a check refuses stays waiting with its writes undone,
and the others still apply.

The locks come in the single decisions' order, links, bank transactions, then ledger transactions,
and every ledger transaction is locked before any is written, in id order as a bulk edit of the
ledger takes them. The items are then written account by account, in the order a rebuild of several
accounts' balances takes their locks, so bulk approval never holds one account's balances while
waiting for another's that such a rebuild holds
"""

import uuid
from collections import defaultdict
from collections.abc import Sequence

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition, OpenReviewKind
from app.models.base import PermissionLevel
from app.models.transaction import Transaction
from app.models.user import User
from app.permissions import check_transaction_access
from app.schemas.bank_review import (
    ApplyBulkApprovalRequest,
    BankReviewItemResponse,
    BulkApprovalGroupResponse,
    BulkApprovalNetEffectResponse,
    BulkApprovalPreviewResponse,
    BulkApprovalResultResponse,
)
from app.services.accounts.access import check_own_personal_accounts, own_personal_account_condition
from app.services.accounts.snapshots import sort_by_snapshot_lock
from app.services.bank_sync.availability import read_provider_labels
from app.services.bank_sync.review_decisions import (
    delete_removed_transaction,
    is_bank_change_storable,
    lock_bank_transactions,
    write_bank_change,
)
from app.services.bank_sync.review_items import REVIEW_NOT_OWN_DETAIL, build_review_item
from app.services.bank_sync.review_state import AWAITING_REVIEW, LedgerEntry, approved_entry
from app.services.cache_state import mark_user_cache_changed

# The kinds bulk approval applies, in the order the preview lists their groups
_GROUP_KINDS = (OpenReviewKind.CORRECTION, OpenReviewKind.REMOVAL)


async def preview_bulk_approval(
    db: AsyncSession,
    user: User,
    *,
    account_ids: Sequence[uuid.UUID] | None,
) -> BulkApprovalPreviewResponse:
    """Return what bulk approval would apply in some of the user's accounts or all of them, and how many new items it leaves waiting

    Args:
        db: Active database session
        user: The user reviewing
        account_ids: The accounts whose items to preview, or None for every account

    Returns:
        A group for each kind with items to apply, and the count of new items in scope

    Raises:
        HTTPException 403: An account is visible but isn't the user's own personal account
        HTTPException 404: An account isn't visible to the user
    """
    scope = [own_personal_account_condition(user.id)]
    if account_ids is not None:
        await check_own_personal_accounts(db, account_ids, user.id, not_own_detail=REVIEW_NOT_OWN_DETAIL)
        scope.append(BankTransaction.account_id.in_(account_ids))

    rows = await db.execute(
        select(BankTransaction, Transaction.dt, Transaction.amount, Account.currency)
        .join(Account, Account.id == BankTransaction.account_id)
        .join(Transaction, Transaction.id == BankTransaction.transaction_id)
        .where(*scope, BankTransaction.open_kind.is_not(None))
        .order_by(BankTransaction.observed_date.desc(), BankTransaction.id.desc())
    )
    rows = rows.all()
    names = await read_provider_labels(db, (record.provider for record, _, _, _ in rows))
    items: defaultdict[str, list[BankReviewItemResponse]] = defaultdict(list)
    net_effects: defaultdict[str, defaultdict[str, int]] = defaultdict(lambda: defaultdict(int))
    for record, ledger_date, ledger_amount, currency in rows:
        if record.open_kind == OpenReviewKind.CORRECTION and not is_bank_change_storable(record):
            continue
        items[record.open_kind].append(build_review_item(record, ledger_date, ledger_amount, names[record.provider]))
        net_effects[record.open_kind][currency] += _balance_change(record, LedgerEntry(ledger_date, ledger_amount))

    excluded_count = await db.scalar(
        select(func.count()).select_from(BankTransaction).join(Account, Account.id == BankTransaction.account_id).where(*scope, AWAITING_REVIEW)
    )
    return BulkApprovalPreviewResponse(
        groups=[
            BulkApprovalGroupResponse(
                kind=kind,
                count=len(items[kind]),
                net_effect=[
                    BulkApprovalNetEffectResponse(currency=currency, amount=amount)
                    for currency, amount in sorted(net_effects[kind].items())
                    if amount != 0
                ],
                items=items[kind],
            )
            for kind in _GROUP_KINDS
            if items[kind]
        ],
        excluded_count=excluded_count,
    )


async def apply_bulk_approval(db: AsyncSession, user: User, request: ApplyBulkApprovalRequest) -> BulkApprovalResultResponse:
    """Accept each correction and remove each transaction a preview listed that is still at the version it showed, in one save

    An item that isn't the user's is left alone and counted nowhere, as one decided since the
    preview is. The cache is marked last when anything was applied

    Args:
        db: Active database session
        user: The user reviewing
        request: The items the preview listed, each at the version it showed

    Returns:
        How many were corrected and removed, how many of those sent still wait for review, and the
        ids of those applied

    Raises:
        HTTPException 409: Another change held a ledger transaction too long, so nothing was applied
    """
    versions = {item.id: item.version for item in request.items}
    rows, _ = await lock_bank_transactions(db, user, BankTransaction.id.in_(versions))
    waiting = [record for record, _ in rows if record.disposition == BankTransactionDisposition.AWAITING_REVIEW or record.open_kind is not None]
    approvable = [(record, account) for record, account in rows if record.open_kind is not None and record.version == versions[record.id]]

    # The steps below lock each ledger transaction again. This already holds those locks
    for transaction_id in sorted(record.transaction_id for record, _ in approvable):
        await check_transaction_access(db, transaction_id, user.id, PermissionLevel.WRITE, lock_for_update=True)

    account_order = {account_id: place for place, account_id in enumerate(sort_by_snapshot_lock(account.id for _, account in approvable))}
    applied = dict.fromkeys(_GROUP_KINDS, 0)
    applied_ids: list[uuid.UUID] = []
    for record, account in sorted(approvable, key=lambda row: (account_order[row[1].id], row[0].id)):
        kind = record.open_kind
        try:
            # A refusal undoes this item's writes alone, so it stays waiting and the others still apply
            async with db.begin_nested():
                if kind == OpenReviewKind.CORRECTION:
                    await write_bank_change(db, user, record, account)
                else:
                    await delete_removed_transaction(db, user, record)
        except HTTPException:
            continue
        applied[kind] += 1
        applied_ids.append(record.id)

    if applied_ids:
        await mark_user_cache_changed(db, user.id)
        await db.commit()
    corrected, removed = applied[OpenReviewKind.CORRECTION], applied[OpenReviewKind.REMOVAL]
    return BulkApprovalResultResponse(
        corrected=corrected,
        removed=removed,
        failed=len(waiting) - corrected - removed,
        applied_ids=applied_ids,
    )


def _balance_change(record: BankTransaction, ledger: LedgerEntry) -> int:
    """Return how much approving an open correction or removal moves its account's balance, in signed minor units"""
    approved = approved_entry(record, ledger)
    return (0 if approved is None else approved.amount) - ledger.amount
