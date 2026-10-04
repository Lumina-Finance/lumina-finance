"""Bank sync schemas"""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, SecretStr, model_validator

from app.models.bank_connection import BankProvider, ConnectsFrom
from app.models.bank_transaction import EditableBankField
from app.schemas.names import TrimmedName


class CreateBankConnectionRequest(BaseModel):
    """A setup token to claim as a new connection"""

    # Printing a validation error leaves out the body it refused
    model_config = ConfigDict(hide_input_in_errors=True)

    provider: BankProvider

    # A secret: it is claimed once and never stored, logged or shown, so printing the request masks it
    setup_token: SecretStr

    # Blank means none. The length is checked where the refusal can say it in a sentence
    nickname: TrimmedName | None = None

    @model_validator(mode="before")
    @classmethod
    def _mask_setup_token(cls, value: object) -> object:
        """Mask the setup token before the fields are checked

        A refused body is repeated in the 422 response, such as for a missing provider, so the token
        in it is masked first

        Args:
            value: The request body as sent

        Returns:
            The body with its setup token masked
        """
        if isinstance(value, dict) and isinstance(value.get("setup_token"), str):
            return {**value, "setup_token": SecretStr(value["setup_token"])}
        return value


class UpdateBankConnectionRequest(BaseModel):
    """A connection's new nickname, where blank or null brings back the provider's name"""

    # Required, so an empty body can't clear it by accident
    nickname: TrimmedName | None


class BankRequestBudgetResponse(BaseModel):
    """A connection's requests to its provider over the last 24 hours"""

    limit: int
    used: int

    # When the next request can be sent once the budget is spent, null while one is free
    available_again_at: datetime | None


class ConnectionBankAccountResponse(BaseModel):
    """A bank account a connection last listed"""

    external_id: str
    name: str
    institution_name: str

    # The ISO 4217 code, or the provider's own currency exactly as sent
    currency: str

    # True for a currency of the provider's own, which no account can take
    custom_currency: bool
    linked_account_id: uuid.UUID | None

    # The accounts that could take it, decided by the bank-linking eligibility check
    eligible_account_ids: list[uuid.UUID]


class BankConnectionResponse(BaseModel):
    """One of the user's provider credentials, described without the credential itself"""

    id: uuid.UUID
    provider: BankProvider
    provider_name: str
    nickname: str | None

    # The host the credential reaches, the only part of it ever shown
    server_label: str
    created_at: datetime
    status: Literal["active", "credential_rejected"]

    # Kept while a rejected credential waits for a reconnect
    accounts: list[ConnectionBankAccountResponse]

    # True while a discovery is queued or running, such as after a claim whose own discovery failed
    discovery_pending: bool
    request_budget: BankRequestBudgetResponse


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
