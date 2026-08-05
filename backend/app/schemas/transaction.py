"""Transaction schemas"""

import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, Field

from app.models.base import TransferCounterpartyScope
from app.schemas.fx import FxStatus

# Rows one import may carry, matching the cap the file reader applies before a file is staged. A
# run is refused past it here as well, since the reader runs in the browser
MAX_IMPORT_ROWS = 100_000

# One batch becomes a single insert carrying five bind parameters per row, and a statement may
# carry 65535 of them, so a batch past about 13000 rows fails inside the driver rather than being
# refused. The browser closes a batch on its byte budget long before this, at roughly 4000 rows.
# The Firefly III import reuses the figure, where a row carries more fields and a batch of them
# reaches roughly 2000 rows against the same byte budget
MAX_IMPORT_BATCH_ROWS = 5_000

# Account or category mappings one import may carry, applied both to a single batch and to the total
# a run accumulates across its batches. Staging checks every mapping against the database, one query
# for an existing account and two for one being created, so the count decides the work a single
# request costs. No statement file has more than a handful of accounts or more than dozens of
# categories
MAX_IMPORT_MAPPINGS = 1_000

# Characters of notes one row may carry, against a column that would otherwise take a megabyte a
# row. Long enough for a full statement memo line and the reference numbers banks append to it
MAX_IMPORT_NOTES_LENGTH = 10_000

# Tags one row may carry, and characters one tag name may carry. The length matches the column tags
# are stored in, so a name too long is refused as the batch carrying it is staged rather than at the
# commit, once the rows are already parked
MAX_IMPORT_TAGS_PER_ROW = 32
MAX_IMPORT_TAG_NAME_LENGTH = 64

# Characters a payee may carry, matching the column merchants are stored in
MAX_IMPORT_MERCHANT_NAME_LENGTH = 256

# One imported tag name, bounded so that the count and the length are stated in one place for both
# importers
ImportTagName = Annotated[str, Field(max_length=MAX_IMPORT_TAG_NAME_LENGTH)]


class TopCategorySpend(BaseModel):
    """One row in the top-categories breakdown."""

    category_id: uuid.UUID
    category_name: str
    total: int


class DailyCashFlow(BaseModel):
    """Inflow and outflow totals for one cash-flow chart period."""

    date: date
    end_date: date
    inflow: int
    outflow: int


class OutlierTransaction(BaseModel):
    """A large expense-side transaction contribution surfaced as unusual."""

    id: uuid.UUID
    merchant_name: str | None
    notes: str | None
    amount: int
    currency: str
    dt: date


class TransactionsOverview(BaseModel):
    """Aggregated metrics for the transactions page header

    Nullable fields signal "no data for this period" — the frontend can
    show a placeholder instead of rendering empty charts
    """

    total_inflow: int | None
    total_outflow: int | None
    net_flow_fx_status: FxStatus = Field(default_factory=FxStatus)
    top_categories: list[TopCategorySpend] | None
    top_categories_fx_status: FxStatus = Field(default_factory=FxStatus)
    daily_cash_flow: list[DailyCashFlow] | None
    daily_cash_flow_fx_status: FxStatus = Field(default_factory=FxStatus)
    outliers: list[OutlierTransaction] | None
    outliers_fx_status: FxStatus = Field(default_factory=FxStatus)


class TransactionTagSummary(BaseModel):
    """Tag summary embedded in transaction responses."""

    id: uuid.UUID
    group_id: uuid.UUID | None
    name: str


class TransactionResponse(BaseModel):
    """Transaction returned by list and detail endpoints."""

    id: uuid.UUID
    created_by_user_id: uuid.UUID
    account_id: uuid.UUID
    dt: date
    merchant_id: uuid.UUID | None
    merchant_name: str | None = None
    category_id: uuid.UUID
    amount: int
    account_amount: int | None = None
    base_currency_amount: int | None = None
    currency: str
    fx_rate: float | None
    notes: str | None

    # Where the counterparty of a transfer sits. Both null on anything recorded before the columns existed
    counterparty_account_id: uuid.UUID | None = None
    counterparty_account_scope: TransferCounterpartyScope | None = None
    created_at: datetime
    updated_at: datetime
    tag_ids: list[uuid.UUID] = []
    tags: list[TransactionTagSummary] = []

    model_config = {"from_attributes": True}


