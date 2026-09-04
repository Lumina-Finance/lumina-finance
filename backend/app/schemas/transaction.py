"""Transaction schemas"""

import enum
import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, Field, ValidationInfo, field_validator, model_validator

from app.models.base import TransferCounterpartyScope
from app.schemas.fx import FxStatus
from app.schemas.names import TrimmedName

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

# Transactions one bulk edit may carry, matching the mapping cap above, since both bound an id list
# a single request checks row by row against the database. The list loads 15 rows at a time and a
# selection is built from rows already loaded, so reaching this takes roughly 67 pages of scrolling
MAX_BULK_UPDATE_TRANSACTIONS = 1_000

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
    """A transaction surfaced as one of the period's largest single outflows."""

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


class TransferEnd(BaseModel):
    """One side of a transfer: an account tracked in this app, or outside it.

    Either end may answer outside, since this model does not know which end a row's own direction
    will make it. The bulk service refuses an end resolved as a row's own when it answers outside,
    since a row cannot sit outside this app itself.
    """

    scope: TransferCounterpartyScope
    account_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def check_account_agrees_with_scope(self) -> TransferEnd:
        """Reject an end whose account contradicts its scope.

        Raises:
            ValueError: A tracked scope names no account, or another scope names one
        """
        tracked = self.scope == TransferCounterpartyScope.TRACKED
        if tracked and self.account_id is None:
            raise ValueError("account_id is required when the scope is tracked")
        if not tracked and self.account_id is not None:
            raise ValueError("account_id is not allowed unless the scope is tracked")
        return self


class BulkDirectionChange(enum.StrEnum):
    """Which way a bulk edit turns a transaction, applied as the sign of its amount."""

    DEBIT = "debit"  # Money out, a negative amount
    CREDIT = "credit"  # Money in, a positive amount
    REVERSE = "reverse"  # The opposite of whatever each row already points, judged per row


# Fields a bulk edit may leave out but may never send as null. Most of them write a column that has
# no null, where sending one would reach the database as an integrity error, and a null merchant
# would take the merchant off a row the edit rules require to have one. Direction and
# transfer_direction are not columns of their own that a null could be written into, both writing
# the amount column instead, and are here because a null would still count as asked for and turn
# every row either of them reaches outward. Either transfer end is the same: a null end still
# counts as asked for and has no account or scope of its own to resolve
_BULK_UPDATE_NON_NULLABLE_FIELDS = (
    "account_id", "dt", "category_id", "merchant_id", "direction", "transfer_direction",
    "transfer_from", "transfer_to",
)


