"""Firefly III import request and response schemas"""

import uuid
from datetime import date
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, model_validator

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


# Text the import screen has already trimmed, and sends as null rather than blank
TrimmedImportText = Annotated[str, AfterValidator(_require_trimmed)]
UnsignedDecimalAmount = Annotated[str, Field(min_length=1, max_length=64, pattern=_UNSIGNED_DECIMAL_PATTERN)]
CurrencyCode = Annotated[str, Field(pattern=_CURRENCY_CODE_PATTERN)]
FireflyTagName = Annotated[ImportTagName, AfterValidator(_require_trimmed)]
UniqueTrimmedImportTexts = Annotated[list[TrimmedImportText], AfterValidator(_require_unique)]

# Journal types the importer handles, lowercased as the import screen sends them
FireflyJournalType = Literal["withdrawal", "deposit", "transfer", "opening balance", "reconciliation"]


class FireflyTransactionRow(BaseModel):
    """One Firefly III export journal row as the import screen compiles it

    The screen reads the raw export and sends every value in its one canonical form, and a row in
    any other form is refused rather than cleaned up here. Types are lowercased, amounts are
    magnitudes in plain decimal text so their precision can be checked against the account
    currency, currency codes are upper case, and text is trimmed, with a missing value sent as null.
    A foreign amount comes with its currency code or not at all

    The frontend decides which endpoints are imported accounts. Each one is named by the account
    mapping source it resolves through, since Firefly III lets an asset account and a liability
    share a name, and every other endpoint is named as it appears in the export. A payee row with
    no category is sent with a null category, which files it under the no-category mapping source
    """

    journal_id: TrimmedImportText = Field(max_length=64)
    type: FireflyJournalType
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
    tag_names: Annotated[list[FireflyTagName], AfterValidator(_require_unique)] = Field(
        default=[],
        max_length=MAX_IMPORT_TAGS_PER_ROW,
    )
    notes: TrimmedImportText | None = Field(None, max_length=MAX_IMPORT_NOTES_LENGTH)

    @model_validator(mode="after")
    def _require_whole_foreign_amount(self):
        """Refuse a foreign amount without its currency code, or a code without its amount"""
        if (self.foreign_amount is None) != (self.foreign_currency_code is None):
            raise ValueError("foreign_amount and foreign_currency_code must be sent together")
        return self


class FireflyImportStageRequest(BaseModel):
    """One batch of a staged Firefly III export: the mappings its rows reference, and the rows

    A batch declares only the mappings its own rows need. Category mappings may be empty, since a
    batch of transfers and opening balances reads no category
    """

    accounts: list[TransactionImportAccountMapping] = Field(min_length=1, max_length=MAX_IMPORT_MAPPINGS)
    categories: list[TransactionImportCategoryMapping] = Field(default=[], max_length=MAX_IMPORT_MAPPINGS)
    rows: list[FireflyTransactionRow] = Field(min_length=1, max_length=MAX_IMPORT_BATCH_ROWS)

    # Where this batch starts in the export, so a batch sent twice stages the same positions and
    # the second copy is absorbed
    start_row_index: int = Field(ge=0)


class FireflyBudgetLimit(BaseModel):
    """One limit period from the Firefly III budgets export

    Both dates are inclusive, matching how the export expresses a period. The amount is a
    magnitude in plain decimal text so the backend can validate precision against the budget
    currency
    """

    start: date
    end: date
    amount: UnsignedDecimalAmount


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


class FireflyBudgetImportResult(BaseModel):
    """One created budget with the periods materialized for it"""

    name: str
    base_budget_id: uuid.UUID
    instance_count: int


class FireflyImportRunResponse(BaseModel):
    """Summary of everything a Firefly III import run wrote in its one commit

    A run never skips a row, since a row it cannot write fails the whole commit. Transfers between
    two imported accounts produce two Lumina transactions from one journal row, so
    transactions_created can exceed rows_imported. Archiving an account with money left in it adds
    one balance adjustment, which transactions_created does not count
    """

    rows_imported: int
    transactions_created: int
    accounts_created: int
    accounts_reused: int
    categories_created: int
    categories_reused: int
    merchants_created: int
    merchants_reused: int
    tags_created: int
    tags_reused: int
    budgets_created: int
    budgets: list[FireflyBudgetImportResult]
    accounts_archived: int
    archive_adjustments_created: int
    affected_account_ids: list[uuid.UUID]
    account_source_ids: dict[str, uuid.UUID]
    category_source_ids: dict[str, uuid.UUID]
    created_account_ids: list[uuid.UUID]
    created_category_ids: list[uuid.UUID]
    created_merchant_ids: list[uuid.UUID]
    created_tag_ids: list[uuid.UUID]
