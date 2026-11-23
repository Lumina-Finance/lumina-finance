"""Bank review schemas"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.bank_transaction import CorrectableBankField, EditableBankField
from app.models.base import CategoryKind
from app.schemas.bank_sync import BankValues
from app.schemas.import_rule import ImportRuleGivenValue, ImportRuleReference
from app.schemas.import_run import MAX_IMPORT_NOTES_LENGTH, MAX_IMPORT_TAGS_PER_ROW
from app.schemas.limits import Counter
from app.schemas.transaction import MAX_BULK_UPDATE_TRANSACTIONS, TransactionEntry
from app.utils.date_window import WindowDate

# A bank transaction to add or dismiss, or a change or removal the bank reports for one already in the ledger
ReviewItemKind = Literal["new", "correction", "removal"]

# Why a rule's category is left out of an item: a transfer category never fills, and an income or
# expense one only fills the direction its kind names. An amount of zero, or one the bank sent
# unreadable, has no direction
CategoryLeftOutReason = Literal["income_for_money_out", "expense_for_money_in", "transfer", "no_direction"]


class ReviewRuleCategory(ImportRuleGivenValue):
    """A category the rules give an item, with its kind"""

    kind: CategoryKind


class ReviewRuleCategoryLeftOut(ReviewRuleCategory):
    """A category a rule gives that doesn't fit the item, so the item isn't filled with it"""

    reason: CategoryLeftOutReason


class ReviewRuleTagsLeftOut(BaseModel):
    """The tags the rules give an item that together pass what one transaction carries, so none is filled in"""

    # The rules that add them, first checked first
    rules: list[ImportRuleReference]

    # How many tags the rules add, and the most a transaction carries
    count: int
    limit: int
    reason: Literal["too_many"]


class ReviewItemRuleFill(BaseModel):
    """What the user's import rules fill in for one new item, worked out as the list is read"""

    merchant: ImportRuleGivenValue | None

    # Only a category whose kind fits the item's direction
    category: ReviewRuleCategory | None
    tags: list[ImportRuleGivenValue]

    # Set when the rules' category, or their tags, were left out, and why
    category_left_out: ReviewRuleCategoryLeftOut | None
    tags_left_out: ReviewRuleTagsLeftOut | None


class BankReviewItemResponse(BaseModel):
    """One item waiting for review, outside the ledger and every calculation until the user decides"""

    id: uuid.UUID
    kind: ReviewItemKind
    account_id: uuid.UUID
    provider: str
    provider_name: str
    received_at: datetime

    # Moves on whenever the item changes, so a bulk add or dismiss takes only what the list showed
    version: int

    # The bank's values: the whole item for a new one, the proposal for a correction, the last it
    # sent for a removal
    bank: BankValues

    # The ledger transaction a correction or removal is about, and its approved values, null on a new item
    transaction_id: uuid.UUID | None
    current: BankValues | None
    changed_fields: list[CorrectableBankField]

    # The fields the correction changes that the user had edited
    protected_fields: list[EditableBankField]

    # What the import rules fill in. Null on a correction or removal and on a new item no rule matches
    rule_fill: ReviewItemRuleFill | None = None


class BankReviewCountsResponse(BaseModel):
    """How many items wait of each kind, across every page"""

    new: int
    correction: int
    removal: int


class BankReviewRulesResponse(BaseModel):
    """What the import rules do to the waiting new items of the accounts listed, across every page"""

    # Sent back when the rules are applied, so rules changed since the list loaded are refused
    version: str

    # Whether any waiting new item matches a rule, and whether applying the rules would add any
    any_matches: bool
    any_addable: bool


class BankReviewPageResponse(BaseModel):
    """One page of the items waiting for review, newest first by the bank's date"""

    items: list[BankReviewItemResponse]
    counts: BankReviewCountsResponse

    # Read for the first page only, null on the pages after it
    rules: BankReviewRulesResponse | None = None

    # Sent back as the cursor to read the page after this one, null on the last page
    next_cursor: str | None


class BankReviewBacklogResponse(BaseModel):
    """An account's new items waiting for review, and whether its sync is paused or warned for them"""

    account_id: uuid.UUID

    # New items awaiting their first review, the count the warning and the pause read
    waiting_new_count: int

    # The account's sync is held until enough items are reviewed, never while an import runs or while
    # only the user can restart the sync
    paused: bool

    # Enough items wait that the sync will soon pause, on a linked account neither paused, importing
    # nor waiting for only the user to restart its sync
    review_warning: bool


class BulkReviewItemRequest(BaseModel):
    """One new item the user selected, at the version the review list showed"""

    id: uuid.UUID
    version: Counter


class BulkDismissReviewItemsRequest(BaseModel):
    """The new items to dismiss, each only while it is still at the version sent

    As many as a bulk edit of the ledger takes, since one selection spans both
    """

    items: list[BulkReviewItemRequest] = Field(min_length=1, max_length=MAX_BULK_UPDATE_TRANSACTIONS)


class BulkAddReviewItemsRequest(BulkDismissReviewItemsRequest):
    """The new items to add to the ledger with one set of values, each with its own bank amount

    Merchant and category are required, as for one item. Each item keeps its bank date unless a date
    is sent for all of them
    """

    merchant_id: uuid.UUID
    category_id: uuid.UUID
    tag_ids: list[uuid.UUID] = Field(default=[], max_length=MAX_IMPORT_TAGS_PER_ROW)
    notes: str | None = Field(None, max_length=MAX_IMPORT_NOTES_LENGTH)
    dt: WindowDate | None = None


class BulkReviewResultResponse(BaseModel):
    """Which items sent a bulk decision took, and which it skipped, each in the order sent"""

    decided_ids: list[uuid.UUID]

    # Items that changed since the list showed them, were decided elsewhere, are gone or aren't the
    # user's. Each stays as it was
    skipped_ids: list[uuid.UUID]


class AddReviewItemRequest(TransactionEntry):
    """The values a new bank item goes into the ledger with, the bank's or the user's own

    The item's account and its currency are where it goes. The amount, in signed minor units of
    that currency, is always sent, so an item whose bank amount the currency can't hold gets one
    """
