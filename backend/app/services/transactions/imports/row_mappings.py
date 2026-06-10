"""Transaction import row source mapping validation"""
import uuid

from fastapi import HTTPException, status

from app.models.account import Account
from app.models.category import Category
from app.services.transactions.imports.validation_helpers import strip_import_text_or_raise


def get_import_row_account(accounts_by_source: dict[str, Account], raw_account_source: str) -> Account:
    """Return the account mapped to an import row account source

    Args:
        accounts_by_source: Account lookup keyed by declared account source
        raw_account_source: Raw account source from an import row

    Returns:
        Account mapped to the import row account source

    Raises:
        HTTPException: Raised with 422 when the row references an undeclared account source
    """
    account_source = strip_import_text_or_raise(raw_account_source, "Account source")
    account = accounts_by_source.get(account_source)
    if account is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Account source is not mapped: {account_source}")
    return account


def get_import_row_category(categories_by_source: dict[str, Category], raw_category_source: str) -> Category:
    """Return the category mapped to an import row category source

    Args:
        categories_by_source: Category lookup keyed by declared category source
        raw_category_source: Raw category source from an import row

    Returns:
        Category mapped to the import row category source

    Raises:
        HTTPException: Raised with 422 when the row references an undeclared category source
    """
    category_source = strip_import_text_or_raise(raw_category_source, "Category source")
    category = categories_by_source.get(category_source)
    if category is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Category source is not mapped: {category_source}")
    return category


def validate_import_category_can_be_used_for_account(category: Category, account: Account, user_id: uuid.UUID) -> None:
    """Validate that an import row category can be used for the selected account

    Args:
        category: Category selected for the import row
        account: Account selected for the import row
        user_id: Identifier for the user running the import

    Returns:
        None

    Raises:
        HTTPException: Raised with 422 when the category cannot be used by the account
    """
    if category.is_system or (category.owner_id == user_id and category.group_id is None) or category.group_id == account.group_id:
        return
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")
