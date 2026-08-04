"""Transaction import row source mapping validation"""
import uuid

from fastapi import HTTPException, status

from app.models.account import Account
from app.models.base import TransferCounterpartyScope
from app.models.category import Category
from app.services.categories.transfer_rules import does_category_record_counterparty_account
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


def get_import_row_counterparty_account(
    accounts_by_source: dict[str, Account],
    outside_sources: set[str],
    raw_counterparty_source: str | None,
    category: Category,
    account: Account,
) -> tuple[uuid.UUID | None, TransferCounterpartyScope | None]:
    """Resolve a transfer row's counterparty into the columns the transaction records

    Args:
        accounts_by_source: Account lookup keyed by declared account source
        outside_sources: Declared sources answered as money outside the tracked accounts
        raw_counterparty_source: Raw counterparty account source from an import row, absent when the
            file does not state one
        category: Category the row uses
        account: Account the row is written to

    Returns:
        Counterparty account ID and scope, both None for a category that records neither

    Raises:
        HTTPException: Raised with 422 when the row cannot record the source it states
    """
    if raw_counterparty_source is None:
        # An import that states no counterparty records that the money left the tracked accounts.
        # Leaving it unanswered would count the same against a limit while also blocking every later
        # edit of the transaction until someone answers it by hand
        if does_category_record_counterparty_account(category):
            return None, TransferCounterpartyScope.OUTSIDE
        return None, None

    counterparty_source = strip_import_text_or_raise(raw_counterparty_source, "Counterparty account source")
    if not does_category_record_counterparty_account(category):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Only a transfer records a counterparty account: {counterparty_source}",
        )

    if counterparty_source in outside_sources:
        return None, TransferCounterpartyScope.OUTSIDE

    counterparty_account = accounts_by_source.get(counterparty_source)
    if counterparty_account is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Counterparty account source is not mapped: {counterparty_source}",
        )

    if counterparty_account.id == account.id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"A transfer cannot record its own account as its counterparty: {counterparty_source}",
        )
    return counterparty_account.id, TransferCounterpartyScope.TRACKED


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
    # The group clause requires a group, since two personal records both carry no group and would
    # otherwise match each other, admitting another user's personal category
    shares_a_group = category.group_id is not None and category.group_id == account.group_id
    if category.is_system or (category.owner_id == user_id and category.group_id is None) or shares_a_group:
        return
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")
