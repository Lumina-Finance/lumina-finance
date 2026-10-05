"""Keeping transactions written by hand or from a file out of the days a linked account's bank supplies

Once an account is linked, its bank supplies its transactions from the import start through today,
in the user's profile timezone, so a transaction written any other way on one of those days would
duplicate bank data. Every write that dates a transaction checks here, except a bank import itself:
creating one, an edit that changes its date or account, a bulk edit, both import commits and the
starting balance. Earlier days and future days stay open, and none of it applies once the account is
unlinked. A bank-imported transaction keeps an editable date, but can't leave its account while the
account is linked, and a linked account can't be archived, since archiving writes an adjustment
dated today.

A link counts from the moment it exists, whether its bank account is active or waiting to be chosen
again. Every check locks the accounts it reads the links of, in a mode a link request's own lock on
the account waits for, so a write and a link made at the same time never both go through: the link
either sees the write's transactions when it works out where its import may start, or the write
sees the link
"""

import uuid
from collections.abc import Iterable, Mapping, Sequence
from datetime import date, datetime
from typing import NamedTuple

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankLinkState, BankProvider
from app.models.bank_transaction import BankTransaction
from app.models.user import User
from app.services.bank_sync.availability import PROVIDER_ADAPTERS
from app.utils.dates import format_day, resolve_timezone

_LIVE_LINK = BankAccountLink.state != BankLinkState.UNLINKED


class LedgerEdit(NamedTuple):
    """One transaction's account and date before an edit and once it applies"""

    transaction_id: uuid.UUID
    account_id: uuid.UUID
    dt: date
    new_account_id: uuid.UUID
    new_dt: date


class _LiveLink(NamedTuple):
    """The provider a linked account follows and the day its bank import starts"""

    provider: BankProvider
    import_start: date


async def refuse_days_a_bank_supplies(db: AsyncSession, user: User, dates_by_account: Mapping[uuid.UUID, Iterable[date]]) -> None:
    """Refuse new transactions dated on days a linked account's bank supplies

    Args:
        db: Active database session
        user: The user writing, whose profile timezone sets today
        dates_by_account: The dates of the transactions to be written, by the account each lands in

    Raises:
        HTTPException 422: A transaction lands on a linked account from its import start through
            today, saying which provider supplies those days, or the user's timezone isn't
            recognized when one of the accounts is linked
    """
    if not dates_by_account:
        return
    links = await _read_live_links(db, dates_by_account.keys())
    if not links:
        return
    today = _today(user)
    for account_id in sorted(links):
        _refuse_supplied_days(links[account_id], dates_by_account[account_id], today=today)


async def refuse_edits_a_bank_supplies(db: AsyncSession, user: User, edits: Sequence[LedgerEdit]) -> None:
    """Refuse edits that date a transaction on days a linked account's bank supplies, or take a bank-imported one out of its linked account

    Only a changed date or account is checked, so an edit leaving both alone saves wherever the
    transaction sits. A bank-imported transaction's date is the bank's to correct, so it is not
    checked while the transaction stays in its account. Moved out of an account no longer linked, it
    is checked like any other transaction arriving in the account it moves to

    Args:
        db: Active database session
        user: The user editing, whose profile timezone sets today
        edits: Each edited transaction's account and date before the edit and once it applies

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
                provider_name = PROVIDER_ADAPTERS[source_link.provider].provider_name
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"Transactions from {provider_name} can't move to another account while this account is linked",
                )
            if not moved:
                continue
        target_link = links.get(edit.new_account_id)
        if target_link is not None:
            _refuse_supplied_days(target_link, [edit.new_dt], today=today)


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
    provider = await db.scalar(select(BankAccountLink.provider).where(BankAccountLink.account_id == account.id, _LIVE_LINK))
    if provider is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"This account can't be archived while it's linked to {PROVIDER_ADAPTERS[provider].provider_name}. Unlink it first",
        )


async def _read_live_links(db: AsyncSession, account_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, _LiveLink]:
    """Lock the accounts shared and return the live link of each one linked

    A shared lock waits for a link request's lock on the account and holds the next link request
    back until this write commits. Taken in id order, so writes over several accounts queue behind
    each other rather than deadlocking
    """
    ids = sorted(set(account_ids))
    await db.execute(select(Account.id).where(Account.id.in_(ids)).order_by(Account.id).with_for_update(read=True))
    rows = await db.execute(
        select(BankAccountLink.account_id, BankAccountLink.provider, BankAccountLink.import_start).where(
            BankAccountLink.account_id.in_(ids), _LIVE_LINK
        )
    )
    return {account_id: _LiveLink(provider, import_start) for account_id, provider, import_start in rows}


def _today(user: User) -> date:
    """Return today in the user's profile timezone, where every import start is a calendar day"""
    return datetime.now(resolve_timezone(user.tz)).date()


def _refuse_supplied_days(link: _LiveLink, dates: Iterable[date], *, today: date) -> None:
    """Refuse any date from a link's import start through today

    Raises:
        HTTPException 422: One of the dates is supplied by the link's bank
    """
    if any(link.import_start <= day <= today for day in dates):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"{PROVIDER_ADAPTERS[link.provider].provider_name} supplies this account's transactions "
                f"from {format_day(link.import_start)} to today"
            ),
        )