class BulkUpdateTransactionsRequest(BaseModel):
    """Set shared details on several transactions at once.

    A field left out is left alone on every transaction. That is why the service reads which fields
    the request carried rather than which are non-null: `notes` takes null as a real answer, meaning
    clear it.
    """

    transaction_ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_BULK_UPDATE_TRANSACTIONS)
    account_id: uuid.UUID | None = None
    dt: date | None = None
    category_id: uuid.UUID | None = None
    merchant_id: uuid.UUID | None = None

    # Bounded here although the single-transaction update is not, which LF-387 covers
    notes: str | None = Field(None, max_length=MAX_IMPORT_NOTES_LENGTH)

    # Added to whatever each transaction already carries, unlike the single-transaction update,
    # which replaces the whole list
    add_tag_ids: list[uuid.UUID] = []

    # Where a row's own account sits and what it records as the other side, once resolved against
    # its own resulting direction. Which of the two an unset field leaves alone is not fixed by name
    transfer_from: TransferEnd | None = None
    transfer_to: TransferEnd | None = None

    # Which way every transaction should end up pointing, applied as the sign of its amount. Reverse
    # flips each row's own direction rather than naming an absolute one, and a row already pointing
    # the way debit or credit asks for is left as it is
    direction: BulkDirectionChange | None = None

    # Applied exactly as direction is, but only to the rows whose resulting category records a far
    # side. Refused beside direction, since both set the sign of the same amount
    transfer_direction: BulkDirectionChange | None = None

    @field_validator(*_BULK_UPDATE_NON_NULLABLE_FIELDS, mode="before")
    @classmethod
    def reject_explicit_null(cls, value: object, info: ValidationInfo) -> object:
        """Reject a field sent as null that has no null to write.

        Runs only on a field the request carried, since a field taking its default is not validated.

        Raises:
            ValueError: The field was sent as null
        """
        if value is None:
            raise ValueError(f"{info.field_name} cannot be null")
        return value

    @model_validator(mode="after")
    def check_request_changes_something(self) -> BulkUpdateTransactionsRequest:
        """Reject a request that would report a count for a write it never made.

        Raises:
            ValueError: The request carried no field to set, or only an empty tag list
        """
        sent = self.model_fields_set - {"transaction_ids"}

        # An empty tag list adds no tag, so a request carrying only that changes nothing
        if not self.add_tag_ids:
            sent -= {"add_tag_ids"}
        if not sent:
            raise ValueError("A bulk edit must set at least one detail")
        return self

    @model_validator(mode="after")
    def check_ends_have_the_account_column_to_themselves(self) -> BulkUpdateTransactionsRequest:
        """Reject account_id sent together with either transfer end.

        An end writes account_id on every row whose resulting direction makes it that row's own end,
        and the request cannot tell which rows those are, so account_id beside an end is two answers
        for the same column.

        Raises:
            ValueError: account_id was sent with transfer_from or transfer_to
        """
        if "account_id" not in self.model_fields_set:
            return self
        if {"transfer_from", "transfer_to"} & self.model_fields_set:
            raise ValueError("account_id cannot be sent with transfer_from or transfer_to")
        return self

    @model_validator(mode="after")
    def check_direction_has_the_amount_sign_to_itself(self) -> BulkUpdateTransactionsRequest:
        """Reject direction sent together with transfer_direction.

        Both set the sign of the same amount, one for every row and the other for the rows whose
        resulting category records a far side, so sending both is two answers for that sign.

        Raises:
            ValueError: direction and transfer_direction were both sent
        """
        if {"direction", "transfer_direction"} <= self.model_fields_set:
            raise ValueError("direction cannot be sent with transfer_direction")
        return self


class BulkUpdateTransactionsResponse(BaseModel):
    """Summary of a bulk transaction edit."""

    transactions_updated: int
    affected_account_ids: list[uuid.UUID]


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


class TransactionImportCreateMerchant(BaseModel):
    """New personal merchant to create during a transaction import."""

    name: TrimmedName = Field(min_length=1, max_length=MAX_IMPORT_MERCHANT_NAME_LENGTH)


class TransactionImportMerchantMapping(BaseModel):
    """Resolve one payee value found in the file to a merchant, to a new one, or to none.

    Only the values the user answered by hand are declared. A payee left alone keeps what the
    importer does without being asked, matching an existing merchant by name and creating one where
    nothing matches, so a file carrying thousands of distinct descriptors is not refused for
    declaring more mappings than an import may carry.
    """

    source: str = Field(min_length=1, max_length=MAX_IMPORT_MERCHANT_NAME_LENGTH)
    merchant_id: uuid.UUID | None = None
    create: TransactionImportCreateMerchant | None = None

    # Answered skip, so the rows carrying this payee are filed under the merchant the app stamps on
    # a row stating no payee at all
    skip: bool = False


class TransactionImportRow(BaseModel):
    """One frontend-compiled import row.

    Amount carries the cell's own digits rather than minor units. Its sign is the frontend's where
    the file states direction by which column a value sits in, and the cell's own otherwise.
    """

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

    # Only the payee values the user answered by hand, so this is empty for a file whose merchants
    # were all left to match or be created by name
    merchants: list[TransactionImportMerchantMapping] = Field(default=[])
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

    # Carries no minimum, unlike the other two, because a batch whose payees were all left alone
    # declares none of them
    merchants: list[TransactionImportMerchantMapping] = Field(default=[], max_length=MAX_IMPORT_MAPPINGS)
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
