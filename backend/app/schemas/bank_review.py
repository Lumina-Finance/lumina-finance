"""Bank review schemas"""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.bank_connection import BankProvider
from app.models.bank_transaction import EditableBankField, ReviewedBankField
from app.models.base import TransferCounterpartyScope
from app.schemas.bank_sync import BankValues
from app.schemas.transaction import MAX_IMPORT_NOTES_LENGTH

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

    # The bank's values: the whole item for a new one, the proposal for a correction
    bank: BankValues

    # The ledger transaction a correction or removal is about, and its approved values, null on a new item
    transaction_id: uuid.UUID | None
    current: BankValues | None
    changed_fields: list[ReviewedBankField]

    # The changed fields the user edited, whose own value accepting the correction would replace
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


class AddReviewItemRequest(BaseModel):
    """The values a new bank item goes into the ledger with, the bank's or the user's own"""

    dt: date

    # Signed minor units of the account's currency, always sent, so an item whose bank amount the
    # currency can't hold gets one
    amount: int
    category_id: uuid.UUID
    merchant_id: uuid.UUID
    notes: str | None = Field(None, max_length=MAX_IMPORT_NOTES_LENGTH)
    tag_ids: list[uuid.UUID] = []
    counterparty_account_id: uuid.UUID | None = None
    counterparty_account_scope: TransferCounterpartyScope | None = None
