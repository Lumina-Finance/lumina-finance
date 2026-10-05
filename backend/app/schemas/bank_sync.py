"""Bank sync schemas"""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, SecretStr, model_validator

from app.models.bank_connection import BankProvider, ConnectsFrom, UnavailableReason
from app.models.bank_transaction import EditableBankField
from app.schemas.names import TrimmedName


class SetupTokenRequest(BaseModel):
    """A request body carrying a setup token, which no refusal of the body may repeat"""

    # A secret: it is claimed once and never stored, logged or shown, so printing the request masks it
    setup_token: SecretStr

    @model_validator(mode="before")
    @classmethod
    def _mask_setup_token(cls, value: object) -> object:
        """Mask the setup token before the fields are checked

        A refusal repeats what it refused in the 422 response, such as the whole body for a missing
        field. Anything but an object, such as a body sent as text, is replaced, since the token
        could be anywhere in it. Only the model's own fields are kept, since a token could be sent
        under another name, and a token that isn't text is replaced with null so it is still refused

        Args:
            value: The request body as sent

        Returns:
            The model's fields with the setup token masked, or None for a body that isn't an object
        """
        if not isinstance(value, dict):
            return None
        fields = {name: value[name] for name in cls.model_fields if name in value}
        if "setup_token" in fields:
            token = fields["setup_token"]
            fields["setup_token"] = SecretStr(token) if isinstance(token, str) else None
        return fields


class CreateBankConnectionRequest(SetupTokenRequest):
    """A setup token to claim as a new connection"""

    provider: BankProvider

    # Blank means none. The length is checked where the refusal can say it in a sentence
    nickname: TrimmedName | None = None


class ReconnectBankConnectionRequest(SetupTokenRequest):
    """A new setup token for a connection whose credential the provider rejected"""


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

    # True while the account linked to it through this connection waits on the user signing in to
    # its bank again at the provider. Never set on a rejected connection, which needs reconnecting first
    signin_needed: bool


class ChooseAgainLinkResponse(BaseModel):
    """A link through a connection whose bank account the provider no longer lists as before"""

    account_id: uuid.UUID

    # The bank account's name as it was when the provider last listed it as before
    external_account_name: str


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

    # The connection's links that stopped syncing until the user chooses each one's bank account again
    choose_again_links: list[ChooseAgainLinkResponse]

    # True while a discovery is queued or running, such as after a claim whose own discovery failed
    discovery_pending: bool
    request_budget: BankRequestBudgetResponse


class ReconnectBankConnectionResponse(BaseModel):
    """What replacing a rejected credential did to the accounts linked through the connection"""

    connection: BankConnectionResponse

    # Accounts whose bank account came back unchanged, which resume syncing
    resumed_account_ids: list[uuid.UUID]

    # Accounts whose bank account came back under a new identity, which wait for it to be chosen again
    choose_again_account_ids: list[uuid.UUID]

    # True when the request couldn't list the connection's bank accounts, so both lists are empty
    # and the accounts are sorted out once a sync lists them
    accounts_pending: bool


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


class BankImportRangeResponse(BaseModel):
    """Where an import into one account may start, every date a calendar day in the user's profile timezone"""

    # What a default start would have been, raised to the earliest allowed date. The start step
    # preselects neither, and shows default_suggestion so a raised start is never silent
    suggested_start: date
    default_suggestion: date
    earliest_allowed: date
    latest_allowed: date

    # The day after the latest ledger transaction dated today or earlier, null for an account with none
    ledger_floor: date | None

    # The first day the provider's history limit allows
    provider_limit_date: date
    provider_history_months: int
    latest_ledger_date: date | None


class DiscoveredBankAccountResponse(BaseModel):
    """A bank account a connection lists, described for the account being linked"""

    external_id: str
    name: str
    institution_name: str

    # The ISO 4217 code, or the provider's own currency exactly as sent
    currency: str

    # In minor units of the bank account's currency, null when the bank gave no usable balance
    balance: int | None

    # When the provider gives the balance as of
    balance_date: datetime | None
    linkable: bool

    # Why it can't be linked to the account, as a code and as the sentence the list shows
    unavailable_reason: UnavailableReason | None
    unavailable_message: str | None

    # True when its institution looks different from the one the account names, so the flow asks
    # the user to double-check
    institution_differs: bool


class DiscoveredBankAccountsResponse(BaseModel):
    """A connection's bank accounts for the account being linked, unavailable ones included"""

    accounts: list[DiscoveredBankAccountResponse]

    # True while a discovery is queued or running, after which the list can change
    discovery_pending: bool


class LinkBankAccountRequest(BaseModel):
    """A bank account on one of the user's connections to link, and where its import starts"""

    connection_id: uuid.UUID
    external_account_id: str

    # A calendar day in the user's profile timezone, inside the account's import range
    start_date: date


class BankAccountLinkResponse(BaseModel):
    """An account's link to a bank account"""

    account_id: uuid.UUID
    connection_id: uuid.UUID
    provider: BankProvider
    provider_name: str
    external_account_id: str
    external_account_name: str
    institution_name: str
    import_start: date
    linked_at: datetime


class UnlinkResponse(BaseModel):
    """The accounts an unlink or a disconnect stopped syncing"""

    unlinked_account_ids: list[uuid.UUID]


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
