"""Biggest category change helpers for Period At A Glance insights"""

import uuid

from app.models.base import CategoryKind
from app.services.insights.period_at_a_glance.category_total_helpers import CategoryNetTotals


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
    # Filter to categories that have comparable activity before ranking the largest absolute change
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
    biggest_change = (name, change_amount, change_pct)
    return biggest_change


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
    sort_key = -abs(_get_category_change_amount(kind, current_amount, previous_amount)), name
    return sort_key


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
    category_identity = (name, kind)
    return category_identity


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
        change_amount = (-current_amount) - (-previous_amount)
        return change_amount

    change_amount = current_amount - previous_amount
    return change_amount


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
        change_basis = -previous_amount
        return change_basis

    change_basis = abs(previous_amount)
    return change_basis
