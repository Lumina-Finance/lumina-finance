"""Data import schemas for external finance app sources"""

import uuid
from datetime import date

from pydantic import BaseModel, Field

from app.schemas.transaction import (
    TransactionImportAccountMapping,
    TransactionImportCategoryMapping,
)

# Bounds the limit history one budget can carry, which covers a century of
# monthly limits
MAX_BUDGET_LIMIT_PERIODS = 1200


class FireflyTransactionRow(BaseModel):
    """One Firefly III export journal row compiled by the frontend

    Amounts are raw CSV strings so the backend can validate precision against
    the account currency. Sign conventions in the export are ignored, the
    backend derives direction from the journal type
    """

    journal_id: str = Field(min_length=1, max_length=64)
    type: str = Field(min_length=1, max_length=64)
    dt: date
    amount: str = Field(min_length=1, max_length=64)
    currency_code: str = Field(min_length=3, max_length=3)
    foreign_amount: str | None = Field(None, max_length=64)
    foreign_currency_code: str | None = Field(None, min_length=3, max_length=3)
    description: str | None = Field(None, max_length=1024)
    source_name: str | None = Field(None, max_length=256)
    source_type: str | None = Field(None, max_length=64)
    destination_name: str | None = Field(None, max_length=256)
    destination_type: str | None = Field(None, max_length=64)
    category: str | None = Field(None, max_length=256)
    tag_names: list[str] = []
    notes: str | None = None


class FireflyTransactionImportRequest(BaseModel):
    """Batch import frontend-compiled Firefly III export rows

    Account mappings must cover every asset and liability account name that
    appears in the rows. Category mappings must cover every category name plus
    the no-category placeholder when rows without a category are present
    """

    accounts: list[TransactionImportAccountMapping] = Field(min_length=1)
    categories: list[TransactionImportCategoryMapping] = []
    rows: list[FireflyTransactionRow] = Field(min_length=1)


class FireflyBudgetLimit(BaseModel):
    """One limit period from the Firefly III budgets export

    The amount is a raw CSV string so the backend can validate precision
    against the budget currency
    """

    start: date
    amount: str = Field(min_length=1, max_length=64)


class FireflyBudgetImport(BaseModel):
    """One budget to create from a Firefly III export

    The period start is the backdated first period, and the limits carry the
    amount history so every materialized period keeps the amount that was in
    force at the time instead of one figure across the whole history
    """

    name: str = Field(min_length=1, max_length=256)
    currency: str = Field(min_length=3, max_length=3)
    category_ids: list[uuid.UUID] = Field(min_length=1)
    period_start: date
    limits: list[FireflyBudgetLimit] = Field(min_length=1, max_length=MAX_BUDGET_LIMIT_PERIODS)


class FireflyBudgetImportRequest(BaseModel):
    """Batch import budgets derived from a Firefly III export"""

    budgets: list[FireflyBudgetImport] = Field(min_length=1)


class FireflyBudgetImportResult(BaseModel):
    """One created budget with the periods materialized for it"""

    name: str
    base_budget_id: uuid.UUID
    instance_count: int


class FireflyBudgetImportResponse(BaseModel):
    """Summary of budgets created by a Firefly III budget import"""

    budgets_created: int
    results: list[FireflyBudgetImportResult]


class FireflySkippedRow(BaseModel):
    """One Firefly III row the importer could not convert"""

    journal_id: str
    reason: str


class FireflyTransactionImportResponse(BaseModel):
    """Summary of records created by a Firefly III transaction import

    Transfers between two imported accounts produce two Lumina transactions
    from one Firefly journal row, so transactions_created can exceed
    rows_imported
    """

    rows_imported: int
    rows_skipped: int
    skipped: list[FireflySkippedRow]
    transactions_created: int
    accounts_created: int
    accounts_reused: int
    categories_created: int
    categories_reused: int
    merchants_created: int
    merchants_reused: int
    tags_created: int
    tags_reused: int
    affected_account_ids: list[uuid.UUID]
    account_source_ids: dict[str, uuid.UUID]
    category_source_ids: dict[str, uuid.UUID]
    created_account_ids: list[uuid.UUID]
    created_category_ids: list[uuid.UUID]
    created_merchant_ids: list[uuid.UUID]
    created_tag_ids: list[uuid.UUID]
