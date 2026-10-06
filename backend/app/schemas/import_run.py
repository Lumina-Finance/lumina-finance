"""Import run request and response schemas and the caps they enforce, for the CSV, Firefly III and Actual Budget imports"""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, model_validator

from app.models.base import RecurrenceFreq
from app.schemas.budget import validate_recurrence_anchor_fields
from app.schemas.names import TrimmedName

# Rows one import may carry, matching the cap the file reader applies before a file is staged. A
# run is refused past it here as well, since the reader runs in the browser
MAX_IMPORT_ROWS = 100_000

# One batch becomes a single insert carrying five bind parameters per row, and a statement may
# carry 65535 of them, so a batch past about 13000 rows fails inside the driver rather than being
# refused. The browser closes a batch on its byte budget long before this, at roughly 4000 rows.
# The journal import reuses the figure, where a row carries more fields and a batch of them
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

# Bounds the limit history one budget can carry, which covers a century of
# monthly limits or two decades of weekly ones
MAX_BUDGET_LIMIT_PERIODS = 1200

# Budgets one request may carry, and categories one budget may track. These
# bound validation and batched writes for one request while remaining far
# above any real export
MAX_JOURNAL_BUDGETS = 1000
MAX_JOURNAL_BUDGET_CATEGORIES = 1000

# Longest cadence a base budget stores, the largest value its small-integer column holds
MAX_BUDGET_INSTANCE_LENGTH = 32767

# The characters JavaScript's String.prototype.trim removes, which is how the import screen trims
# every value it sends. Python's str.strip takes a different set, so the check names these exactly
_BROWSER_TRIMMED_WHITESPACE = (
    "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff"
)

# An amount as the import screen sends it: a magnitude in plain decimal text, since the journal
# type and the imported side carry the direction
_UNSIGNED_DECIMAL_PATTERN = r"^[0-9]+(\.[0-9]+)?$"
_CURRENCY_CODE_PATTERN = r"^[A-Z]{3}$"


def _require_trimmed(value: str) -> str:
    """Refuse text the import screen would have trimmed or left out

    Args:
        value: Text from the request

    Returns:
        The text unchanged

    Raises:
        ValueError: Raised when the text is blank or has whitespace at either end
    """
    if not value or value.strip(_BROWSER_TRIMMED_WHITESPACE) != value:
        raise ValueError("must be non-blank text with no whitespace at either end")
    return value


def _require_unique(values: list[str]) -> list[str]:
    """Refuse a list that repeats a value, which the import screen sends once

    Args:
        values: Values from the request

    Returns:
        The values unchanged

    Raises:
        ValueError: Raised when a value appears twice
    """
    if len(set(values)) != len(values):
        raise ValueError("must not repeat a value")
    return values


# One imported tag name, bounded so that the count and the length are stated in one place for both
# importers
ImportTagName = Annotated[str, Field(max_length=MAX_IMPORT_TAG_NAME_LENGTH)]

# Text the import screen has already trimmed, and sends as null rather than blank
TrimmedImportText = Annotated[str, AfterValidator(_require_trimmed)]
UnsignedDecimalAmount = Annotated[str, Field(min_length=1, max_length=64, pattern=_UNSIGNED_DECIMAL_PATTERN)]
CurrencyCode = Annotated[str, Field(pattern=_CURRENCY_CODE_PATTERN)]
JournalTagName = Annotated[ImportTagName, AfterValidator(_require_trimmed)]
UniqueTrimmedImportTexts = Annotated[list[TrimmedImportText], AfterValidator(_require_unique)]

# Journal types the importer handles, lowercased as the import screen sends them
JournalRowType = Literal["withdrawal", "deposit", "transfer", "opening balance", "reconciliation"]


class TransactionImportRunRequest(BaseModel):
    """Open a run for a file about to be staged."""

    expected_transaction_count: int = Field(gt=0, le=MAX_IMPORT_ROWS)

    # Which importer's rows the run stages, so each importer's commit reads only its own. Firefly III
    # and Actual Budget runs both stage journal rows, and the source decides how a refusal names a row
    source: Literal["generic", "firefly", "actual_budget"] = "generic"

    # The name of the file the user picked, shown with the last import. The page cuts a
    # longer one to fit
    file_name: str | None = Field(None, max_length=255)


class TransactionImportRunResponse(BaseModel):
    """The opened run, which every later call for this file quotes."""

    id: uuid.UUID


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


