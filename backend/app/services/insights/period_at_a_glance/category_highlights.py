"""Category highlight helpers for the insights Period At A Glance card"""

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.schemas.fx import FxStatus
from app.services.fx import FxConverter
from app.services.insights.period_at_a_glance.category_totals import CategoryNetTotals, get_period_at_a_glance_category_net_totals
from app.services.insights.period_at_a_glance.conversion import get_period_at_a_glance_currency_exponents

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
    currency_exponents = await get_period_at_a_glance_currency_exponents(
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

    return PeriodAtAGlanceCategoryHighlights(
        top_category=get_period_at_a_glance_top_category(current_top_category_net_totals),
        top_category_fx_status=top_category_converter.get_status(),
        biggest_change=get_period_at_a_glance_biggest_category_change(current_category_net_totals, previous_category_net_totals),
        biggest_change_fx_status=biggest_change_converter.get_status(),
    )


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
    return name, round((amount / total_positive_expenses) * 100) if total_positive_expenses > 0 else None


def get_period_at_a_glance_biggest_category_change(
    current_totals: CategoryNetTotals,
    previous_totals: CategoryNetTotals,
) -> tuple[str, int, int | None] | None:
    """Return the tracked category with the largest comparable amount change

    Args:
        current_totals: Signed category totals for the selected period
        previous_totals: Signed category totals for the comparison period

    Returns:
        Category name, amount change, and percentage change, or None when no category can be compared
    """
    category_ids = [
        category_id
        for category_id in set(current_totals) | set(previous_totals)
        if _is_category_change_candidate(category_id, current_totals, previous_totals)
    ]
    if not category_ids:
        return None

    category_id = sorted(
        category_ids,
        key=lambda candidate: _get_category_change_sort_key(candidate, current_totals, previous_totals),
    )[0]
    name, kind = _get_category_identity(category_id, current_totals, previous_totals)
    current_amount = current_totals.get(category_id, ("", kind, 0))[2]
    previous_amount = previous_totals.get(category_id, ("", kind, 0))[2]
    change_amount = _get_category_change_amount(kind, current_amount, previous_amount)
    previous_basis = _get_category_change_basis(kind, current_amount, previous_amount)
    change_pct = round((change_amount / previous_basis) * 100) if previous_basis > 0 else None
    return name, change_amount, change_pct


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


def _get_category_change_sort_key(
    category_id: uuid.UUID,
    current_totals: CategoryNetTotals,
    previous_totals: CategoryNetTotals,
) -> tuple[int, str]:
    """Return sort key for largest category change with stable name tie-break

    Args:
        category_id: Category ID being ranked
        current_totals: Signed category totals for the selected period
        previous_totals: Signed category totals for the comparison period

    Returns:
        Sort key using descending absolute change and ascending category name
    """
    name, kind = _get_category_identity(category_id, current_totals, previous_totals)
    current_amount = current_totals.get(category_id, ("", kind, 0))[2]
    previous_amount = previous_totals.get(category_id, ("", kind, 0))[2]
    return -abs(_get_category_change_amount(kind, current_amount, previous_amount)), name


def _get_category_identity(
    category_id: uuid.UUID,
    current_totals: CategoryNetTotals,
    previous_totals: CategoryNetTotals,
) -> tuple[str, CategoryKind]:
    """Return category name and kind from whichever period contains the category

    Args:
        category_id: Category ID being read
        current_totals: Signed category totals for the selected period
        previous_totals: Signed category totals for the comparison period

    Returns:
        Category name and kind
    """
    name, kind, _amount = current_totals.get(
        category_id,
        previous_totals.get(category_id, ("", CategoryKind.EXPENSE, 0)),
    )
    return name, kind


def _is_category_change_candidate(
    category_id: uuid.UUID,
    current_totals: CategoryNetTotals,
    previous_totals: CategoryNetTotals,
) -> bool:
    """Return whether a category should be considered for biggest change

    Args:
        category_id: Category ID being checked
        current_totals: Signed category totals for the selected period
        previous_totals: Signed category totals for the comparison period

    Returns:
        True when the category should be considered for biggest change
    """
    _name, kind = _get_category_identity(category_id, current_totals, previous_totals)
    current_amount = current_totals.get(category_id, ("", kind, 0))[2]
    previous_amount = previous_totals.get(category_id, ("", kind, 0))[2]

    if kind == CategoryKind.INCOME:
        return current_amount < 0
    return current_amount != 0 or previous_amount != 0


def _get_category_change_amount(kind: CategoryKind, current_amount: int, previous_amount: int) -> int:
    """Return display amount change for a category across two periods

    Args:
        kind: Category kind used to interpret signed amounts
        current_amount: Signed current-period category amount
        previous_amount: Signed comparison-period category amount

    Returns:
        Display amount change between periods
    """
    if kind == CategoryKind.EXPENSE and current_amount <= 0 and previous_amount <= 0:
        return (-current_amount) - (-previous_amount)
    return current_amount - previous_amount


def _get_category_change_basis(kind: CategoryKind, current_amount: int, previous_amount: int) -> int:
    """Return denominator used for category percentage change

    Args:
        kind: Category kind used to interpret signed amounts
        current_amount: Signed current-period category amount
        previous_amount: Signed comparison-period category amount

    Returns:
        Positive basis for percentage change, or zero when no percentage can be calculated
    """
    if previous_amount == 0:
        return 0
    if kind == CategoryKind.EXPENSE and current_amount <= 0 and previous_amount <= 0:
        return -previous_amount
    return abs(previous_amount)
