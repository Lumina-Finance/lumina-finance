"""Which categories record the counterparty account of a movement

The write path and the tax-advantaged totals have to agree on this: a transaction that must answer
the question is a transaction whose answer is then read when the limits are counted. Keeping the
rule in one place is what stops a row validating under one definition and counting under another
"""

from sqlalchemy.sql.elements import ColumnElement

from app.models.base import CategoryKind
from app.models.category import Category

# The one transfer-kind category with no counterparty account, since it corrects a stale balance
# rather than moving money anywhere
BALANCE_ADJUSTMENT_CATEGORY_NAME = "Balance Adjustment"


def does_category_record_counterparty_account(category: Category) -> bool:
    """Return whether transactions in a category record the counterparty account

    Args:
        category: Category row the transaction uses

    Returns:
        True for every transfer-kind category except Balance Adjustment
    """
    return category.kind == CategoryKind.TRANSFER and category.name != BALANCE_ADJUSTMENT_CATEGORY_NAME


def get_records_counterparty_account_filter() -> ColumnElement[bool]:
    """Return the same rule as a condition for queries joined against categories

    Returns:
        SQLAlchemy condition matching every transfer-kind category except Balance Adjustment
    """
    return (Category.kind == CategoryKind.TRANSFER) & (Category.name != BALANCE_ADJUSTMENT_CATEGORY_NAME)
