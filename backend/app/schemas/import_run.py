"""What a provider import run writes after its transactions: budgets and accounts to archive"""

from pydantic import BaseModel, Field

from app.schemas.firefly_import import (
    MAX_BUDGET_LIMIT_PERIODS,
    MAX_FIREFLY_BUDGET_CATEGORIES,
    MAX_FIREFLY_BUDGETS,
    FireflyBudgetLimit,
    FireflyBudgetRecurrence,
)
from app.schemas.transaction import MAX_IMPORT_MAPPINGS, TransactionImportCategoryMapping


class ImportBudgetDraft(BaseModel):
    """One budget a run creates once its transactions are written

    Everything a budget import states, except that tracked categories are named by category mapping
    source, since a category the same import creates has no id until the commit
    """

    name: str = Field(min_length=1, max_length=256)
    currency: str = Field(min_length=3, max_length=3)
    category_sources: list[str] = Field(min_length=1, max_length=MAX_FIREFLY_BUDGET_CATEGORIES)
    limits: list[FireflyBudgetLimit] = Field(min_length=1, max_length=MAX_BUDGET_LIMIT_PERIODS)
    recurrence: FireflyBudgetRecurrence | None
    is_archived: bool = False


class ImportRunBudgetsRequest(BaseModel):
    """Every budget a run creates, replacing what it held, with the category mappings they need

    A budget can track a category no staged row uses, so the mappings it needs are declared here
    as well and merged into the run's like a batch's
    """

    categories: list[TransactionImportCategoryMapping] = Field(default=[], max_length=MAX_IMPORT_MAPPINGS)
    budgets: list[ImportBudgetDraft] = Field(default=[], max_length=MAX_FIREFLY_BUDGETS)


class ImportRunArchiveRequest(BaseModel):
    """Every account a run archives once everything else is written, replacing what it held

    Each is named by the account mapping source it resolves through
    """

    account_sources: list[str] = Field(default=[], max_length=MAX_IMPORT_MAPPINGS)
