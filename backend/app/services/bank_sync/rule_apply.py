"""Putting every waiting new item through the person's import rules as they stand now, and saving the result

The press covers every waiting new item in the person's own personal accounts, whatever accounts the
list shows, since the rules are the person's. The ids are read with no lock. Then, a chunk at a time,
the rows are locked by id in id order and nothing else is, because an account's link is held by a
sync for its whole write and this press lifts no review pause. Rows alone in id order can't deadlock
with the writers that take links and then rows in id order. What was decided meanwhile is left out
once the lock is held. Each chunk is committed, so a long press never holds many rows at once

A sync and a press may interleave. Each write stores a fill with the digest of the rules that gave
it, so an older fill written late leaves the offer up and the next press settles it. An item whose
values change is saved by the ORM and so moves its version. One whose values come out the same only
takes the new digest, by an update that leaves the version alone, so a selection made before the
press is still taken by a bulk add or dismissal
"""

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition
from app.models.user import User
from app.schemas.bank_review import ApplyImportRulesResponse
from app.services.accounts.access import own_personal_account_condition
from app.services.bank_sync import rule_fills
from app.services.bank_sync.review_state import AWAITING_REVIEW
from app.services.bank_sync.rule_fills import candidate_of, fill_items, fill_to_saved, load_rule_fill_context
from app.services.cache_state import mark_user_status_changed


async def _read_waiting_ids(db: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    """Read the ids of the waiting new items of the person's own personal accounts in id order, with no lock"""
    rows = await db.scalars(
        select(BankTransaction.id)
        .join(Account, Account.id == BankTransaction.account_id)
        .where(AWAITING_REVIEW, own_personal_account_condition(user_id))
        .order_by(BankTransaction.id)
    )
    return list(rows)


async def _apply_to_chunk(db: AsyncSession, user_id: uuid.UUID, ids: Sequence[uuid.UUID], context: rule_fills.RuleFillContext) -> int:
    """Lock a chunk of items, save what the rules give each and commit, returning how many items' values changed"""
    rows = await db.execute(
        select(BankTransaction, Account.currency)
        .join(Account, Account.id == BankTransaction.account_id)
        .where(BankTransaction.id.in_(ids), own_personal_account_condition(user_id))
        .order_by(BankTransaction.id)
        .with_for_update(of=BankTransaction)
        .execution_options(populate_existing=True)
    )

    # Decided elsewhere before the lock was granted, so left alone
    waiting = [(record, currency) for record, currency in rows if record.disposition == BankTransactionDisposition.AWAITING_REVIEW]
    if not waiting:
        await db.rollback()
        return 0
    saved: list[dict[str, Any] | None] = [None] * len(waiting)
    if context.has_rules:
        fills = await fill_items(context, [candidate_of(record, currency) for record, currency in waiting])
        saved = [fill_to_saved(fill) for fill in fills]

    changed = 0
    digest_only: list[uuid.UUID] = []
    for (record, _), values in zip(waiting, saved, strict=True):
        if record.rule_fill != values:
            record.rule_fill = values
            record.rules_version = context.version
            changed += 1
        elif record.rules_version != context.version:
            digest_only.append(record.id)
    if digest_only:
        await db.execute(
            update(BankTransaction)
            .where(BankTransaction.id.in_(digest_only))
            .values(rules_version=context.version)
            .execution_options(synchronize_session=False)
        )
    # A new digest alone changes what the list says about the rules, so it refreshes the list too. The
    # press changes none of the ledger, so the data mark an import's undo compares with stays where it was
    if changed or digest_only:
        await mark_user_status_changed(db, user_id)
    await db.commit()
    return changed


async def apply_import_rules_to_review_items(db: AsyncSession, user: User) -> ApplyImportRulesResponse:
    """Put every waiting new item of the user's own accounts through their import rules and save the values

    Args:
        db: Active database session
        user: The user reviewing

    Returns:
        How many waiting items' saved values differ after the press

    Raises:
        HTTPException 409: A rule names a category that is gone, which is a rule changed at that moment
    """
    # Kept apart from the user, whose attributes a rollback or commit expires
    user_id = user.id
    ids = await _read_waiting_ids(db, user_id)
    if not ids:
        return ApplyImportRulesResponse(changed_count=0)

    # Read after the ids, so the digest saved is of rules at least as new as the items it covers
    context = await load_rule_fill_context(db, user_id)
    await db.rollback()
    changed = 0
    chunk_size = rule_fills.SCAN_CHUNK_SIZE
    for start in range(0, len(ids), chunk_size):
        changed += await _apply_to_chunk(db, user_id, ids[start : start + chunk_size], context)
    return ApplyImportRulesResponse(changed_count=changed)
