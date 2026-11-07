"""Reading and changing an account's review preferences"""

import uuid
from collections.abc import Collection
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account_review_preference import AccountReviewPreference, ReviewDecision
from app.schemas.bank_sync import UpdateReviewPreferencesRequest
from app.services.accounts.access import get_own_personal_account
from app.services.cache_state import mark_user_status_changed

# Why an account the user can see but doesn't own alone, such as a group account, has no
# preferences for them
NOT_OWN_ACCOUNT_DETAIL = "Review preferences are only available on your own accounts"


@dataclass(frozen=True)
class ReviewPreferences:
    """An account's three trust choices"""

    new_transactions: ReviewDecision
    corrections: ReviewDecision
    removals: ReviewDecision


# What an account reads as until its owner changes a choice
REVIEW_ALL = ReviewPreferences(ReviewDecision.REVIEW, ReviewDecision.REVIEW, ReviewDecision.REVIEW)


async def get_review_preferences(db: AsyncSession, user_id: uuid.UUID, account_id: uuid.UUID) -> ReviewPreferences:
    """Return an account's review preferences. Only its owner may read them

    Args:
        db: Active database session
        user_id: User asking
        account_id: Account whose preferences are read

    Returns:
        The stored choices, or Review all when none are stored

    Raises:
        HTTPException: Not found when the user can't see the account, or forbidden when it isn't
            their own personal account
    """
    await get_own_personal_account(db, account_id, user_id, not_own_detail=NOT_OWN_ACCOUNT_DETAIL)
    return (await read_review_preferences(db, [account_id]))[account_id]


async def update_review_preferences(
    db: AsyncSession, user_id: uuid.UUID, account_id: uuid.UUID, request: UpdateReviewPreferencesRequest
) -> ReviewPreferences:
    """Replace the three choices on an account the user owns, for bank data arriving from now on

    Items already waiting keep their state, since nothing re-reads them when a choice changes.
    A choice changes none of the user's data, so the data mark an import's undo compares with stays
    where it was

    Each save names all three choices, so two at once leave one of them whole: the later waits on
    the row the first writes, then replaces all three. The save locks that row before the owner's
    cache row. That comes last as in every bank sync write. The first save for an account also
    takes key-share locks on the account row and the user row its foreign keys name. The locks
    conflict only with a FOR UPDATE lock, as a deletion, a key change or recording a starting
    balance takes. A sync reads the choices without a lock, taking
    whichever were committed when it reads them, so neither waits on the other

    Args:
        db: Active database session
        user_id: User changing the choices
        account_id: Account whose choices change
        request: The three choices

    Returns:
        The account's choices as saved

    Raises:
        HTTPException: Not found when the user can't see the account, or forbidden when it isn't
            their own personal account
    """
    await get_own_personal_account(db, account_id, user_id, not_own_detail=NOT_OWN_ACCOUNT_DETAIL)
    choices = request.model_dump()
    await db.execute(
        insert(AccountReviewPreference)
        .values(account_id=account_id, owner_id=user_id, **choices)
        .on_conflict_do_update(index_elements=[AccountReviewPreference.account_id], set_=choices)
    )
    await mark_user_status_changed(db, user_id)
    await db.commit()
    return ReviewPreferences(**choices)


async def read_review_preferences(db: AsyncSession, account_ids: Collection[uuid.UUID]) -> dict[uuid.UUID, ReviewPreferences]:
    """Return each account's stored choices, or Review all for one with none stored, without checking who may read them"""
    rows = await db.execute(
        select(
            AccountReviewPreference.account_id,
            AccountReviewPreference.new_transactions,
            AccountReviewPreference.corrections,
            AccountReviewPreference.removals,
        ).where(AccountReviewPreference.account_id.in_(account_ids))
    )
    stored = {account_id: ReviewPreferences(*(ReviewDecision(choice) for choice in choices)) for account_id, *choices in rows}
    return {account_id: stored.get(account_id, REVIEW_ALL) for account_id in account_ids}
