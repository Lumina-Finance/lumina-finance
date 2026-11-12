"""Replacing an account's pending bank transactions

A stale pending item left behind would show a hold the bank already posted or dropped, and a
replacement reaching another account would wipe pending items its own failed fetch should keep
"""

from sqlalchemy import select

from app.models.bank_pending_transaction import BankPendingTransaction
from app.models.currency import Currency
from app.services.bank_sync.pending import replace_pending_transactions
from tests.routes.support.bank_sync_helpers import _build_account, _build_pending_transaction, _build_user


async def test_replace_pending_transactions_removes_stale_items_and_spares_other_accounts(db):
    """Everyday's posted and dropped holds go, and Rewards Visa keeps its earlier items"""
    db.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
    await db.flush()
    user = _build_user("pending@example.com")
    db.add(user)
    await db.flush()
    everyday = _build_account(user.id, "Everyday")
    rewards = _build_account(user.id, "Rewards Visa")
    db.add_all([everyday, rewards])
    await db.flush()
    db.add_all(
        [
            _build_pending_transaction(everyday, "P-STILL"),
            _build_pending_transaction(everyday, "P-POSTED"),
            _build_pending_transaction(everyday, "P-DROPPED"),
            _build_pending_transaction(rewards, "P-VISA"),
        ]
    )
    await db.flush()

    await replace_pending_transactions(
        db,
        everyday.id,
        [_build_pending_transaction(everyday, "P-STILL"), _build_pending_transaction(everyday, "P-NEW")],
    )

    remaining = (await db.execute(select(BankPendingTransaction.account_id, BankPendingTransaction.description))).all()
    assert sorted(remaining) == sorted(
        [
            (everyday.id, "P-STILL"),
            (everyday.id, "P-NEW"),
            (rewards.id, "P-VISA"),
        ]
    )


async def test_replace_pending_transactions_with_nothing_clears_the_account(db):
    """An empty set leaves the account with no pending items, as unlinking and disconnecting need"""
    db.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
    await db.flush()
    user = _build_user("pending@example.com")
    db.add(user)
    await db.flush()
    everyday = _build_account(user.id)
    db.add(everyday)
    await db.flush()
    db.add(_build_pending_transaction(everyday, "P-1"))
    await db.flush()

    await replace_pending_transactions(db, everyday.id, [])

    assert (await db.scalars(select(BankPendingTransaction.id))).all() == []
