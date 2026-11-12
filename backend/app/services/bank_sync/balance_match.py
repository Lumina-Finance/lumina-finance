"""Recording the balance match a linked account offers whenever its ledger and the bank's balance differ

The offer is the bank's balance minus the ledger's, as the balance comparison works them out on the
bank's balance date, less what approving the account's items still waiting for review would change
by then. The bank's balance already holds those items, so counting them as the gap would count them
twice once they are approved. It is read afresh on each read of the account's link and holds no
state, so a gap that opens after an earlier match is offered again.

Recording adds a Balance Adjustment dated the day before the import start, the latest day the bank
doesn't supply, so the check on the days a bank supplies never applies to it. The request names the
offer the user was shown, and one whose offer has moved since is refused, so a second submission or
a second tab records nothing more
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.bank_sync import AccountBankStatusResponse
from app.services.accounts.balance_adjustments import add_balance_adjustment
from app.services.bank_sync.account_link import commit_with_account_bank_status
from app.services.bank_sync.availability import read_provider_labels
from app.services.bank_sync.balance_comparison import compare_bank_balance, describe_balance_match, match_adjustment_date
from app.services.bank_sync.links import lock_live_link
from app.services.cache_state import mark_user_cache_changed

# Why recording is refused while nothing is offered, or once the offer the user was shown has moved
NOTHING_TO_MATCH = "There is no difference between the balances"
MATCH_MOVED = "The difference has changed. Please check the new amount and try again"


async def record_balance_match(db: AsyncSession, user: User, account_id: uuid.UUID, *, offered_amount: int) -> AccountBankStatusResponse:
    """Record the offered balance match for the amount offered in one save

    Args:
        db: Active database session
        user: The account's owner
        account_id: The linked account
        offered_amount: The amount of the offer the user was shown, signed minor units as the ledger keeps them

    Returns:
        The account's bank link, with the balances taking in the adjustment and any difference left offered

    Raises:
        HTTPException 403: The account is visible but isn't the user's own personal account
        HTTPException 404: The user can't see the account, or it isn't linked
        HTTPException 409: Nothing is offered, or the offer is no longer the one the user was shown
        HTTPException 422: The profile's timezone no longer resolves
    """
    account, link = await lock_live_link(db, user, account_id)

    # Held shared, as the check on the days a bank supplies holds the account for any other write to
    # a linked account's transactions, and after the links, as that check takes it under a review
    # decision, so the two queue rather than deadlock. The offer is read under both, so a sync or a
    # review decision can't move it before the adjustment lands
    await db.refresh(account, with_for_update={"read": True})
    offer = await describe_balance_match(db, link, await compare_bank_balance(db, link, tz=user.tz), tz=user.tz)
    if offer is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=NOTHING_TO_MATCH)
    if offer.amount != offered_amount:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=MATCH_MOVED)

    provider_name = (await read_provider_labels(db, [link.provider]))[link.provider]
    await add_balance_adjustment(
        db,
        account,
        user=user,
        amount=offer.amount,
        adjustment_date=match_adjustment_date(link),
        note=f"Matched to {provider_name}'s balance",
    )
    await mark_user_cache_changed(db, user.id)
    return await commit_with_account_bank_status(db, user, account.id)
