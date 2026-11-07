"""Bank review schemas"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.bank_transaction import CorrectableBankField, EditableBankField
from app.schemas.bank_sync import BankValues
from app.schemas.transaction import TransactionEntry

# A bank transaction to add or dismiss, or a change or removal the bank reports for one already in the ledger
ReviewItemKind = Literal["new", "correction", "removal"]

# The kinds bulk approval applies. New items wait, since none comes with a merchant and category yet
BulkApprovalKind = Literal["correction", "removal"]

# The most items one bulk approval applies, as many as a bulk edit of the ledger takes. Corrections and
# removals open only when the bank changes a transaction already accepted, so a preview rarely nears it
MAX_BULK_APPROVAL_ITEMS = 1_000


class BankReviewItemResponse(BaseModel):
    """One item waiting for review, outside the ledger and every calculation until the user decides"""

    id: uuid.UUID
    kind: ReviewItemKind
    account_id: uuid.UUID
    provider: str
    provider_name: str
    received_at: datetime

    # Moves on whenever the item changes, so bulk approval applies only what it previewed
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

    # Whether the item can't be added until the user chooses its merchant and category, true of
    # every new item
    needs_merchant_or_category: bool


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


class PreviewBulkApprovalRequest(BaseModel):
    """The accounts whose waiting items bulk approval previews"""

    # Null for every account, as the review list reads them
    account_ids: list[uuid.UUID] | None = None


class BulkApprovalNetEffectResponse(BaseModel):
    """How much a group of items moves the balances of the accounts in one currency"""

    currency: str

    # Signed minor units of the currency, never zero
    amount: int


class BulkApprovalGroupResponse(BaseModel):
    """The items of one kind bulk approval would apply, newest first by the bank's date"""

    kind: BulkApprovalKind
    count: int

    # One entry per currency whose balances the group moves, in currency order, empty when it moves none
    net_effect: list[BulkApprovalNetEffectResponse]
    items: list[BankReviewItemResponse]


class BulkApprovalPreviewResponse(BaseModel):
    """What bulk approval would apply, a group for each kind it has items of, corrections first"""

    groups: list[BulkApprovalGroupResponse]

    # The new items in scope, which stay waiting since each needs a merchant and category
    excluded_count: int


class BulkApprovalItemRequest(BaseModel):
    """One item a preview listed, at the version it showed"""

    id: uuid.UUID
    version: int


class ApplyBulkApprovalRequest(BaseModel):
    """The items a preview listed, which are applied only while each is still at the version sent"""

    items: list[BulkApprovalItemRequest] = Field(min_length=1, max_length=MAX_BULK_APPROVAL_ITEMS)


class BulkApprovalResultResponse(BaseModel):
    """What a bulk approval applied, by kind, and which items"""

    corrected: int
    removed: int

    # The items sent that still wait for review, because they changed since the preview or a check
    # refused them. One decided elsewhere since no longer waits and isn't counted
    failed: int

    # The items applied, which the review list can take out as the ledger shows them
    applied_ids: list[uuid.UUID]


class AddReviewItemRequest(TransactionEntry):
    """The values a new bank item goes into the ledger with, the bank's or the user's own

    The item's account and its currency are where it goes. The amount, in signed minor units of
    that currency, is always sent, so an item whose bank amount the currency can't hold gets one
    """
