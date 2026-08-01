"""Transaction import row source mapping validation"""
import uuid

from fastapi import HTTPException, status

from app.models.account import Account
from app.models.base import TransferOtherAccountScope
from app.models.category import Category
from app.services.categories.transfer_rules import does_category_record_other_account
from app.services.importers.shared.validation_helpers import strip_import_text_or_raise


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


def get_import_row_other_account(
    accounts_by_source: dict[str, Account],
    outside_sources: set[str],
    raw_other_account_source: str | None,
    category: Category,
    account: Account,
) -> tuple[uuid.UUID | None, TransferOtherAccountScope | None]:
    """Resolve the other side of an import row into the columns a transfer records

    Args:
        accounts_by_source: Account lookup keyed by declared account source
        outside_sources: Declared sources answered as money outside the tracked accounts
        raw_other_account_source: Raw other-account source from an import row, absent when the file
            does not state one
        category: Category the row uses
        account: Account the row is written to

    Returns:
        Other account ID and scope, both None when the file leaves the question unanswered

    Raises:
        HTTPException: Raised with 422 when the row cannot record the source it states
    """
    if raw_other_account_source is None:
        return None, None

    other_account_source = strip_import_text_or_raise(raw_other_account_source, "Other account source")
    if not does_category_record_other_account(category):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Only a transfer records the other account: {other_account_source}",
        )

    if other_account_source in outside_sources:
        return None, TransferOtherAccountScope.OUTSIDE

    other_account = accounts_by_source.get(other_account_source)
    if other_account is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Other account source is not mapped: {other_account_source}",
        )

    if other_account.id == account.id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"A transfer cannot record its own account as the other side: {other_account_source}",
        )
    return other_account.id, TransferOtherAccountScope.TRACKED


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