class CreateTransactionRequest(BaseModel):
    """Create a new transaction for the authenticated user."""

    account_id: uuid.UUID
    dt: date
    category_id: uuid.UUID
    amount: int
    currency: str = Field(min_length=3, max_length=3)

    # Required, unlike the stored column, which stays nullable for the transactions written before
    # this rule and for the ones an import brings in without a payee
    merchant_id: uuid.UUID
    fx_rate: float | None = Field(None, gt=0)
    notes: str | None = None
    tag_ids: list[uuid.UUID] = []
    counterparty_account_id: uuid.UUID | None = None
    counterparty_account_scope: TransferCounterpartyScope | None = None


class UpdateTransactionRequest(BaseModel):
    """Partial update for a transaction."""

    account_id: uuid.UUID | None = None
    dt: date | None = None
    merchant_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    amount: int | None = None
    fx_rate: float | None = Field(None, gt=0)
    notes: str | None = None
    tag_ids: list[uuid.UUID] | None = None
    counterparty_account_id: uuid.UUID | None = None
    counterparty_account_scope: TransferCounterpartyScope | None = None


class TransactionImportCreateAccount(BaseModel):
    """New personal account to create during a transaction import."""

    name: str = Field(min_length=1, max_length=256)
    account_type: str
    currency: str = Field(min_length=3, max_length=3)
    institution_id: uuid.UUID | None = None


class TransactionImportAccountMapping(BaseModel):
    """Resolve one imported account source to an account, or to the accounts this app does not keep."""

    source: str = Field(min_length=1, max_length=256)
    account_id: uuid.UUID | None = None
    create: TransactionImportCreateAccount | None = None

    # A source appearing only as a transfer counterparty can be answered as money that left
    # the tracked accounts, which no account row expresses. Rows are never written to such a source
    outside: bool = False


class TransactionImportCreateCategory(BaseModel):
    """New personal category to create during a transaction import."""

    name: str = Field(min_length=1, max_length=256)
    kind: str
    icon: str | None = None


class TransactionImportCategoryMapping(BaseModel):
    """Resolve one imported category source to an existing or new category."""

    source: str = Field(min_length=1, max_length=256)
    category_id: uuid.UUID | None = None
    create: TransactionImportCreateCategory | None = None


class TransactionImportRow(BaseModel):
    """One frontend-compiled import row. Amount is the raw CSV value, not minor units."""

    account_source: str = Field(min_length=1, max_length=256)
    category_source: str = Field(min_length=1, max_length=256)
    dt: date
    amount: str = Field(min_length=1, max_length=64)
    merchant_name: str | None = Field(None, max_length=MAX_IMPORT_MERCHANT_NAME_LENGTH)
    notes: str | None = Field(None, max_length=MAX_IMPORT_NOTES_LENGTH)
    tag_names: list[ImportTagName] = Field(default=[], max_length=MAX_IMPORT_TAGS_PER_ROW)

    # Counterparty account source, meaning the account the money moved to or from. A transfer row
    # that leaves it unset records that the money left the tracked accounts
    counterparty_account_source: str | None = Field(None, min_length=1, max_length=256)


class TransactionImportRequest(BaseModel):
    """A whole staged file, rebuilt from its run at commit time and handed to the import service."""

    accounts: list[TransactionImportAccountMapping] = Field(min_length=1)
    categories: list[TransactionImportCategoryMapping] = Field(min_length=1)
    rows: list[TransactionImportRow] = Field(min_length=1)


class TransactionImportRunRequest(BaseModel):
    """Open a run for a file about to be staged."""

    expected_transaction_count: int = Field(gt=0, le=MAX_IMPORT_ROWS)


class TransactionImportRunResponse(BaseModel):
    """The opened run, which every later call for this file quotes."""

    id: uuid.UUID


class TransactionImportStageRequest(BaseModel):
    """One batch of a staged file: the mappings its rows reference, and the rows themselves."""

    accounts: list[TransactionImportAccountMapping] = Field(min_length=1, max_length=MAX_IMPORT_MAPPINGS)
    categories: list[TransactionImportCategoryMapping] = Field(min_length=1, max_length=MAX_IMPORT_MAPPINGS)
    rows: list[TransactionImportRow] = Field(min_length=1, max_length=MAX_IMPORT_BATCH_ROWS)

    # Where this batch starts in the file, so a batch sent twice stages the same positions and the
    # unique constraint on them absorbs the second copy. A position already staged keeps what it
    # was first given, so a caller wanting different rows there opens a new run
    start_row_index: int = Field(ge=0)


class TransactionImportResponse(BaseModel):
    """Summary of records created or reused by a transaction import."""

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
