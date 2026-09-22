"""Account spending snapshot query helpers"""

from sqlalchemy import func, literal, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.schemas.account import AccountSpendingBreakdown, AccountTopCategory, AccountTopMerchant
from app.schemas.dashboard import RangeKind

_TOP_SPENDING_ROWS_LIMIT = 5


async def get_account_spending_snapshot(
    db: AsyncSession,
    expense_predicate,
    range_: RangeKind,
) -> AccountSpendingBreakdown:
    """Read both spending cards from one database statement snapshot

    Each card independently nets its visible groups before deriving its total and
    hidden count, so merchant visibility and refunds retain their existing meaning

    Args:
        db: Active database session subject to viewer row-level security
        expense_predicate: Account, expense-kind and inclusive date constraints
        range_: Calendar period echoed in the response

    Returns:
        Complete spending breakdown decoded from at most ten result rows
    """
    categories = _build_ranked_spending_groups(Category, expense_predicate)
    merchants = _build_ranked_spending_groups(Merchant, expense_predicate)
    snapshot = union_all(
        _select_top_spending_groups(categories, "category"),
        _select_top_spending_groups(merchants, "merchant"),
    ).subquery()

    # Read all card figures together so a concurrent commit cannot split their snapshot
    result = await db.execute(select(snapshot).order_by(snapshot.c.kind, snapshot.c.position))
    breakdown = AccountSpendingBreakdown(
        range=range_, top_categories=[], top_merchants=[],
        categories_total_spend=0, merchants_total_spend=0,
        other_categories_count=0, other_merchants_count=0,
    )
    for row in result.all():
        total = -int(row.signed_total)
        full_total = -int(row.full_total)
        hidden_count = max(int(row.group_count) - _TOP_SPENDING_ROWS_LIMIT, 0)
        if row.kind == "category":
            breakdown.top_categories.append(AccountTopCategory(category_id=row.id, name=row.name, total=total))
            breakdown.categories_total_spend = full_total
            breakdown.other_categories_count = hidden_count
        else:
            breakdown.top_merchants.append(AccountTopMerchant(merchant_id=row.id, name=row.name, total=total))
            breakdown.merchants_total_spend = full_total
            breakdown.other_merchants_count = hidden_count
    return breakdown


def _build_ranked_spending_groups(model, expense_predicate):
    """Build independent net-spending groups with complete totals, counts and stable ranks

    Args:
        model: Category or Merchant defining the card's visible groups
        expense_predicate: Shared account, expense-kind and date constraints

    Returns:
        Subquery retaining every spending group before the top-five cutoff
    """
    signed_total = func.sum(Transaction.amount)
    grouped = select(model.id, model.name, signed_total.label("signed_total")).select_from(Transaction)
    grouped = grouped.join(Category, Transaction.category_id == Category.id)
    if model is Merchant:
        grouped = grouped.join(Merchant, Transaction.merchant_id == Merchant.id)
    groups = (
        grouped.where(expense_predicate)
        .group_by(model.id, model.name)
        .having(signed_total < 0)
        .subquery()
    )
    ranked = select(
        groups.c.id,
        groups.c.name,
        groups.c.signed_total,
        func.sum(groups.c.signed_total).over().label("full_total"),
        func.count().over().label("group_count"),
        func.row_number().over(
            order_by=(groups.c.signed_total.asc(), groups.c.name.asc(), groups.c.id.asc()),
        ).label("position"),
    ).subquery()
    return ranked


def _select_top_spending_groups(groups, kind: str):
    """Limit ranked groups only after computing figures over the complete card

    Args:
        groups: Ranked card subquery with full totals and counts
        kind: Discriminator used to decode category or merchant rows

    Returns:
        Select returning at most five rows without truncating aggregate figures
    """
    return select(literal(kind).label("kind"), *groups.c).where(groups.c.position <= _TOP_SPENDING_ROWS_LIMIT)
