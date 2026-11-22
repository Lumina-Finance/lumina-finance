"""The numbers that stand in for ids where one exported row points at another

A file whose rows others point at opens with a Number column counting 1, 2, 3 in its own order. The
numbers exist only inside the export, so no id leaves the app and two rows sharing a name stay apart
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, TaxAdvantagedCategory
from app.models.budget import BaseBudget
from app.models.category import Category
from app.services.data_export.scope import (
    is_personal_account,
    is_personal_budget,
    is_personal_category,
    is_personal_tax_advantaged_category,
)
from app.services.fx.currency_exponent_helpers import get_all_currency_exponents

# The order each numbered file lists its rows in. The numbers follow it, so a file and the rows that
# point into it always agree. The id breaks ties between rows made at the same moment
ACCOUNT_ORDER = (Account.created_at, Account.id)
BUDGET_ORDER = (BaseBudget.created_at, BaseBudget.id)
CATEGORY_ORDER = (Category.created_at, Category.id)
TAX_ADVANTAGED_CATEGORY_ORDER = (TaxAdvantagedCategory.created_at, TaxAdvantagedCategory.id)


@dataclass(frozen=True)
class Reference:
    """What a row pointing at another one writes: its name and the number its own file gave it"""

    number: int
    name: str


@dataclass(frozen=True)
class AccountReference(Reference):
    """An account's reference, with the currency its amounts are in"""

    currency: str


@dataclass(frozen=True)
class ExportReferences:
    """Everything the export's files point at, loaded once for the whole export"""

    accounts: dict[uuid.UUID, AccountReference]
    budgets: dict[uuid.UUID, Reference]
    categories: dict[uuid.UUID, Reference]
    tax_advantaged_categories: dict[uuid.UUID, Reference]

    # Names of every category the user can read, shared ones included. Only the user's own have a number
    category_names: dict[uuid.UUID, str]

    # Minor-unit exponent of every currency, since each money cell is written at its currency's
    exponents: dict[str, int]


async def load_references(db: AsyncSession, user_id: uuid.UUID) -> ExportReferences:
    """Number the user's own accounts, budgets, categories and tax-advantaged categories

    Args:
        db: Session inside the export's snapshot
        user_id: User exporting their data

    Returns:
        The references, each numbered in the order its file lists its rows
    """
    accounts_result = await db.execute(
        select(Account.id, Account.name, Account.currency).where(is_personal_account(user_id)).order_by(*ACCOUNT_ORDER)
    )
    budgets_result = await db.execute(select(BaseBudget.id, BaseBudget.name).where(is_personal_budget(user_id)).order_by(*BUDGET_ORDER))
    tax_advantaged_result = await db.execute(
        select(TaxAdvantagedCategory.id, TaxAdvantagedCategory.name)
        .where(is_personal_tax_advantaged_category(user_id))
        .order_by(*TAX_ADVANTAGED_CATEGORY_ORDER)
    )
    category_result = await db.execute(
        select(Category.id, Category.name, is_personal_category(user_id).label("is_personal")).order_by(*CATEGORY_ORDER)
    )

    categories: dict[uuid.UUID, Reference] = {}
    category_names: dict[uuid.UUID, str] = {}
    for category in category_result:
        category_names[category.id] = category.name
        if category.is_personal:
            categories[category.id] = Reference(len(categories) + 1, category.name)

    return ExportReferences(
        accounts={row.id: AccountReference(number, row.name, row.currency) for number, row in enumerate(accounts_result, start=1)},
        budgets={row.id: Reference(number, row.name) for number, row in enumerate(budgets_result, start=1)},
        categories=categories,
        tax_advantaged_categories={row.id: Reference(number, row.name) for number, row in enumerate(tax_advantaged_result, start=1)},
        category_names=category_names,
        exponents=await get_all_currency_exponents(db),
    )
