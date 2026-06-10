import uuid

from hypothesis import given
from hypothesis import strategies as st

from app.models.base import CategoryKind
from app.schemas.dashboard import CategoryBreakdownEntry
from app.services.dashboard_widgets.spending_breakdown.response_helpers import (
    SpendingBreakdownCategoryTotal,
    get_limited_spending_breakdown_categories,
    get_spending_breakdown_categories_by_sign,
    get_spending_breakdown_totals,
)

SALARY_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
CAPITAL_LOSS_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")
GROCERIES_ID = uuid.UUID("00000000-0000-0000-0000-000000000003")
OVER_REFUND_ID = uuid.UUID("00000000-0000-0000-0000-000000000004")
_BREAKDOWN_KINDS = [CategoryKind.EXPENSE, CategoryKind.INCOME]
_CATEGORY_TOTALS = st.lists(
    st.tuples(
        st.sampled_from(_BREAKDOWN_KINDS),
        st.integers(min_value=-1_000_000, max_value=1_000_000),
    ),
    min_size=0,
    max_size=25,
)
_VISIBLE_CATEGORY_DATA = st.lists(
    st.tuples(
        st.sampled_from(_BREAKDOWN_KINDS),
        st.integers(min_value=1, max_value=1_000_000),
    ),
    min_size=0,
    max_size=20,
)


def _dump_entries(entries: list[CategoryBreakdownEntry]) -> list[dict]:
    """Return JSON-ready category entries for readable assertions"""
    return [entry.model_dump(mode="json") for entry in entries]


def _make_entry(category_id: uuid.UUID, name: str, kind: CategoryKind, amount: int) -> CategoryBreakdownEntry:
    """Return a category breakdown entry used by grouping tests"""
    return CategoryBreakdownEntry(
        category_id=category_id,
        name=name,
        category_kind=kind,
        amount=amount,
    )


def _get_generated_category_id(index: int) -> uuid.UUID:
    """Return a stable category ID for generated category test data"""
    return uuid.UUID(f"00000000-0000-0000-0000-{index + 100:012d}")


def _make_category_totals(category_data: list[tuple[CategoryKind, int]]) -> dict[uuid.UUID, SpendingBreakdownCategoryTotal]:
    """Return spending breakdown totals keyed by stable category IDs"""
    return {
        _get_generated_category_id(index): SpendingBreakdownCategoryTotal(
            name=f"Generated {index:02d}",
            kind=kind,
            amount=amount,
        )
        for index, (kind, amount) in enumerate(category_data)
    }


def _make_generated_entries(category_data: list[tuple[CategoryKind, int]]) -> list[CategoryBreakdownEntry]:
    """Return spending breakdown entries from generated category data"""
    return [
        _make_entry(
            _get_generated_category_id(index),
            f"Generated {index:02d}",
            kind,
            amount,
        )
        for index, (kind, amount) in enumerate(category_data)
    ]


def test_get_spending_breakdown_categories_by_sign_routes_crossovers():
    """Sign-based splitting moves refunds and losses onto the visible side they affect"""
    category_totals = {
        SALARY_ID: SpendingBreakdownCategoryTotal(
            name="Test Salary",
            kind=CategoryKind.INCOME,
            amount=300_000,
        ),
        CAPITAL_LOSS_ID: SpendingBreakdownCategoryTotal(
            name="Test Capital Gains",
            kind=CategoryKind.INCOME,
            amount=-80_000,
        ),
        GROCERIES_ID: SpendingBreakdownCategoryTotal(
            name="Test Groceries Net",
            kind=CategoryKind.EXPENSE,
            amount=-60_000,
        ),
        OVER_REFUND_ID: SpendingBreakdownCategoryTotal(
            name="Test Over-refunded",
            kind=CategoryKind.EXPENSE,
            amount=20_000,
        ),
    }

    expense_categories, income_categories = get_spending_breakdown_categories_by_sign(category_totals)

    assert _dump_entries(expense_categories) == [
        {
            "category_id": str(CAPITAL_LOSS_ID),
            "name": "Test Capital Gains",
            "category_kind": "income",
            "amount": 80_000,
        },
        {
            "category_id": str(GROCERIES_ID),
            "name": "Test Groceries Net",
            "category_kind": "expense",
            "amount": 60_000,
        },
    ]
    assert _dump_entries(income_categories) == [
        {
            "category_id": str(SALARY_ID),
            "name": "Test Salary",
            "category_kind": "income",
            "amount": 300_000,
        },
        {
            "category_id": str(OVER_REFUND_ID),
            "name": "Test Over-refunded",
            "category_kind": "expense",
            "amount": 20_000,
        },
    ]


