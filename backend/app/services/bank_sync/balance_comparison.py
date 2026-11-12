"""Comparing the bank's balance for a linked account with the ledger's

The bank's figure is its balance as of its balance date, from the latest listing or sync that read
the bank account. The ledger's is the account's balance at the end of that date in the owner's profile
timezone, so transactions dated later, future-dated ones included, are left out. The comparison only
informs: a difference never adjusts the ledger or changes a total unless the user records the
balance match it offers. The bank's balance already holds the items still waiting for review, so
the match leaves out what approving them would change by that date, and the ledger matches the
bank once they are approved
"""

import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankAccountLink, BankExternalAccount, BankLinkState
from app.models.bank_transaction import BankTransaction
from app.models.transaction import Transaction
from app.schemas.bank_sync import BalanceMatchResponse, BankBalanceResponse
from app.services.accounts.snapshots import get_current_balances
from app.services.bank_sync.review_state import IS_REVIEW_ITEM, LedgerEntry, approved_entry
from app.utils.dates import resolve_timezone


async def compare_bank_balance(db: AsyncSession, link: BankAccountLink, *, tz: str) -> BankBalanceResponse | None:
    """Return a live link's bank balance beside its account's ledger balance on the bank's balance date

    This is the one place the bank's balance meets the ledger's. The bank's keeps the sign it was
    sent with. That takes the provider to report what a card or loan owes as a negative balance, the
    sign the ledger keeps a liability in. Its balance date is taken as the moment the balance was
    read. That moment's day is the owner's, not a bank date like a posted stamp at noon UTC. Neither is
    checked against a real provider's data yet

    Args:
        db: The owner's session
        link: A live link
        tz: The owner's profile timezone

    Returns:
        The balances and the ledger against the bank. None until the link first syncs, and while it
        waits for its bank account to be chosen again, since the provider may list another account or
        another currency under it by then, or while the bank gives no balance date

    Raises:
        HTTPException 422: The profile's timezone no longer resolves
    """
    if link.state != BankLinkState.ACTIVE or link.last_success_at is None:
        return None
    bank_account = await db.scalar(
        select(BankExternalAccount).where(
            BankExternalAccount.connection_id == link.connection_id,
            BankExternalAccount.external_id == link.external_account_id,
        )
    )
    if bank_account is None or bank_account.balance_at is None:
        return None

    balance_day = read_balance_day(bank_account.balance_at, tz=tz)
    ledger_balances = await get_current_balances(db, [link.account_id], balance_day)
    ledger_balance = ledger_balances.get(link.account_id, 0)
    return BankBalanceResponse(
        amount=bank_account.balance,
        available=bank_account.available_balance,
        available_unreadable=bank_account.available_balance_unreadable,
        balance_date=bank_account.balance_at,
        ledger_balance=ledger_balance,
        difference=None if bank_account.balance is None else ledger_balance - bank_account.balance,
    )


def read_balance_day(balance_at: datetime, *, tz: str) -> date:
    """Return the owner's day the bank's balance is as of. The ledger is compared at the end of that day

    Raises:
        HTTPException 422: The profile's timezone no longer resolves
    """
    return balance_at.astimezone(resolve_timezone(tz)).date()


def match_adjustment_date(link: BankAccountLink) -> date:
    """Return the day a balance match is recorded on: the day before the import start, the latest the bank doesn't supply

    The check on the days a bank supplies never applies to that day
    """
    return link.import_start - timedelta(days=1)


async def describe_balance_match(
    db: AsyncSession, link: BankAccountLink, balance: BankBalanceResponse | None, *, tz: str
) -> BalanceMatchResponse | None:
    """Return the balance adjustment that brings the link's ledger to the bank's balance once the items waiting are approved

    The offer is read afresh each time, so it follows every change to the ledger, the bank's balance
    and the items waiting, and it returns after a match whenever a new gap opens

    Args:
        db: The owner's session
        link: A live link
        balance: What compare_bank_balance returned for it
        tz: The owner's profile timezone

    Returns:
        The match, or None while an import runs, the balances don't compare, what approving the items
        waiting would change isn't known, or there is nothing to record

    Raises:
        HTTPException 422: The profile's timezone no longer resolves
    """
    if link.importing or balance is None or balance.difference is None:
        return None
    waiting = await sum_waiting_changes(db, link.account_id, through=read_balance_day(balance.balance_date, tz=tz))
    if waiting is None:
        return None
    amount = -balance.difference - waiting
    if amount == 0:
        return None
    return BalanceMatchResponse(amount=amount, waiting_amount=waiting, adjustment_date=match_adjustment_date(link))


async def sum_waiting_changes(db: AsyncSession, account_id: uuid.UUID, *, through: date) -> int | None:
    """Return how much approving the account's items waiting for review as the bank sent them would move its balance at the end of a day

    Each item counts as the ledger row approving it leaves less the row it has now, each only when
    dated by the end of the day, so an item dated later moves nothing and one moved past the day
    gives its amount back

    Args:
        db: The owner's session
        account_id: The account
        through: The last day the balance takes in

    Returns:
        Signed minor units, or None when an item dated by the end of the day has a bank amount the
        account's currency can't hold, since the amount the user gives it isn't known yet
    """
    rows = await db.execute(
        select(BankTransaction, Transaction.dt, Transaction.amount)
        .outerjoin(Transaction, Transaction.id == BankTransaction.transaction_id)
        .where(BankTransaction.account_id == account_id, IS_REVIEW_ITEM)
    )
    total = 0
    for record, ledger_date, ledger_amount in rows:
        ledger = None if record.transaction_id is None else LedgerEntry(ledger_date, ledger_amount)
        approved = approved_entry(record, ledger)
        if approved is not None and approved.amount is None and approved.dt <= through:
            return None
        total += _amount_through(approved, through) - _amount_through(ledger, through)
    return total


def _amount_through(entry: LedgerEntry | None, through: date) -> int:
    """Return a ledger row's amount when it is dated by the end of the day, otherwise zero"""
    return entry.amount if entry is not None and entry.dt <= through else 0
