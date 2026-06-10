"""Category highlight helpers for the insights Period At A Glance card"""

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.schemas.fx import FxStatus
from app.services.fx import FxConverter
from app.services.fx.currency_exponent_helpers import get_currency_exponents
from app.services.insights.period_at_a_glance.biggest_category_change_helpers import (
    get_period_at_a_glance_biggest_category_change,
)
from app.services.insights.period_at_a_glance.category_total_helpers import CategoryNetTotals, get_period_at_a_glance_category_net_totals

ExpenseCategoryTotals = dict[uuid.UUID, tuple[str, int]]


@dataclass(frozen=True)
class PeriodAtAGlanceCategoryHighlights:
    """Store category highlights and FX statuses for the Period At A Glance response

    Attributes:
        top_category: Largest current expense category and percentage share
        top_category_fx_status: FX status for top-category conversion
        biggest_change: Category with the largest comparable amount change
        biggest_change_fx_status: FX status for biggest-change conversion
    """

    top_category: tuple[str, int | None] | None
    top_category_fx_status: FxStatus
    biggest_change: tuple[str, int, int | None] | None
    biggest_change_fx_status: FxStatus


async def get_period_at_a_glance_category_highlights(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
    previous_from_date: date,
    previous_to_date: date,
) -> PeriodAtAGlanceCategoryHighlights:
    """Return category highlights and FX statuses for the Period At A Glance card

    Args:
        db: Active database session
        accounts: Accounts included in the Period At A Glance summary
        base_currency: User base currency used for converted values
        from_date: Inclusive selected period start date
        to_date: Inclusive selected period end date
        previous_from_date: Inclusive comparison period start date
        previous_to_date: Inclusive comparison period end date

    Returns:
        Category highlights and their FX conversion statuses
    """
    currency_exponents = await get_currency_exponents(
        db,
        {base_currency, *(account.currency for account in accounts)},
    )
    top_category_converter = FxConverter(currency_exponents=currency_exponents)
    current_top_category_net_totals = await get_period_at_a_glance_category_net_totals(
        db,
        accounts,
        base_currency,
        from_date,
        to_date,
        top_category_converter,
    )
    biggest_change_converter = FxConverter(currency_exponents=currency_exponents)
    current_category_net_totals = await get_period_at_a_glance_category_net_totals(
        db,
        accounts,
        base_currency,
        from_date,
        to_date,
        biggest_change_converter,
    )
    previous_category_net_totals = await get_period_at_a_glance_category_net_totals(
        db,
        accounts,
        base_currency,
        previous_from_date,
        previous_to_date,
        biggest_change_converter,
    )

    category_highlights = PeriodAtAGlanceCategoryHighlights(
        top_category=get_period_at_a_glance_top_category(current_top_category_net_totals),
        top_category_fx_status=top_category_converter.get_status(),
        biggest_change=get_period_at_a_glance_biggest_category_change(
            current_category_net_totals,
            previous_category_net_totals,
        ),
        biggest_change_fx_status=biggest_change_converter.get_status(),
    )
    return category_highlights


def get_period_at_a_glance_top_category(
    category_net_totals: CategoryNetTotals,
) -> tuple[str, int | None] | None:
    """Return the largest current expense category and its expense share

    Args:
        category_net_totals: Signed category totals keyed by category ID

    Returns:
        Category name and percentage share, or None when no expense category exists
    """
    expense_totals = _get_expense_totals_from_category_net_totals(category_net_totals)
    if not expense_totals:
        return None

    total_positive_expenses = sum(amount for _name, amount in expense_totals.values())
    name, amount = sorted(expense_totals.values(), key=lambda item: (-item[1], item[0]))[0]
    expense_share = round((amount / total_positive_expenses) * 100) if total_positive_expenses > 0 else None
    top_category = (name, expense_share)
    return top_category


def _get_expense_totals_from_category_net_totals(
    category_net_totals: CategoryNetTotals,
) -> ExpenseCategoryTotals:
    """Return positive expense-side totals keyed by category ID

    Args:
        category_net_totals: Signed category totals keyed by category ID

    Returns:
        Positive expense amounts keyed by category ID
    """
    totals: ExpenseCategoryTotals = {}

    # Convert signed net totals into positive expense amounts for ranking
    for category_id, (name, _kind, total) in category_net_totals.items():
        amount = max(-total, 0)
        if amount:
            totals[category_id] = (name, amount)
    return totals
