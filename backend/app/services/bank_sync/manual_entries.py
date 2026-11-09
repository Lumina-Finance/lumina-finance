"""Keeping transactions written by hand or from a file out of the days a linked account's bank supplies

Once an account is linked, its bank supplies its transactions from the import start through today,
in the user's profile timezone, so a transaction written any other way on one of those days would
duplicate bank data. Every write that dates a transaction checks here, except a bank import itself:
creating one, an edit that changes its date or account, a bulk edit, both import commits and the
starting balance. Earlier days and future days stay open, and none of it applies once the account is
unlinked. A bank-imported transaction keeps an editable date, but can't leave its account or be
deleted while the account is linked, since only a bank removal the user approves takes it out of the
ledger then, and a linked account can't be archived, since archiving writes an adjustment dated
today. Moved out or deleted once the account is unlinked, a bank-imported transaction leaves the
bank: its bank transaction is deleted, so nothing the bank later says about it reaches the account
it moved to, and the bank sending it again brings it in as a new item.

A link counts from the moment it exists, whether its bank account is active or waiting to be chosen
again. Every check locks the accounts it reads the links of, in a mode a link request's own lock on
the account waits for, so a write and a link made at the same time never both go through: the link
either sees the write's transactions when it works out where its import may start, or the write
sees the link
"""

import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence
from datetime import date, datetime
from typing import NamedTuple

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection
from app.models.bank_transaction import BankTransaction
from app.models.transaction import Transaction
from app.models.user import User
from app.services.bank_sync.availability import LIVE_LINK, provider_label, read_provider_labels
from app.utils.dates import format_day, resolve_timezone


class LedgerEdit(NamedTuple):
    """One transaction's account and date before an edit and once it applies"""

    transaction_id: uuid.UUID
    account_id: uuid.UUID
    dt: date
    new_account_id: uuid.UUID
    new_dt: date


class _LiveLink(NamedTuple):
    """A linked account's name, the name of the provider it follows and the day its bank import starts"""

    account_name: str
    provider_name: str
    import_start: date


async def refuse_days_a_bank_supplies(
    db: AsyncSession,
    user: User,
    entries: Iterable[tuple[uuid.UUID, date]],
    *,
    name_accounts: bool = False,
) -> None:
    """Refuse new transactions dated on days a linked account's bank supplies

    Args:
        db: Active database session
        user: The user writing. Their profile timezone sets today
        entries: The account each transaction to be written lands in, with its date
        name_accounts: Whether a refusal names the account, for a write that can cover more than
            one, since "this account" wouldn't say which

    Raises:
        HTTPException 422: A transaction lands on a linked account from its import start through
            today, saying which provider supplies those days, or the user's timezone isn't
            recognized when one of the accounts is linked
    """
    dates_by_account: dict[uuid.UUID, list[date]] = defaultdict(list)
    for account_id, day in entries:
        dates_by_account[account_id].append(day)
    if not dates_by_account:
        return
    links = await _read_live_links(db, dates_by_account.keys())
    if not links:
        return
    today = _today(user)
    for account_id in sorted(links):
        _refuse_supplied_days(links[account_id], dates_by_account[account_id], today=today, name_account=name_accounts)


async def refuse_edits_a_bank_supplies(db: AsyncSession, user: User, edits: Sequence[LedgerEdit], *, name_accounts: bool = False) -> None:
    """Refuse edits that date a transaction on days a linked account's bank supplies, or take a bank-imported one out of its linked account

    Only a changed date or account is checked, so an edit leaving both alone saves wherever the
    transaction sits. A bank-imported transaction's date is the bank's to correct, so it is not
    checked while the transaction stays in its account. Moved out of an account no longer linked, it
    is checked like any other transaction arriving in the account it moves to. A move out of a
    linked account is refused naming that account, since the edit is about to leave it

    Args:
        db: Active database session
        user: The user editing. Their profile timezone sets today
        edits: Each edited transaction's account and date before the edit and once it applies
        name_accounts: Whether a refused date names the account, for an edit that can cover more
            than one, since "this account" wouldn't say which

    Raises:
        HTTPException 422: A bank-imported transaction would leave its linked account, an edit
            dates a transaction on a linked account from its import start through today, or the
            user's timezone isn't recognized when one of the accounts is linked
    """
    changed = [edit for edit in edits if (edit.new_account_id, edit.new_dt) != (edit.account_id, edit.dt)]
    if not changed:
        return
    links = await _read_live_links(db, {edit.account_id for edit in changed} | {edit.new_account_id for edit in changed})
    if not links:
        return
    today = _today(user)
    bank_imported = set(
        await db.scalars(
            select(BankTransaction.transaction_id).where(BankTransaction.transaction_id.in_([edit.transaction_id for edit in changed]))
        )
    )
    for edit in changed:
        moved = edit.new_account_id != edit.account_id
        if edit.transaction_id in bank_imported:
            source_link = links.get(edit.account_id)
            if moved and source_link is not None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"Transactions from {source_link.provider_name} can't move out of {source_link.account_name} while it's linked",
                )
            if not moved:
                continue
        target_link = links.get(edit.new_account_id)
        if target_link is not None:
            _refuse_supplied_days(target_link, [edit.new_dt], today=today, name_account=name_accounts)


