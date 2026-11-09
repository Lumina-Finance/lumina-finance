"""Bank review schemas"""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.bank_transaction import CorrectableBankField, EditableBankField
from app.schemas.bank_sync import BankValues
from app.schemas.import_run import MAX_IMPORT_NOTES_LENGTH, MAX_IMPORT_TAGS_PER_ROW
from app.schemas.transaction import MAX_BULK_UPDATE_TRANSACTIONS, TransactionEntry

# A bank transaction to add or dismiss, or a change or removal the bank reports for one already in the ledger
ReviewItemKind = Literal["new", "correction", "removal"]


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


class BankReviewCountsResponse(BaseModel):
    """How many items wait of each kind, across every page"""

    new: int
    correction: int
    removal: int


class BankReviewPageResponse(BaseModel):
    """One page of the items waiting for review, newest first by the bank's date"""

    items: list[BankReviewItemResponse]
    counts: BankReviewCountsResponse

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
    version: int


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
    dt: date | None = None


class BulkReviewResultResponse(BaseModel):
    """Which items sent a bulk decision took, and which it skipped, each in the order sent"""

    decided_ids: list[uuid.UUID]

    # Items that changed since the list showed them, were decided elsewhere, are gone or aren't the
    # user's, or whose bank amount the account's currency can't hold. Each stays as it was
    skipped_ids: list[uuid.UUID]


class AddReviewItemRequest(TransactionEntry):
    """The values a new bank item goes into the ledger with, the bank's or the user's own

    The item's account and its currency are where it goes. The amount, in signed minor units of
    that currency, is always sent, so an item whose bank amount the currency can't hold gets one
    """