class JournalTransactionRow(BaseModel):
    """One journal row as the import screen compiles it from a Firefly III or Actual Budget export

    The screen reads the raw export and sends every value in its one canonical form, and a row in
    any other form is refused rather than cleaned up here. Types are lowercased, amounts are
    magnitudes in plain decimal text so their precision can be checked against the account
    currency, currency codes are upper case, and text is trimmed, with a missing value sent as null.
    A foreign amount comes with its currency code or not at all

    The frontend decides which endpoints are imported accounts. Each one is named by the account
    mapping source it resolves through, since an export can give an asset account and a liability
    the same name, and every other endpoint is named as it appears in the export. A payee row with
    no category is sent with the no-category mapping source for its direction, and a null category
    is filed under the money-out one
    """

    journal_id: TrimmedImportText = Field(max_length=64)
    type: JournalRowType
    dt: date
    amount: UnsignedDecimalAmount
    currency_code: CurrencyCode
    foreign_amount: UnsignedDecimalAmount | None = None
    foreign_currency_code: CurrencyCode | None = None
    description: TrimmedImportText | None = Field(None, max_length=1024)
    source_account: TrimmedImportText | None = Field(None, max_length=256)
    source_name: TrimmedImportText | None = Field(None, max_length=256)
    destination_account: TrimmedImportText | None = Field(None, max_length=256)
    destination_name: TrimmedImportText | None = Field(None, max_length=256)
    category: TrimmedImportText | None = Field(None, max_length=256)
    tag_names: Annotated[list[JournalTagName], AfterValidator(_require_unique)] = Field(
        default=[],
        max_length=MAX_IMPORT_TAGS_PER_ROW,
    )
    notes: TrimmedImportText | None = Field(None, max_length=MAX_IMPORT_NOTES_LENGTH)

    # The one leg of a transfer between two imported accounts that takes the row's mapped category,
    # while the other leg keeps the system Transfer category. An expense or income category makes
    # that leg spending or income with the other side's name as its merchant, and a transfer
    # category, which must record a counterparty account, keeps it a transfer. Budgets add up
    # signed amounts per tracked category across every account, so a category on both legs would
    # cancel out. Actual Budget uses this for a transfer from an on-budget account to an off-budget
    # one, such as a loan payment filed under a budget category. Both files both legs under the row's
    # category, which must then be a transfer category recording a counterparty account, as a
    # credit card payment is. Null files both legs under Transfer and ignores the row's category
    category_leg: Literal["source", "destination", "both"] | None = None

    @model_validator(mode="after")
    def _require_whole_foreign_amount(self):
        """Refuse a foreign amount without its currency code, or a code without its amount"""
        if (self.foreign_amount is None) != (self.foreign_currency_code is None):
            raise ValueError("foreign_amount and foreign_currency_code must be sent together")
        return self

    @model_validator(mode="after")
    def _require_categorized_transfer_for_category_leg(self):
        """Refuse a category leg on anything but a transfer that carries a category"""
        if self.category_leg is None:
            return self
        if self.type != "transfer":
            raise ValueError("category_leg is only allowed on a transfer")
        if self.category is None:
            raise ValueError("category_leg requires a category")
        return self


class JournalImportStageRequest(BaseModel):
    """One batch of a staged journal export: the mappings its rows reference, and the rows

    A batch declares the mappings its own rows need, and the first batch also declares any account
    the import creates without rows. Category mappings may be empty, since a batch of transfers and
    opening balances reads no category
    """

    accounts: list[TransactionImportAccountMapping] = Field(min_length=1, max_length=MAX_IMPORT_MAPPINGS)
    categories: list[TransactionImportCategoryMapping] = Field(default=[], max_length=MAX_IMPORT_MAPPINGS)
    rows: list[JournalTransactionRow] = Field(min_length=1, max_length=MAX_IMPORT_BATCH_ROWS)

    # Where this batch starts in the export, so a batch sent twice stages the same positions and
    # the second copy is absorbed
    start_row_index: int = Field(ge=0)


class JournalBudgetLimit(BaseModel):
    """One limit period from an exported budget

    Both dates are inclusive, matching how the export expresses a period. The amount is a
    magnitude in plain decimal text so the backend can validate precision against the budget
    currency
    """

    start: date
    end: date
    amount: UnsignedDecimalAmount


class JournalBudgetRecurrence(BaseModel):
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


class JournalBudgetImportResult(BaseModel):
    """One created budget with the periods materialized for it"""

    name: str
    base_budget_id: uuid.UUID
    instance_count: int


class JournalImportRunResponse(TransactionImportResponse):
    """Summary of everything a journal import run wrote in its one commit

    A run never skips a row, since a row it cannot write fails the whole commit. Transfers between
    two imported accounts produce two Lumina transactions from one journal row, so
    transactions_created can exceed rows_imported. Archiving an account with money left in it adds
    one balance adjustment, which transactions_created does not count
    """

    rows_imported: int
    budgets_created: int
    budgets: list[JournalBudgetImportResult]
    accounts_archived: int
    archive_adjustments_created: int


class ImportBudgetDraft(BaseModel):
    """One budget a run creates once its transactions are written

    Everything a budget import states, except that tracked categories are named by category mapping
    source, since a category the same import creates has no id until the commit
    """

    name: TrimmedImportText = Field(max_length=256)
    currency: CurrencyCode
    category_sources: list[TrimmedImportText] = Field(min_length=1, max_length=MAX_JOURNAL_BUDGET_CATEGORIES)
    limits: list[JournalBudgetLimit] = Field(min_length=1, max_length=MAX_BUDGET_LIMIT_PERIODS)
    recurrence: JournalBudgetRecurrence | None
    is_archived: bool = False


class ImportRunBudgetsRequest(BaseModel):
    """Every budget a run creates, replacing what it held, with the category mappings they need

    A budget can track a category no staged row uses, so the mappings it needs are declared here
    as well and merged into the run's like a batch's
    """

    categories: list[TransactionImportCategoryMapping] = Field(default=[], max_length=MAX_IMPORT_MAPPINGS)
    budgets: list[ImportBudgetDraft] = Field(default=[], max_length=MAX_JOURNAL_BUDGETS)


class ImportRunArchiveRequest(BaseModel):
    """Every account a run archives once everything else is written, replacing what it held

    Each is named once, by the account mapping source it resolves through
    """

    account_sources: UniqueTrimmedImportTexts = Field(default=[], max_length=MAX_IMPORT_MAPPINGS)


class LastImportResponse(BaseModel):
    """The last saved import, with when it can be undone until and everything undoing it deletes"""

    id: uuid.UUID
    source: Literal["generic", "firefly", "actual_budget"]
    file_name: str | None
    committed_at: datetime
    undo_until: datetime

    # The transactions the import wrote and the records it created, all of which undoing it deletes
    transaction_count: int
    account_count: int
    category_count: int
    merchant_count: int
    tag_count: int
    budget_count: int


class ImportUndoResponse(BaseModel):
    """Summary of an undone import"""

    transactions_deleted: int
    affected_account_ids: list[uuid.UUID]
