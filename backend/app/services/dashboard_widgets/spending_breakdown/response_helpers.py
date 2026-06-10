"""Spending breakdown response helpers"""

import uuid
from dataclasses import dataclass

from app.models.base import CategoryKind
from app.schemas.dashboard import CategoryBreakdownEntry, RangeKind, SpendingBreakdownResponse
from app.schemas.fx import FxStatus

DASHBOARD_BREAKDOWN_CATEGORY_LIMIT = 6


@dataclass(frozen=True, slots=True)
class SpendingBreakdownCategoryTotal:
    """Converted total for one category in a spending breakdown

    Attributes:
        name: Category display name
        kind: Category classification used to identify income and expense
        amount: Signed total amount in the user's base currency
    """

    name: str
    kind: CategoryKind
    amount: int


type SpendingBreakdownCategoryTotalsById = dict[uuid.UUID, SpendingBreakdownCategoryTotal]


def build_empty_spending_breakdown_response(range_: RangeKind) -> SpendingBreakdownResponse:
    """Return an empty breakdown response for users without accounts

    Args:
        range_: Calendar period requested by the dashboard

    Returns:
        Empty spending breakdown response with a clean FX status
    """
    response = SpendingBreakdownResponse(
        range=range_,
        expense=[],
        income=[],
        expense_total=0,
        income_total=0,
        fx_status=FxStatus(),
    )
    return response


def get_spending_breakdown_categories_by_sign(
    category_totals: SpendingBreakdownCategoryTotalsById,
) -> tuple[list[CategoryBreakdownEntry], list[CategoryBreakdownEntry]]:
    """Return expense and income categories from signed category totals

    Args:
        category_totals: Category totals keyed by category ID

    Returns:
        Expense categories and income categories sorted largest-first
    """
    expense_categories: list[CategoryBreakdownEntry] = []
    income_categories: list[CategoryBreakdownEntry] = []

    # Split by signed amount because refunds and reversals can cross category kinds
    for category_id, category_total in category_totals.items():
        if category_total.amount < 0:
            expense_category = CategoryBreakdownEntry(
                category_id=category_id,
                name=category_total.name,
                category_kind=category_total.kind,
                amount=-category_total.amount,
            )
            expense_categories.append(expense_category)
            continue

        if category_total.amount > 0:
            income_category = CategoryBreakdownEntry(
                category_id=category_id,
                name=category_total.name,
                category_kind=category_total.kind,
                amount=category_total.amount,
            )
            income_categories.append(income_category)

    expense_categories.sort(key=lambda category: (-category.amount, category.name))
    income_categories.sort(key=lambda category: (-category.amount, category.name))
    return expense_categories, income_categories


def get_spending_breakdown_totals(
    expense_categories: list[CategoryBreakdownEntry],
    income_categories: list[CategoryBreakdownEntry],
) -> tuple[int, int]:
    """Return dashboard totals adjusted for category sign crossovers

    Args:
        expense_categories: Expense categories after sign-based splitting
        income_categories: Income categories after sign-based splitting

    Returns:
        Expense total and income total for the dashboard summary
    """
    # Remove crossovers so summary totals match the visible income and expense categories
    expense_refunds = sum(
        category.amount
        for category in income_categories
        if category.category_kind == CategoryKind.EXPENSE
    )
    income_losses = sum(
        category.amount
        for category in expense_categories
        if category.category_kind == CategoryKind.INCOME
    )
    expense_amount = sum(category.amount for category in expense_categories)
    income_amount = sum(category.amount for category in income_categories)
    expense_total = max(expense_amount - expense_refunds, 0)
    income_total = max(income_amount - income_losses, 0)
    return expense_total, income_total


def get_limited_spending_breakdown_categories(
    categories: list[CategoryBreakdownEntry],
    kind: CategoryKind,
) -> list[CategoryBreakdownEntry]:
    """Return visible breakdown categories with one Other category for hidden same-kind totals

    Args:
        categories: Sorted breakdown categories for one side of the widget
        kind: Category kind represented by the visible list

    Returns:
        Limited categories including hidden opposite-kind crossovers and one Other category when needed
    """
    visible_categories = categories[:DASHBOARD_BREAKDOWN_CATEGORY_LIMIT]
    hidden_categories = categories[DASHBOARD_BREAKDOWN_CATEGORY_LIMIT:]
    flipped_hidden_categories = [category for category in hidden_categories if category.category_kind != kind]
    other_amount = sum(category.amount for category in hidden_categories if category.category_kind == kind)
    if other_amount <= 0:
        limited_categories = [*visible_categories, *flipped_hidden_categories]
        return limited_categories

    other_category = CategoryBreakdownEntry(
        category_id=uuid.uuid5(uuid.NAMESPACE_URL, f"dashboard-{kind.value}-other"),
        name="Other",
        category_kind=kind,
        amount=other_amount,
    )
    limited_categories = [*visible_categories, *flipped_hidden_categories, other_category]
    return limited_categories
