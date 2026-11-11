"""Bank holds: booked records of no amount, listed for awareness and kept out of review and the ledger

A zero amount can't be approved or put in the ledger, so a booked record of exactly zero is stored
here instead of as a review item. Holds follow the bank within the days a sync fetched: one the bank
no longer reports for those days, reports removed, or gives an amount goes away. Dismissing a hold
stamps it, so the same bank ID reported again stays gone until the bank stops reporting it
"""

import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_connection import BankAccountLink
from app.models.bank_hold import BankHold
from app.models.bank_transaction import BankTransaction
from app.models.user import User
from app.schemas.bank_sync import BankHoldResponse
from app.services.accounts.access import own_personal_account_condition, own_personal_accounts_scope
from app.services.bank_sync.providers.contract import ProviderRecord
from app.services.bank_sync.range_days import RangeImport, brings_in
from app.services.bank_sync.transaction_hash import hash_bank_transaction_id

# Why the list refuses an account the user can see but doesn't own alone
_NOT_OWN_DETAIL = "Bank holds aren't listed for accounts shared with a group"


def is_hold(record: ProviderRecord) -> bool:
    """Return whether a booked record is a hold, meaning its amount is exactly zero

    A record whose amount couldn't be stored exactly has none and waits in review for one instead
    """
    return not record.pending and not record.removed and record.amount == 0


async def store_holds(
    db: AsyncSession,
    deliveries: Sequence[tuple[BankAccountLink, Sequence[ProviderRecord]]],
    *,
    first_day: date,
    last_day: date,
    observed_at: datetime,
    running: RangeImport | None = None,
) -> bool:
    """Make each link's account's holds, within the days fetched, the zero-amount records its bank account came back with

    A hold the response doesn't list for a day it fetched goes, as does one the bank reports removed
    or with an amount. The record then takes the booked path. A dismissed hold the bank still reports
    stays dismissed. A record a booked one would be left out for, dated before the link's import
    start or outside a date range import's days, is left out. The caller locked the links and commits

    Args:
        db: The link owner's session
        deliveries: Each link to store for, with the records its bank account came back with whole
        first_day: The first day the response covers
        last_day: The last day the response covers
        observed_at: When the request that brought the records was sent
        running: The date range import of the one link a range's window was fetched for, or None
            for a routine window

    Returns:
        Whether any hold was added or removed
    """
    changed = False
    for link, records in deliveries:
        reported = {
            hash_bank_transaction_id(link.provider, link.external_account_id, record.external_id): record
            for record in records
            if is_hold(record) and brings_in(link, record.date, running)
        }
        # A record that already has a bank transaction (waiting in review, or in the ledger) stays there
        # and is no hold, so it never shows in two places
        in_review = set(
            await db.scalars(
                select(BankTransaction.external_transaction_hash).where(
                    BankTransaction.account_id == link.account_id,
                    BankTransaction.provider == link.provider,
                    BankTransaction.external_account_id == link.external_account_id,
                    BankTransaction.external_transaction_hash.in_(list(reported)),
                )
            )
        )
        reported = {transaction_hash: record for transaction_hash, record in reported.items() if transaction_hash not in in_review}
        stored = (
            await db.scalars(
                select(BankHold)
                .where(
                    BankHold.account_id == link.account_id,
                    BankHold.provider == link.provider,
                    BankHold.external_account_id == link.external_account_id,
                )
                .with_for_update()
            )
        ).all()
        known = {hold.external_transaction_hash: hold for hold in stored}

        for hold in stored:
            if hold.external_transaction_hash not in reported and first_day <= hold.hold_date <= last_day:
                await db.delete(hold)
                changed = True
        for transaction_hash, record in reported.items():
            hold = known.get(transaction_hash)
            if hold is None:
                db.add(
                    BankHold(
                        owner_id=link.owner_id,
                        account_id=link.account_id,
                        provider=link.provider,
                        external_account_id=link.external_account_id,
                        external_transaction_hash=transaction_hash,
                        hold_date=record.date,
                        description=record.description,
                        observed_at=observed_at,
                    )
                )
                changed = True
            elif hold.dismissed_at is None and (hold.hold_date, hold.description) != (record.date, record.description):
                hold.hold_date = record.date
                hold.description = record.description
                hold.observed_at = observed_at
                changed = True
    await db.flush()
    return changed


async def clear_holds(db: AsyncSession, account_id: uuid.UUID) -> None:
    """Delete every hold of an account, dismissed ones included, for a caller ending or restarting the account's link

    A sync only reaches the account through its live link, so holds left behind would never drop.
    The caller commits

    Args:
        db: The owner's session
        account_id: The account whose holds go
    """
    await db.execute(delete(BankHold).where(BankHold.account_id == account_id))


async def list_holds(
    db: AsyncSession,
    user: User,
    *,
    account_ids: Sequence[uuid.UUID] | None,
) -> list[BankHoldResponse]:
    """Return the undismissed holds of some of the user's accounts, or of all of them, newest first

    Args:
        db: Active database session
        user: The user reading them
        account_ids: The accounts whose holds to list, or None for every account

    Returns:
        The holds, newest first by the bank's date

    Raises:
        HTTPException 403: An account is visible but isn't the user's own personal account
        HTTPException 404: An account isn't visible to the user
    """
    scope = [
        BankHold.dismissed_at.is_(None),
        *await own_personal_accounts_scope(db, user.id, account_ids, BankHold.account_id, not_own_detail=_NOT_OWN_DETAIL),
    ]

    holds = await db.scalars(
        select(BankHold).join(Account, Account.id == BankHold.account_id).where(*scope).order_by(BankHold.hold_date.desc(), BankHold.id.desc())
    )
    return [
        BankHoldResponse(
            id=hold.id,
            account_id=hold.account_id,
            date=hold.hold_date,
            description=hold.description,
            observed_at=hold.observed_at,
        )
        for hold in holds
    ]


async def dismiss_hold(db: AsyncSession, user: User, hold_id: uuid.UUID) -> None:
    """Dismiss one of the user's holds, so the bank reporting it again doesn't bring it back

    Dismissing one already dismissed is accepted and changes nothing

    Args:
        db: Active database session
        user: The owner of the hold's account
        hold_id: The hold

    Raises:
        HTTPException 404: No such hold among the user's own personal accounts' holds
    """
    hold = await db.scalar(
        select(BankHold)
        .join(Account, Account.id == BankHold.account_id)
        .where(BankHold.id == hold_id, own_personal_account_condition(user.id))
        .with_for_update(of=BankHold)
    )
    if hold is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bank hold not found")
    if hold.dismissed_at is None:
        hold.dismissed_at = datetime.now(UTC)
    await db.commit()
