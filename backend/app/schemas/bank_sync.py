"""Bank sync schemas"""

import uuid
from datetime import date

from pydantic import BaseModel

from app.models.bank_connection import BankProvider, ConnectsFrom
from app.models.bank_transaction import EditableBankField


class BankProviderResponse(BaseModel):
    """A bank provider the deployment enables"""

    id: BankProvider
    name: str

    # One sentence on what connecting it reaches
    description: str
    connects_from: ConnectsFrom

    # Whether new connections may be made. Existing connections keep working when it is withdrawn
    offered: bool

    # How many calendar months back an import may start
    history_limit_months: int

    # False when the provider can't say how much history it holds for an account
    advertises_history: bool

    # How many institutions the user may link through it across their connections, null for no limit
    institution_limit: int | None

    # The institutions with a linked bank account, each counted once toward the limit
    institutions_in_use: list[str]


class BankProvidersResponse(BaseModel):
    """The providers on offer, and whether the user can link bank accounts now"""

    # The single "may this user link bank accounts?" check
    may_link: bool

    # False once the worker hasn't scanned for due work in 15 minutes, so no sync or import would run
    sync_running: bool
    providers: list[BankProviderResponse]


class BankValues(BaseModel):
    """The values a bank supplied for one booked transaction"""

    date: date

    # Signed minor units, money out negative. Null when the bank sent more decimal places than the
    # currency holds, which is never rounded: raw_amount then holds the amount exactly as sent
    amount: int | None
    raw_amount: str | None
    description: str
    merchant_name: str | None
    category_hint: str | None


class TransactionBankSource(BaseModel):
    """Where a bank-imported ledger transaction came from, readable after unlinking or disconnecting"""

    provider: BankProvider
    provider_name: str

    # The latest values the bank supplied
    bank_values: BankValues

    # When the app received the bank's record of the transaction
    received_at: datetime

    # The fields whose ledger value differs from the bank value it was last aligned with
    edited_fields: list[EditableBankField]

    # The waiting correction or removal about this transaction, if any
    review_item_id: uuid.UUID | None
