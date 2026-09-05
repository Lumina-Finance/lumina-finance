"""Account schemas"""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from app.schemas.dashboard import RangeKind
from app.schemas.fx import FxStatus
from app.schemas.institution import InstitutionResponse


class AccountsOverview(BaseModel):
    """One row in `GET /accounts` — the trimmed shape used by the /accounts page and dashboard

    Excludes `created_at`, which is detail-only and lives on AccountResponse
    """

    id: uuid.UUID
    owner_id: uuid.UUID | None
    group_id: uuid.UUID | None
    account_kind: str
    account_type: str
    tax_advantaged_category_id: uuid.UUID | None
    name: str
    institution: InstitutionResponse | None
    currency: str
    current_balance: int
    base_currency_current_balance: int | None = None
    current_balance_fx_status: FxStatus = Field(default_factory=FxStatus)
    credit_limit: int | None

    # Effective transaction write permission for the caller, independent of lifecycle state
    can_write: bool
    is_archived: bool
    closed_at: datetime | None

    model_config = {"from_attributes": True}


class AccountResponse(BaseModel):
    """Full account detail returned by `GET /accounts/{id}`, `POST /accounts`, and `PATCH /accounts/{id}`."""

    id: uuid.UUID
    owner_id: uuid.UUID | None
    group_id: uuid.UUID | None
    account_kind: str
    account_type: str
    tax_advantaged_category_id: uuid.UUID | None
    name: str
    institution: InstitutionResponse | None
    currency: str
    current_balance: int
    base_currency_current_balance: int | None = None
    current_balance_fx_status: FxStatus = Field(default_factory=FxStatus)
    credit_limit: int | None

    # Effective transaction write permission for the caller, independent of lifecycle state
    can_write: bool
    is_archived: bool
    closed_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateAccountRequest(BaseModel):
    """Create a new account. Either personal (default) or group-scoped."""

    account_kind: str  # AccountKind enum value — must be consistent with account_type
    account_type: str  # AccountType enum value
    tax_advantaged_category_id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=256)
    institution_id: uuid.UUID | None = None
    currency: str = Field(min_length=3, max_length=3)
    credit_limit: int | None = None  # Only valid on liability accounts
    starting_balance: int | None = None  # Signed initial balance adjustment in minor units
    is_archived: bool = False
    group_id: uuid.UUID | None = None


class UpdateAccountRequest(BaseModel):
    """Partial update for an account. Only provided fields are changed."""

    tax_advantaged_category_id: uuid.UUID | None = None
    name: str | None = Field(None, min_length=1, max_length=256)
    institution_id: uuid.UUID | None = None
    credit_limit: int | None = None  # Only valid on liability accounts
    is_archived: bool | None = None
    closed_at: datetime | None = None


class AccountBalanceSnapshotResponse(BaseModel):
    """End-of-day balance record. Backend-maintained, derived from transactions."""

    account_id: uuid.UUID
    balance: int  # In currency base units
    dt: date

    model_config = {"from_attributes": True}


class AccountTopCategory(BaseModel):
    """One row in the account's top-spending-categories breakdown

    ``total`` is a positive minor-unit sum — expense amounts are flipped so the
    frontend renders both categories and merchants with the same formatter
    """

    category_id: uuid.UUID
    name: str
    total: int


class AccountTopMerchant(BaseModel):
    """One row in the account's top-spending-merchants breakdown

    ``total`` is a positive minor-unit sum (see :class:`AccountTopCategory`)
    """

    merchant_id: uuid.UUID
    name: str
    total: int


class AccountSpendingBreakdown(BaseModel):
    """Top-5 category and merchant spend for a single account over a calendar range

    Backs the spending-by-category and top-merchants cards on the account
    detail page. Scoped to ``Category.kind == EXPENSE`` so transfers and income
    don't leak into either breakdown; merchants are further narrowed by an
    inner join (transactions without a merchant are dropped)

    A category and a merchant each qualify on their own net, so each card carries
    its own total rather than sharing one. ``categories_total_spend`` and
    ``merchants_total_spend`` sum the entries that still net spending, hidden ones
    included, so each card's rows always add up to its own total and the two
    totals can differ. The frontend divides each row by its card's total to draw
    the proportional fills and displays that total on the "Total" row. An entry
    whose refunds outweigh its purchases is not spending, so it is absent from
    both the rows and the total. ``other_categories_count`` and
    ``other_merchants_count`` are the number of distinct categories/merchants
    with spend *beyond* the top 5, so the frontend can render an "Other (N)"
    row without a second request. They are ``0`` when ≤ 5 distinct entries exist
    """

    range: RangeKind
    top_categories: list[AccountTopCategory]
    top_merchants: list[AccountTopMerchant]
    categories_total_spend: int
    merchants_total_spend: int
    other_categories_count: int
    other_merchants_count: int
