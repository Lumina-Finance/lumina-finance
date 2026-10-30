"""The transactions a transaction can be linked to as a refund or as the expense it refunds"""

import uuid
from dataclasses import asdict, dataclass
from datetime import date

from sqlalchemy import ColumnElement, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind, PermissionLevel
from app.models.category import Category
from app.models.transaction import Transaction
from app.models.transaction_link import TransactionLink
from app.models.user import User
from app.permissions import check_transaction_access
from app.schemas.transaction import TransactionResponse
from app.services.transactions.accounts import get_parent_account_for_transaction
from app.services.transactions.links import get_refunded_amounts
from app.services.transactions.listing import list_transaction_responses

# Enough to scroll, and a search or the filters narrow the rest
_CANDIDATE_LIMIT = 30


@dataclass(frozen=True)
class CandidateFilters:
    """The transaction list's filters, which narrow the candidates the same way they narrow the list"""

    account_ids: list[uuid.UUID] | None = None
    category_ids: list[uuid.UUID] | None = None
    merchant_ids: list[uuid.UUID] | None = None
    currencies: list[str] | None = None
    tag_ids: list[uuid.UUID] | None = None
    tag_match: str = "all"
    min_amount: int | None = None
    max_amount: int | None = None
    amount_currency: str | None = None
    from_date: date | None = None
    to_date: date | None = None


async def list_refund_link_candidates(
    db: AsyncSession,
    user: User,
    transaction_id: uuid.UUID,
    search_text: str | None,
    filters: CandidateFilters | None = None,
    unlinked_ids: list[uuid.UUID] | None = None,
) -> list[TransactionResponse]:
    """Return the transactions a transaction can be linked to, the closest amounts first

    The order puts the candidates with exactly the transaction's amount first. When there are none, or
    after them, the nearer an amount is the earlier it comes, and a tie goes to the newer date. Only
    the transaction's own currency is offered.

    An expense that can be refunded is offered the money that came in and is not yet the refund of
    anything. A transaction that can be a refund is offered the expenses. Anything else, a transfer,
    a refund already linked, money going out of an income category or a group account, has none

    Args:
        db: Active database session
        user: Authenticated user
        transaction_id: The transaction a link is wanted for
        search_text: Optional text to find in merchant names and notes
        filters: Optional list filters to keep candidates within
        unlinked_ids: Refunds whose link the open window will remove on Save, which are offered as if
            already unlinked

    Returns:
        Up to thirty candidates, which linking would accept
    """
    anchor = await check_transaction_access(db, transaction_id, user.id, PermissionLevel.READ)
    account = await get_parent_account_for_transaction(db, anchor)
    category = await db.get(Category, anchor.category_id)
    if account.group_id is not None or account.is_archived or category is None or category.kind == CategoryKind.TRANSFER:
        return []

    # Linking accepts individually owned, unarchived accounts only
    linkable_account = Transaction.account_id.in_(select(Account.id).where(Account.group_id.is_(None), Account.is_archived.is_(False)))
    conditions: list[ColumnElement[bool]] = [Transaction.id != anchor.id, Transaction.currency == anchor.currency, linkable_account]
    unlinked_ids = unlinked_ids or []
    own_original_id: uuid.UUID | None = None
    if anchor.amount < 0:
        if category.kind != CategoryKind.EXPENSE:
            return []

        # Money that came in, which no expense has claimed as its own
        refunds = select(TransactionLink.refund_transaction_id).where(TransactionLink.refund_transaction_id.not_in(unlinked_ids))
        conditions += [Transaction.amount > 0, Category.kind != CategoryKind.TRANSFER, Transaction.id.not_in(refunds)]
    elif anchor.amount > 0:
        own_link = (await db.execute(select(TransactionLink).where(TransactionLink.refund_transaction_id == anchor.id))).scalar_one_or_none()
        if own_link is not None and anchor.id not in unlinked_ids:
            return []
        own_original_id = own_link.original_transaction_id if own_link is not None else None
        conditions += [Transaction.amount < 0, Category.kind == CategoryKind.EXPENSE]
    else:
        return []

    candidates = await list_transaction_responses(
        db,
        user,
        **asdict(filters or CandidateFilters()),
        search_text=search_text,
        limit=_CANDIDATE_LIMIT,
        extra_conditions=conditions,
        nearest_amount=(abs(anchor.amount), anchor.currency),
    )

    # Expenses say how much is already refunded, so the picker can refuse a refund that would not fit
    if anchor.amount > 0:
        refunded = await get_refunded_amounts(db, [candidate.id for candidate in candidates])

        # The refund being unlinked is no longer counted against the expense it was linked to
        own_original = next((candidate for candidate in candidates if candidate.id == own_original_id), None)
        if own_original is not None:
            refunded[own_original.id] -= anchor.amount
        candidates = [candidate.model_copy(update={"refunded_amount": refunded.get(candidate.id, 0)}) for candidate in candidates]
    return candidates
