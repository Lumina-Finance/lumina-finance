"""Comparing the bank's balance for a linked account with the ledger's

The bank's figure is its balance as of its balance date, from the latest listing or sync that read
the bank account. The ledger's is the account's balance at the end of that date in the owner's profile
timezone, so transactions dated later, future-dated ones included, are left out. The comparison only
informs: a difference never adjusts the ledger or changes a total
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankAccountLink, BankExternalAccount, BankLinkState
from app.schemas.bank_sync import BankBalanceResponse
from app.services.accounts.snapshots import get_current_balances
from app.utils.dates import resolve_timezone


async def compare_bank_balance(db: AsyncSession, link: BankAccountLink, *, tz: str) -> BankBalanceResponse | None:
    """Return a live link's bank balance beside its account's ledger balance on the bank's balance date

    This is the one place the bank's balance meets the ledger's. The bank's keeps the sign it was
    sent with, which takes the provider to report what a card or loan owes as a negative balance, the
    sign the ledger keeps a liability in. Its balance date is taken as the moment the balance was
    read, whose day is the owner's, not a bank date like a posted stamp at noon UTC. Neither is
    checked against real SimpleFIN Bridge data yet

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

    balance_day = bank_account.balance_at.astimezone(resolve_timezone(tz)).date()
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
