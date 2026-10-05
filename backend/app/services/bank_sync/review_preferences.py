"""Reading and changing an account's review preferences"""

import uuid
from collections.abc import Collection
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account_review_preference import AccountReviewPreference, ReviewDecision
from app.services.accounts.access import get_own_personal_account

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
    """Return an account's review preferences, which only its owner may read

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
    db: AsyncSession,
    user_id: uuid.UUID,
    account_id: uuid.UUID,
    *,
    new_transactions: ReviewDecision | None = None,
    corrections: ReviewDecision | None = None,
    removals: ReviewDecision | None = None,
) -> ReviewPreferences:
    """Change the given choices on an account the user owns, leaving the others as they were

    A choice applies to observations that arrive afterwards. Items already waiting keep their
    state, since nothing re-reads them when a choice changes. The caller commits

    Args:
        db: Active database session
        user_id: User changing the choices
        account_id: Account whose choices change
        new_transactions: The new choice for new posted transactions, or None to keep it
        corrections: The new choice for provider corrections, or None to keep it
        removals: The new choice for explicit provider removals, or None to keep it

    Returns:
        The account's choices after the change

    Raises:
        HTTPException: Not found when the user can't see the account, or forbidden when it isn't
            their own personal account
    """
    await get_own_personal_account(db, account_id, user_id, not_own_detail=NOT_OWN_ACCOUNT_DETAIL)
    changed = {
        name: choice
        for name, choice in (("new_transactions", new_transactions), ("corrections", corrections), ("removals", removals))
        if choice is not None
    }

    if changed:
        # The first change creates the row, with Review for every choice it doesn't name
        await db.execute(
            insert(AccountReviewPreference)
            .values(account_id=account_id, owner_id=user_id, **changed)
            .on_conflict_do_update(index_elements=[AccountReviewPreference.account_id], set_=changed)
        )
    return (await read_review_preferences(db, [account_id]))[account_id]


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
