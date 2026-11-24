"""The transactions a transaction can be linked to as a refund or as the expense it refunds"""

import uuid
from dataclasses import asdict, dataclass
from datetime import date

import sqlalchemy as sa
from sqlalchemy import ColumnElement, exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.account import Account
from app.models.base import CategoryKind, PermissionLevel
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.models.transaction_link import TransactionLink
from app.models.user import User
from app.permissions import check_transaction_access
from app.schemas.transaction import RefundLinkCandidateResponse, TransactionResponse
from app.services.transactions.accounts import get_parent_account_for_transaction
from app.services.transactions.links import get_refunded_amounts
from app.services.transactions.listing import list_transaction_responses
from app.services.transactions.listing.queries import TagMatch

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
    tag_match: TagMatch = "all"
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
    left_to_refund: int | None = None,
) -> list[RefundLinkCandidateResponse]:
    """Return the transactions a transaction can be linked to, the likely matches first

    A candidate paid to or from the transaction's own merchant, for exactly what is left to refund,
    comes first, then one for exactly that amount, then one from the same merchant, so closer amounts
    never push a likely match past the limit. Within each, and after them, the nearer an amount is to the transaction's the
    earlier it comes, and a tie goes to the newer date. Only the transaction's own currency is offered.

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
        left_to_refund: What an expense's open window shows it has left to refund, counting the links it
            holds. Without it, the expense's saved refunds less those the window unlinks are counted

    Returns:
        Up to thirty candidates, which linking would accept, each saying why it is a likely match
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

    # A merchant the app ships names no shop, so sharing it says nothing about a refund
    anchor_merchant = await db.get(Merchant, anchor.merchant_id) if anchor.merchant_id is not None else None
    merchant_matches = anchor_merchant is not None and not anchor_merchant.is_system
    same_merchant: ColumnElement[bool] = Transaction.merchant_id == anchor.merchant_id if merchant_matches else sa.false()
    if anchor.amount < 0:
        if category.kind != CategoryKind.EXPENSE:
            return []

        # Money that came in and no expense has claimed as its own. The link is looked up by each
        # candidate's own id, so the links' read rule is checked only for the user's transactions
        claimed = exists().where(
            TransactionLink.refund_transaction_id == Transaction.id,
            TransactionLink.refund_transaction_id.not_in(unlinked_ids),
        )
        conditions += [Transaction.amount > 0, Category.kind != CategoryKind.TRANSFER, ~claimed]
        if left_to_refund is None:
            left_to_refund = -anchor.amount - await _refunded_total(db, anchor.id, unlinked_ids)
        exact_amount: ColumnElement[bool] = Transaction.amount == left_to_refund
    elif anchor.amount > 0:
        own_link = (await db.execute(select(TransactionLink).where(TransactionLink.refund_transaction_id == anchor.id))).scalar_one_or_none()
        if own_link is not None and anchor.id not in unlinked_ids:
            return []
        own_original_id = own_link.original_transaction_id if own_link is not None else None
        conditions += [Transaction.amount < 0, Category.kind == CategoryKind.EXPENSE]

        # Each expense's refunds, less those the window unlinks, so an expense with exactly this
        # refund's amount left counts as an exact match
        refund = aliased(Transaction)
        refunded_so_far = (
            select(sa.func.coalesce(sa.func.sum(refund.amount), 0))
            .select_from(TransactionLink)
            .join(refund, refund.id == TransactionLink.refund_transaction_id)
            .where(TransactionLink.original_transaction_id == Transaction.id, TransactionLink.refund_transaction_id.not_in(unlinked_ids))
            .correlate(Transaction)
            .scalar_subquery()
        )
        exact_amount = -Transaction.amount - refunded_so_far == anchor.amount
    else:
        return []

    candidates = await list_transaction_responses(
        db,
        user,
        **asdict(filters or CandidateFilters()),
        search_text=search_text,
        limit=_CANDIDATE_LIMIT,
        extra_conditions=conditions,
        leading_order=(sa.case((sa.and_(same_merchant, exact_amount), 0), (exact_amount, 1), (same_merchant, 2), else_=3),),
        nearest_amount=(abs(anchor.amount), anchor.currency),
    )

    # Expenses say how much is already refunded, so the picker can refuse a refund that would not fit
    refunded: dict[uuid.UUID, int] = {}
    if anchor.amount > 0:
        refunded = await get_refunded_amounts(db, [candidate.id for candidate in candidates])

        # The refund being unlinked is no longer counted against the expense it was linked to
        if own_original_id in refunded:
            refunded[own_original_id] -= anchor.amount

    def flagged(candidate: TransactionResponse) -> RefundLinkCandidateResponse:
        is_exact = (
            candidate.amount == left_to_refund if anchor.amount < 0 else -candidate.amount - refunded.get(candidate.id, 0) == anchor.amount
        )
        return RefundLinkCandidateResponse(
            **candidate.model_dump(exclude={"refunded_amount"}),
            refunded_amount=refunded.get(candidate.id, 0) if anchor.amount > 0 else None,
            same_merchant=merchant_matches and candidate.merchant_id == anchor.merchant_id,
            exact_amount=is_exact,
        )

    return [flagged(candidate) for candidate in candidates]


async def _refunded_total(db: AsyncSession, expense_id: uuid.UUID, unlinked_ids: list[uuid.UUID]) -> int:
    """Return how much of an expense its saved refunds give back, less those the open window unlinks

    Args:
        db: Active database session
        expense_id: The expense to total the refunds of
        unlinked_ids: Refunds whose link the open window will remove on Save

    Returns:
        The refunded total in minor units, zero when it has none
    """
    total = await db.scalar(
        select(sa.func.coalesce(sa.func.sum(Transaction.amount), 0))
        .join(TransactionLink, TransactionLink.refund_transaction_id == Transaction.id)
        .where(TransactionLink.original_transaction_id == expense_id, TransactionLink.refund_transaction_id.not_in(unlinked_ids))
    )
    return int(total or 0)
