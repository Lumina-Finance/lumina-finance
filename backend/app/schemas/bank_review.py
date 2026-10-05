"""Bank review schemas"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.models.bank_connection import BankProvider
from app.models.bank_transaction import CorrectableBankField, EditableBankField
from app.schemas.bank_sync import BankValues
from app.schemas.transaction import TransactionEntry

# A bank transaction to add or dismiss, or a change or removal the bank reports for one already in the ledger
ReviewItemKind = Literal["new", "correction", "removal"]


class BankReviewItemResponse(BaseModel):
    """One item waiting for review, outside the ledger and every calculation until the user decides"""

    id: uuid.UUID
    kind: ReviewItemKind
    account_id: uuid.UUID
    provider: BankProvider
    provider_name: str
    external_transaction_id: str
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

    # The account's sync is held until enough items are reviewed, never while an import runs
    paused: bool

    # Enough items wait that the sync will soon pause, on a linked account neither paused nor importing
    review_warning: bool


class AddReviewItemRequest(TransactionEntry):
    """The values a new bank item goes into the ledger with, the bank's or the user's own

    The item's account and its currency are where it goes. The amount, in signed minor units of
    that currency, is always sent, so an item whose bank amount the currency can't hold gets one
    """
