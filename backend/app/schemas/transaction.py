import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from app.schemas.fx import FxStatus


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
    """Aggregated metrics for the transactions page header.

    Nullable fields signal "no data for this period" — the frontend can
    show a placeholder instead of rendering empty charts.
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
    currency: str
    fx_rate: float | None
    notes: str | None
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
    merchant_id: uuid.UUID | None = None
    fx_rate: float | None = Field(None, gt=0)
    notes: str | None = None
    tag_ids: list[uuid.UUID] = []


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


class TransactionImportCreateAccount(BaseModel):
    """New personal account to create during a transaction import."""

    name: str = Field(min_length=1, max_length=256)
    account_type: str
    currency: str = Field(min_length=3, max_length=3)
    institution_id: uuid.UUID | None = None


class TransactionImportAccountMapping(BaseModel):
    """Resolve one imported account source to an existing or new account."""

    source: str = Field(min_length=1, max_length=256)
    account_id: uuid.UUID | None = None
    create: TransactionImportCreateAccount | None = None


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
    merchant_name: str | None = Field(None, max_length=256)
    notes: str | None = None
    tag_names: list[str] = []


class TransactionImportRequest(BaseModel):
    """Batch import frontend-compiled CSV transactions."""

    accounts: list[TransactionImportAccountMapping] = Field(min_length=1)
    categories: list[TransactionImportCategoryMapping] = Field(min_length=1)
    rows: list[TransactionImportRow] = Field(min_length=1)


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