async def lock_bank_imports(db: AsyncSession, transaction_ids: Iterable[uuid.UUID]) -> None:
    """Lock the bank transactions of these ledger transactions in id order, before the caller locks the ledger transactions

    A delete or a move takes a bank-imported transaction's bank transaction with it, and the sync
    and the review decisions lock a bank transaction before its ledger transaction, so taking them
    in that order here queues a delete or move behind a decision rather than deadlocking with it

    Args:
        db: Active database session
        transaction_ids: The ledger transactions about to be deleted or moved
    """
    await db.execute(
        select(BankTransaction.id).where(BankTransaction.transaction_id.in_(transaction_ids)).order_by(BankTransaction.id).with_for_update()
    )


async def detach_moved_bank_imports(db: AsyncSession, edits: Sequence[LedgerEdit]) -> None:
    """Delete the bank transaction of each bank-imported transaction these edits move to another account, with any review item open on it

    Called after refuse_edits_a_bank_supplies. That refused a move out of a linked account and
    holds the accounts against a new link, so no sync writes these bank transactions meanwhile

    Args:
        db: Active database session
        edits: Each edited transaction's account and date before the edit and once it applies
    """
    moved = [edit.transaction_id for edit in edits if edit.new_account_id != edit.account_id]
    if moved:
        await db.execute(delete(BankTransaction).where(BankTransaction.transaction_id.in_(moved)))


async def refuse_deleting_bank_imports(db: AsyncSession, transactions: Sequence[Transaction], *, in_bulk: bool = False) -> None:
    """Refuse to delete a bank-imported transaction while its account is linked

    Bank sync's own removals don't come through here, so a bank removal the user approves still
    deletes the transaction while the account stays linked

    Args:
        db: Active database session
        transactions: The transactions about to be deleted, locked by the caller
        in_bulk: Whether they were selected to delete together. The refusal speaks of them as
            several, as it does a move of several

    Raises:
        HTTPException 422: A bank-imported transaction's account is linked, naming the provider it
            came from and the account
    """
    rows = await db.execute(
        select(BankTransaction.transaction_id, BankTransaction.provider).where(
            BankTransaction.transaction_id.in_([txn.id for txn in transactions])
        )
    )
    providers = dict(rows.all())
    if not providers:
        return
    links = await _read_live_links(db, {txn.account_id for txn in transactions if txn.id in providers})
    names = await read_provider_labels(db, providers.values())
    for txn in transactions:
        link = links.get(txn.account_id)
        if txn.id in providers and link is not None:
            provider_name = names[providers[txn.id]]
            detail = (
                f"Transactions from {provider_name} can't be deleted from {link.account_name} while it's linked"
                if in_bulk
                else f"Imported from {provider_name}. While {link.account_name} is linked, edit it rather than deleting it"
            )
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


async def refuse_archiving_a_linked_account(db: AsyncSession, account: Account) -> None:
    """Refuse to archive an account while it is linked

    The account is locked the way a link request locks it, so a link being made finishes first and
    is seen here, or waits and finds the account archived

    Args:
        db: Active database session
        account: Account being archived

    Raises:
        HTTPException 422: The account is linked, saying to which provider
    """
    await db.execute(select(Account.id).where(Account.id == account.id).with_for_update(key_share=True))
    linked = (
        await db.execute(
            select(BankAccountLink.provider, BankConnection.provider_name)
            .join(BankConnection, BankConnection.id == BankAccountLink.connection_id)
            .where(BankAccountLink.account_id == account.id, LIVE_LINK)
        )
    ).first()
    if linked is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"This account can't be archived while it's linked to {provider_label(*linked)}. Unlink it first",
        )


async def _read_live_links(db: AsyncSession, account_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, _LiveLink]:
    """Lock the accounts shared and return the live link of each one linked

    A shared lock waits for a link request's lock on the account and holds the next link request
    back until this write commits. Taken in id order, so writes over several accounts queue behind
    each other rather than deadlocking
    """
    ids = sorted(set(account_ids))
    await db.execute(select(Account.id).where(Account.id.in_(ids)).order_by(Account.id).with_for_update(read=True))
    # A live link always has its connection. The connection stored the provider's name
    rows = await db.execute(
        select(BankAccountLink.account_id, Account.name, BankAccountLink.provider, BankConnection.provider_name, BankAccountLink.import_start)
        .join(Account, Account.id == BankAccountLink.account_id)
        .join(BankConnection, BankConnection.id == BankAccountLink.connection_id)
        .where(BankAccountLink.account_id.in_(ids), LIVE_LINK)
    )
    return {
        account_id: _LiveLink(name, provider_label(provider, stored_name), import_start)
        for account_id, name, provider, stored_name, import_start in rows
    }


def _today(user: User) -> date:
    """Return today in the user's profile timezone, since every import start is a calendar day"""
    return datetime.now(resolve_timezone(user.tz)).date()


def _refuse_supplied_days(link: _LiveLink, dates: Iterable[date], *, today: date, name_account: bool) -> None:
    """Refuse any date from a link's import start through today, naming the account when asked

    Raises:
        HTTPException 422: One of the dates is supplied by the link's bank
    """
    if any(link.import_start <= day <= today for day in dates):
        transactions = f"the transactions in {link.account_name}" if name_account else "this account's transactions"
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"{link.provider_name} supplies {transactions} from {format_day(link.import_start)} to today",
        )
