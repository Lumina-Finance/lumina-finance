"""Firefly III import request and response schemas"""

import uuid
from datetime import date

from pydantic import BaseModel, Field, model_validator

from app.models.base import RecurrenceFreq
from app.schemas.budget import validate_recurrence_anchor_fields
from app.schemas.transaction import (
    MAX_IMPORT_BATCH_ROWS,
    MAX_IMPORT_MAPPINGS,
    MAX_IMPORT_NOTES_LENGTH,
    MAX_IMPORT_TAGS_PER_ROW,
    ImportTagName,
    TransactionImportAccountMapping,
    TransactionImportCategoryMapping,
)

# Bounds the limit history one budget can carry, which covers a century of
# monthly limits or two decades of weekly ones
MAX_BUDGET_LIMIT_PERIODS = 1200

# Budgets one request may carry, and categories one budget may track. These
# bound validation and batched writes for one request while remaining far
# above any real export
MAX_FIREFLY_BUDGETS = 1000
MAX_FIREFLY_BUDGET_CATEGORIES = 1000

# Longest cadence a base budget stores, the largest value its small-integer column holds
MAX_BUDGET_INSTANCE_LENGTH = 32767


class FireflyTransactionRow(BaseModel):
    """One Firefly III export journal row compiled by the frontend

    Amounts are trimmed decimal text without grouping separators so the backend
    can validate precision against the account currency. Sign conventions in the export are ignored, the
    backend derives direction from the journal type

    The frontend decides which endpoints are imported accounts. Each one is named by the account
    mapping source it resolves through, since Firefly III lets an asset account and a liability
    share a name, and every other endpoint is named as it appears in the export
    """

    journal_id: str = Field(min_length=1, max_length=64)
    type: str = Field(min_length=1, max_length=64)
    dt: date
    amount: str = Field(min_length=1, max_length=64)
    currency_code: str = Field(min_length=3, max_length=3)
    foreign_amount: str | None = Field(None, max_length=64)
    foreign_currency_code: str | None = Field(None, min_length=3, max_length=3)
    description: str | None = Field(None, max_length=1024)
    source_account: str | None = Field(None, min_length=1, max_length=256)
    source_name: str | None = Field(None, max_length=256)
    destination_account: str | None = Field(None, min_length=1, max_length=256)
    destination_name: str | None = Field(None, max_length=256)
    category: str | None = Field(None, max_length=256)
    tag_names: list[ImportTagName] = Field(default=[], max_length=MAX_IMPORT_TAGS_PER_ROW)
    notes: str | None = Field(None, max_length=MAX_IMPORT_NOTES_LENGTH)


class FireflyTransactionImportRequest(BaseModel):
    """Batch import frontend-compiled Firefly III export rows

    Account mappings must cover every account source the rows name. Category mappings must cover every category name plus
    the no-category placeholder when rows without a category are present
    """

    accounts: list[TransactionImportAccountMapping] = Field(min_length=1, max_length=MAX_IMPORT_MAPPINGS)
    categories: list[TransactionImportCategoryMapping] = Field(default=[], max_length=MAX_IMPORT_MAPPINGS)
    rows: list[FireflyTransactionRow] = Field(min_length=1, max_length=MAX_IMPORT_BATCH_ROWS)


class FireflyBudgetLimit(BaseModel):
    """One limit period from the Firefly III budgets export

    Both dates are inclusive, matching how the export expresses a period. The
    amount is trimmed decimal text without grouping separators so the backend
    can validate precision against the budget currency
    """

    start: date
    end: date
    amount: str = Field(min_length=1, max_length=64)


class FireflyBudgetRecurrence(BaseModel):
    """The cadence an imported budget continues on, read off its latest limit period by the frontend

    The anchor fields follow the budget create rules, and the backend checks that the latest
    limit period is exactly one period of this cadence
    """

    freq: RecurrenceFreq
    instance_length: int = Field(ge=1, le=MAX_BUDGET_INSTANCE_LENGTH)
    weekday: int | None = Field(None, ge=0, le=6)
    dom: int | None = Field(None, ge=1, le=31)
    month: int | None = Field(None, ge=1, le=12)

    @model_validator(mode="after")
    def _validate_anchor_fields(self):
        """Enforce that exactly the right anchor fields are set for the cadence"""
        validate_recurrence_anchor_fields(self.freq, self.weekday, self.dom, self.month)
        return self


class FireflyBudgetImport(BaseModel):
    """One budget to create from a Firefly III export

    Every limit period becomes one budget period with its exported dates and
    amount, so the history arrives as it was lived rather than reshaped onto
    a single cadence. An archived budget arrives with its history frozen and
    stays out of the active list

    The recurrence must always be sent, null meaning the latest period fits no cadence and the
    budget imports not recurring, so a request that leaves it out is refused rather than read as
    not recurring
    """

    name: str = Field(min_length=1, max_length=256)
    currency: str = Field(min_length=3, max_length=3)
    category_ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_FIREFLY_BUDGET_CATEGORIES)
    limits: list[FireflyBudgetLimit] = Field(min_length=1, max_length=MAX_BUDGET_LIMIT_PERIODS)
    recurrence: FireflyBudgetRecurrence | None
    is_archived: bool = False


class FireflyBudgetImportRequest(BaseModel):
    """Batch import budgets derived from a Firefly III export"""

    budgets: list[FireflyBudgetImport] = Field(min_length=1, max_length=MAX_FIREFLY_BUDGETS)


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
