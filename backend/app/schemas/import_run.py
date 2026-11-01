"""Import run request and response schemas and the caps they enforce, for the CSV, Firefly III and Actual Budget imports"""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from app.models.base import RecurrenceFreq
from app.models.transaction import BANK_TRANSACTION_HASH_LENGTH
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

# Characters of a bank account key and of a bank transaction ID one OFX row may carry. OFX allows
# 255 for an ID, but a bank may write more and a long ID must not leave its transaction out, so the
# caps only stop one value filling a request. The browser's byte budget bounds a request on its own
MAX_IMPORT_BANK_ACCOUNT_KEY_LENGTH = 1_000
MAX_IMPORT_BANK_TRANSACTION_ID_LENGTH = 100_000

# Tags one row may carry, and characters one tag name may carry. The length matches the column tags
# are stored in, so a name too long is refused as the batch carrying it is staged rather than at the
# commit, once the rows are already parked
MAX_IMPORT_TAGS_PER_ROW = 32
MAX_IMPORT_TAG_NAME_LENGTH = 64

# Characters a merchant name may carry, matching the column merchants are stored in
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

# Columns and characters per header a saved CSV layout may carry, far past any bank's export. The
# import page leaves a file past either unremembered rather than send a layout this refuses, and
# repeats both figures beside its own builder
MAX_CSV_LAYOUT_COLUMNS = 256
MAX_CSV_LAYOUT_HEADER_LENGTH = 256

# The furthest line a saved header row may name. A file reaching past it holds more rows than an
# import reads
MAX_CSV_LAYOUT_LINE = MAX_IMPORT_ROWS

