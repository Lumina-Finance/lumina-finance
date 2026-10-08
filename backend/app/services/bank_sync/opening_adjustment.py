"""Offering a linked account's one-time opening adjustment, and recording or skipping it

History before the import start may be missing from the ledger, incomplete or entered differently, so
the ledger's balance may not match the bank's once the import is in. Once the import has ended and no
item it brought is still waiting for review, the link offers one adjustment: the bank's balance minus
the ledger's, as the balance comparison works them out on the bank's balance date. The bank's balance
has to be one it gave exactly and dated after the last transaction the import brought, since an older
one doesn't take in everything the import did. Until then the link waits, and each sync and each
review decision on a new item looks again. A ledger that already matches the bank is never offered
one, and an offer whose gap closes before it is answered, such as by the user recording the
difference by hand, shows nothing and ends at the next look. Items later syncs bring don't hold the
offer back, and the review pause and the reminder about history the bank may not have don't either.

Recording adds a Balance Adjustment dated the day before the import start, the latest day the bank
doesn't supply, so the check on the days a bank supplies never applies to it. Recording or skipping
ends the offer for good, for the link and for any later link of the account to the same bank
account, so neither is asked twice. After it, differences are only shown
"""

import uuid
from collections.abc import Sequence

from fastapi import HTTPException, status
from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankLinkState, OpeningAdjustmentState
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition
from app.models.user import User
from app.schemas.bank_sync import AccountBankStatusResponse
from app.services.accounts.access import get_own_personal_account
from app.services.accounts.balance_adjustments import add_balance_adjustment
from app.services.bank_sync.account_link import read_account_bank_status
from app.services.bank_sync.availability import LINK_NOT_OWN_DETAIL
from app.services.bank_sync.balance_comparison import compare_bank_balance, opening_adjustment_date, read_balance_day
from app.services.bank_sync.links import ACCOUNT_NOT_LINKED
from app.services.bank_sync.review_pause import lock_account_links
from app.services.cache_state import mark_user_cache_changed

# The note the recorded adjustment carries
OPENING_ADJUSTMENT_NOTE = "Opening adjustment"

# Why recording or skipping is refused once the offer is answered the other way, or while there is none
NOTHING_TO_RECORD = "There is no opening balance to confirm"
NOTHING_TO_SKIP = "There is no opening balance to skip"


async def offer_opening_adjustments(db: AsyncSession, links: Sequence[BankAccountLink], *, tz: str) -> bool:
    """Offer the opening adjustment on each of these links that is ready for it, or settle that it has none to offer

    An offer whose ledger now matches the bank ends with nothing to offer, so the status stops asking
    for it. The caller locked the links and wrote what it decided, so the items waiting and the ledger
    take it in, and commits

    Args:
        db: The links' owner's session
        links: Links the caller locked, any of which may have no offer to wait for
        tz: The owner's profile timezone

    Returns:
        Whether a link changed, so the caller tells the owner's pages

    Raises:
        HTTPException 422: The profile's timezone no longer resolves
    """
    changed = False
    for link in links:
        if link.opening_adjustment_state == OpeningAdjustmentState.OFFERED:
            balance = await compare_bank_balance(db, link, tz=tz)
            if balance is not None and balance.difference == 0:
                link.opening_adjustment_state = OpeningAdjustmentState.NONE
                changed = True
            continue
        if link.opening_adjustment_state != OpeningAdjustmentState.NOT_READY or link.importing or link.import_ended_at is None:
            continue

        # Items a link of the account brought before an import ended, each stamped as received on the
        # database's clock that ended it
        brought = (BankTransaction.account_id == link.account_id, BankTransaction.received_at <= link.import_ended_at)
        if await db.scalar(select(exists().where(*brought, BankTransaction.disposition == BankTransactionDisposition.AWAITING_REVIEW))):
            continue
        balance = await compare_bank_balance(db, link, tz=tz)
        if balance is None or balance.difference is None:
            continue

        # A dismissed item keeps no date, so the last imported date is that of one still standing
        last_imported = await db.scalar(select(func.max(BankTransaction.observed_date)).where(*brought))
        if last_imported is not None and read_balance_day(balance.balance_date, tz=tz) <= last_imported:
            continue
        link.opening_adjustment_state = OpeningAdjustmentState.OFFERED if balance.difference else OpeningAdjustmentState.NONE
        changed = True
    return changed