def test_get_spending_breakdown_totals_net_crossovers_against_original_side():
    """Summary totals subtract refunds and losses from the side their category belongs to"""
    expense_categories = [
        _make_entry(CAPITAL_LOSS_ID, "Test Capital Gains", CategoryKind.INCOME, 80_000),
        _make_entry(GROCERIES_ID, "Test Groceries Net", CategoryKind.EXPENSE, 60_000),
    ]
    income_categories = [
        _make_entry(SALARY_ID, "Test Salary", CategoryKind.INCOME, 300_000),
        _make_entry(OVER_REFUND_ID, "Test Over-refunded", CategoryKind.EXPENSE, 20_000),
    ]

    expense_total, income_total = get_spending_breakdown_totals(expense_categories, income_categories)

    assert expense_total == 120_000
    assert income_total == 240_000


def test_get_limited_spending_breakdown_categories_groups_same_kind_hidden_rows():
    """Hidden same-kind rows are grouped into Other while flipped rows stay explicit"""
    visible_entries = [
        _make_entry(uuid.UUID(f"00000000-0000-0000-0000-{index:012d}"), f"Visible {index}", CategoryKind.EXPENSE, 100_000 - index)
        for index in range(1, 7)
    ]
    hidden_same_kind = _make_entry(
        uuid.UUID("00000000-0000-0000-0000-000000000101"),
        "Small Expense",
        CategoryKind.EXPENSE,
        1_000,
    )
    hidden_flipped_kind = _make_entry(
        uuid.UUID("00000000-0000-0000-0000-000000000102"),
        "Hidden Income Loss",
        CategoryKind.INCOME,
        500,
    )

    limited_categories = get_limited_spending_breakdown_categories(
        [*visible_entries, hidden_flipped_kind, hidden_same_kind],
        CategoryKind.EXPENSE,
    )

    assert [category.name for category in limited_categories] == [
        "Visible 1",
        "Visible 2",
        "Visible 3",
        "Visible 4",
        "Visible 5",
        "Visible 6",
        "Hidden Income Loss",
        "Other",
    ]
    assert limited_categories[-2].category_kind == "income"
    assert limited_categories[-2].amount == 500
    assert limited_categories[-1].category_kind == "expense"
    assert limited_categories[-1].amount == 1_000


@given(category_data=_CATEGORY_TOTALS)
def test_get_spending_breakdown_categories_by_sign_preserves_generated_totals(category_data):
    """Sign-based splitting preserves generated category totals"""
    category_totals = _make_category_totals(category_data)

    expense_categories, income_categories = get_spending_breakdown_categories_by_sign(category_totals)
    expense_total, income_total = get_spending_breakdown_totals(expense_categories, income_categories)

    expected_expense_amount = sum(-amount for _, amount in category_data if amount < 0)
    expected_income_amount = sum(amount for _, amount in category_data if amount > 0)
    expected_expense_refunds = sum(amount for kind, amount in category_data if kind == CategoryKind.EXPENSE and amount > 0)
    expected_income_losses = sum(-amount for kind, amount in category_data if kind == CategoryKind.INCOME and amount < 0)

    assert sum(category.amount for category in expense_categories) == expected_expense_amount
    assert sum(category.amount for category in income_categories) == expected_income_amount
    assert expense_total == max(expected_expense_amount - expected_expense_refunds, 0)
    assert income_total == max(expected_income_amount - expected_income_losses, 0)
    assert expense_categories == sorted(expense_categories, key=lambda category: (-category.amount, category.name))
    assert income_categories == sorted(income_categories, key=lambda category: (-category.amount, category.name))


@given(
    kind=st.sampled_from(_BREAKDOWN_KINDS),
    category_data=_VISIBLE_CATEGORY_DATA,
)
def test_get_limited_spending_breakdown_categories_preserves_generated_totals(kind, category_data):
    """Category limiting preserves generated totals while grouping hidden same-kind rows"""
    categories = _make_generated_entries(category_data)

    limited_categories = get_limited_spending_breakdown_categories(categories, kind)

    visible_categories = categories[:6]
    hidden_categories = categories[6:]
    hidden_flipped_categories = [category for category in hidden_categories if category.category_kind != kind]
    hidden_same_kind_amount = sum(category.amount for category in hidden_categories if category.category_kind == kind)

    assert limited_categories[: len(visible_categories)] == visible_categories
    assert sum(category.amount for category in limited_categories) == sum(category.amount for category in categories)

    if hidden_same_kind_amount > 0:
        assert limited_categories[len(visible_categories) : -1] == hidden_flipped_categories
        assert limited_categories[-1].name == "Other"
        assert limited_categories[-1].category_kind == kind
        assert limited_categories[-1].amount == hidden_same_kind_amount
    else:
        assert limited_categories[len(visible_categories) :] == hidden_flipped_categories