# The characters JavaScript's String.prototype.trim removes, which is how the import screen trims
# every value it sends. Python's str.strip takes a different set, so the check names these exactly
_BROWSER_TRIMMED_WHITESPACE = (
    "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)

# An amount as the import screen sends it: a magnitude in plain decimal text, since the journal
# type and the imported side carry the direction
_UNSIGNED_DECIMAL_PATTERN = r"^[0-9]+(\.[0-9]+)?$"
_CURRENCY_CODE_PATTERN = r"^[A-Z]{3}$"

# A keyed hash in lower-case hex, as the server makes one
_BANK_TRANSACTION_HASH_PATTERN = rf"^[0-9a-f]{{{BANK_TRANSACTION_HASH_LENGTH}}}$"


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

CsvLayoutHeader = Annotated[str, Field(min_length=1, max_length=MAX_CSV_LAYOUT_HEADER_LENGTH)]

# The fields a CSV column can fill, without the account, which is what a layout is saved under
CsvLayoutColumnTarget = Literal[
    "dt",
    "category_id",
    "amount",
    "amount_out",
    "amount_in",
    "amount_direction",
    "currency",
    "merchant_id",
    "notes",
    "tag_ids",
    "counterparty_account_id",
]

# Journal types the importer handles, lowercased as the import screen sends them
JournalRowType = Literal["withdrawal", "deposit", "transfer", "opening balance", "reconciliation"]


class CsvImportAmountFormat(BaseModel):
    """The separators an import read its amounts with, from the fixed list the import page offers."""

    decimal_separator: Literal[".", ","]
    grouping_separator: Literal[",", ".", "space", "'", "none"]


class CsvImportLayout(BaseModel):
    """How a CSV file was read, from the choices the import page offers, saved for its next file with these headers."""

    # Header cells as the page names them, a blank heading already named by its position and a repeated
    # one already numbered
    headers: list[CsvLayoutHeader] = Field(min_length=2, max_length=MAX_CSV_LAYOUT_COLUMNS)
    delimiter: Literal[",", ";"]

    # Counted from 1 over the file's non-blank lines. A file read without a header row has no layout
    header_row: int = Field(ge=1, le=MAX_CSV_LAYOUT_LINE)
    column_map: dict[CsvLayoutColumnTarget, str]
    date_format: Literal["yearFirst", "dayFirst", "monthFirst", "written", "iso"]
    amount_format: CsvImportAmountFormat

    @model_validator(mode="after")
    def _require_mapped_headers(self) -> CsvImportLayout:
        """Refuse a field mapped to a header the file does not have"""
        if not set(self.column_map.values()) <= set(self.headers):
            raise ValueError("every mapped column must be one of the layout's headers")
        return self


class CsvImportLayoutResponse(CsvImportLayout):
    """A layout saved for one of the user's own accounts."""

    model_config = ConfigDict(from_attributes=True)

    account_id: uuid.UUID


class AccountImportSourceResponse(BaseModel):
    """The importer that last brought transactions into one of the user's own accounts."""

    model_config = ConfigDict(from_attributes=True)

    account_id: uuid.UUID
    source: Literal["generic", "firefly", "actual_budget", "ofx", "qif"]


class HeldBankTransactionItem(BaseModel):
    """One OFX transaction the import page asks about, with the account it would go into."""

    # Refused rather than dropped, as for a staged row
    model_config = ConfigDict(extra="forbid")

    account_id: uuid.UUID
    bank_account: str = Field(min_length=1, max_length=MAX_IMPORT_BANK_ACCOUNT_KEY_LENGTH)
    bank_transaction: str = Field(min_length=1, max_length=MAX_IMPORT_BANK_TRANSACTION_ID_LENGTH)


class CheckHeldBankTransactionsRequest(BaseModel):
    """A part of the transactions of an OFX import that carry a bank ID, asked about before anything is staged."""

    # One request is bounded as a staged batch is, since 100,000 bank IDs would pass the request body
    # limit. The page asks about a larger import in parts
    items: list[HeldBankTransactionItem] = Field(max_length=MAX_IMPORT_BATCH_ROWS)


class HeldBankTransactionsResponse(BaseModel):
    """Which of the asked transactions their account already holds."""

    # Positions in the request, so no bank ID or hash travels back
    held: list[int]


class TransactionImportRunRequest(BaseModel):
    """Open a run for a file about to be staged."""

    expected_transaction_count: int = Field(gt=0, le=MAX_IMPORT_ROWS)

    # Which importer's rows the run stages, so each importer's commit reads only its own. Firefly III
    # and Actual Budget runs both stage journal rows, and the source decides how a refusal names a row
    source: Literal["generic", "firefly", "actual_budget", "ofx", "qif"] = "generic"

    # The name of the file the user picked, shown with the last import. The page cuts a
    # longer one to fit
    file_name: str | None = Field(None, max_length=255)

    # How the CSV file was read, which the commit saves for the account the rows go to
    csv_layout: CsvImportLayout | None = None

    @model_validator(mode="after")
    def _require_csv_for_layout(self) -> TransactionImportRunRequest:
        """Refuse a layout on a run from another app, whose commit never saves one"""
        if self.csv_layout is not None and self.source != "generic":
            raise ValueError("only a CSV import carries a CSV layout")
        return self


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
    """Resolve one merchant name found in the file to a merchant, to a new one, or to none.

    Only the names the user answered by hand are declared. A name left alone keeps what the
    importer does without being asked, matching an existing merchant by name and creating one where
    nothing matches, so a file carrying thousands of distinct descriptors is not refused for
    declaring more mappings than an import may carry.
    """

    source: str = Field(min_length=1, max_length=MAX_IMPORT_MERCHANT_NAME_LENGTH)
    merchant_id: uuid.UUID | None = None
    create: TransactionImportCreateMerchant | None = None

    # Answered skip, so the rows carrying this name are filed under the merchant the app stamps on
    # a row stating no merchant at all
    skip: bool = False


class TransactionImportCreateTag(BaseModel):
    """New personal tag to create during a transaction import."""

    name: TrimmedName = Field(min_length=1, max_length=MAX_IMPORT_TAG_NAME_LENGTH)


class TransactionImportTagMapping(BaseModel):
    """Resolve one tag name found in the file to a tag, to a new one, or to none.

    Only the names the user answered by hand are declared. A name left alone is matched to the
    user's tag of that name, whatever its capitals, and creates one where nothing matches.
    """

    source: str = Field(min_length=1, max_length=MAX_IMPORT_TAG_NAME_LENGTH)
    tag_id: uuid.UUID | None = None
    create: TransactionImportCreateTag | None = None

    # Answered skip, so the rows carrying this name are imported without it
    skip: bool = False


class _ImportRowFields(BaseModel):
    """The fields every frontend-compiled import row carries, before any bank transaction identity.

    Amount carries the cell's own digits rather than minor units. Its sign is the frontend's where
    the file states direction by which column a value sits in, and the cell's own otherwise.
    """

    # A field this version does not take is refused rather than dropped, so a page loaded before a
    # change gets a refusal and stages nothing instead of an import missing what it no longer sends
    model_config = ConfigDict(extra="forbid")

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


class TransactionImportStageRow(_ImportRowFields):
    """One row as the import page sends it to be staged.

    An OFX row carries the bank account its statement names and the bank's ID for the transaction,
    as the file wrote them, which a CSV file has none of. Staging replaces both with one keyed hash
    before anything is staged, stored or logged, so neither is kept.
    """

    # Both or neither, since the hash is made from the pair. The account is "bank:" and the bank's
    # routing ID and the account number joined by colons, or "creditCard:" and the card number. The
    # names differ from those an earlier page sent, which also named each statement's account answer
    # by its account number, so a request from that page is refused as it is staged and stages nothing
    bank_account: str | None = Field(None, min_length=1, max_length=MAX_IMPORT_BANK_ACCOUNT_KEY_LENGTH)
    bank_transaction: str | None = Field(None, min_length=1, max_length=MAX_IMPORT_BANK_TRANSACTION_ID_LENGTH)

    @model_validator(mode="after")
    def _require_bank_pair(self) -> TransactionImportStageRow:
        """Refuse a row that names a bank account without a bank ID, or the other way round

        The message never repeats a value, which would put an account number in the response.
        """
        if (self.bank_account is None) != (self.bank_transaction is None):
            raise ValueError("a bank account and a bank transaction ID must be sent together")
        return self


class TransactionImportRow(_ImportRowFields):
    """One import row as staged and committed, which holds only the keyed hash of a bank transaction."""

    # The server's keyed hash of the bank account an OFX statement names and the bank's ID for the
    # transaction, which a CSV file has none of. Only the server makes one, from the pair a stage
    # request carries, so no account number or bank ID is staged. A row is left out at the commit
    # when its account already holds that hash
    bank_transaction_hash: str | None = Field(None, pattern=_BANK_TRANSACTION_HASH_PATTERN)


class TransactionImportRequest(BaseModel):
    """A whole staged file, rebuilt from its run at commit time and handed to the import service."""

    accounts: list[TransactionImportAccountMapping] = Field(min_length=1)
    categories: list[TransactionImportCategoryMapping] = Field(min_length=1)

    # Only the merchant names the user answered by hand, so this is empty for a file whose merchants
    # were all left to match or be created by name
    merchants: list[TransactionImportMerchantMapping] = Field(default=[])

    # Only the tag names the user answered by hand, like the merchants
    tags: list[TransactionImportTagMapping] = Field(default=[])
    rows: list[TransactionImportRow] = Field(min_length=1)


class TransactionImportStageRequest(BaseModel):
    """One batch of a staged file: the mappings its rows reference, and the rows themselves."""

    accounts: list[TransactionImportAccountMapping] = Field(min_length=1, max_length=MAX_IMPORT_MAPPINGS)
    categories: list[TransactionImportCategoryMapping] = Field(min_length=1, max_length=MAX_IMPORT_MAPPINGS)

    # Carries no minimum, unlike the other two, because a batch whose merchants were all left alone
    # declares none of them
    merchants: list[TransactionImportMerchantMapping] = Field(default=[], max_length=MAX_IMPORT_MAPPINGS)
    tags: list[TransactionImportTagMapping] = Field(default=[], max_length=MAX_IMPORT_MAPPINGS)
    rows: list[TransactionImportStageRow] = Field(min_length=1, max_length=MAX_IMPORT_BATCH_ROWS)

    # Where this batch starts in the file, so a batch sent twice stages the same positions and the
    # unique constraint on them absorbs the second copy. A position already staged keeps what it
    # was first given, so a caller wanting different rows there opens a new run
    start_row_index: int = Field(ge=0)


class TransactionImportResponse(BaseModel):
    """Summary of records created or reused by a transaction import."""

    transactions_created: int

    # Rows left out because their account already holds the bank's ID for them. Defaults to 0 so a
    # repeated commit of a run saved before this was counted still answers with its stored summary
    transactions_already_imported: int = 0
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
    the same name, and every other endpoint is named as it appears in the export. A row with a
    merchant and no category is sent with the no-category mapping source for its direction, and a null category
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
    source: Literal["generic", "firefly", "actual_budget", "ofx", "qif"]
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


class SavedImportRunResponse(BaseModel):
    """Whether a saved import is still there"""

    is_saved: bool


class ImportUndoResponse(BaseModel):
    """Summary of an undone import"""

    transactions_deleted: int
    affected_account_ids: list[uuid.UUID]