async def record_opening_adjustment(db: AsyncSession, user: User, account_id: uuid.UUID, amount: int) -> AccountBankStatusResponse:
    """Record the offered opening adjustment for the amount given, which ends the offer, in one save

    One already recorded answers as the account stands, so a double submission records it once

    Args:
        db: Active database session
        user: The account's owner
        account_id: The linked account
        amount: Signed minor units as the ledger keeps them, other than zero

    Returns:
        The account's bank link, with the balances taking in the adjustment and no offer left

    Raises:
        HTTPException 403: The account is visible but isn't the user's own personal account
        HTTPException 404: The user can't see the account, or it isn't linked
        HTTPException 409: The link doesn't offer the adjustment: it isn't ready, there was nothing
            to offer, it was skipped, or the link waits for its bank account to be chosen again
        HTTPException 422: The profile's timezone no longer resolves
    """
    account, link = await _lock_offer(db, user, account_id)
    if link.opening_adjustment_state != OpeningAdjustmentState.RECORDED:
        _refuse_unless_offered(link, NOTHING_TO_RECORD)

        # Held shared, as the check on the days a bank supplies holds the account for any other write
        # to a linked account's transactions, and after the links, as that check takes it under a
        # review decision, so the two queue rather than deadlock
        await db.refresh(account, with_for_update={"read": True})
        await add_balance_adjustment(
            db, account, user=user, amount=amount, adjustment_date=opening_adjustment_date(link), note=OPENING_ADJUSTMENT_NOTE
        )
        await _answer(db, user, link, OpeningAdjustmentState.RECORDED)
    return await read_account_bank_status(db, user, account.id)


async def skip_opening_adjustment(db: AsyncSession, user: User, account_id: uuid.UUID) -> AccountBankStatusResponse:
    """Skip the offered opening adjustment, which ends the offer without recording anything

    One already skipped answers as the account stands, so a double submission skips it once

    Args:
        db: Active database session
        user: The account's owner
        account_id: The linked account

    Returns:
        The account's bank link, with no offer left

    Raises:
        HTTPException 403: The account is visible but isn't the user's own personal account
        HTTPException 404: The user can't see the account, or it isn't linked
        HTTPException 409: The link doesn't offer the adjustment: it isn't ready, there was nothing
            to offer, it was recorded, or the link waits for its bank account to be chosen again
        HTTPException 422: The profile's timezone no longer resolves
    """
    account, link = await _lock_offer(db, user, account_id)
    if link.opening_adjustment_state != OpeningAdjustmentState.SKIPPED:
        _refuse_unless_offered(link, NOTHING_TO_SKIP)
        await _answer(db, user, link, OpeningAdjustmentState.SKIPPED)
    return await read_account_bank_status(db, user, account.id)


async def _lock_offer(db: AsyncSession, user: User, account_id: uuid.UUID) -> tuple[Account, BankAccountLink]:
    """Lock the links of one of the user's own personal accounts, and return the account with its live link

    The links are locked after their connections, as every writer takes them, so a sync or a review
    decision writing the link finishes first, and a second answer waits for the first and finds it

    Raises:
        HTTPException 403: The account is visible but isn't the user's own personal account
        HTTPException 404: The user can't see the account, or it isn't linked
    """
    account = await get_own_personal_account(db, account_id, user.id, not_own_detail=LINK_NOT_OWN_DETAIL)
    links = await lock_account_links(db, [account.id])
    link = next((link for link in links if link.state != BankLinkState.UNLINKED), None)
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ACCOUNT_NOT_LINKED)
    return account, link


def _refuse_unless_offered(link: BankAccountLink, detail: str) -> None:
    """Refuse an answer to a link that doesn't offer the adjustment, or that waits for its bank account to be chosen again

    Raises:
        HTTPException 409: Nothing is offered to answer
    """
    if link.opening_adjustment_state != OpeningAdjustmentState.OFFERED or link.state != BankLinkState.ACTIVE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


async def _answer(db: AsyncSession, user: User, link: BankAccountLink, answer: OpeningAdjustmentState) -> None:
    """Record the answer on the locked link, mark the owner's cache and commit"""
    link.opening_adjustment_state = answer
    await mark_user_cache_changed(db, user.id)
    await db.commit()
