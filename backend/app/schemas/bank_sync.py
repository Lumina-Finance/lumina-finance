"""Bank sync schemas"""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, SecretStr, field_validator, model_validator

from app.models.account_review_preference import ReviewDecision
from app.models.bank_connection import PROVIDER_ID_MAX_LENGTH, BankImportKind, BankLinkState, ConnectsFrom, UnavailableReason
from app.models.bank_transaction import EditableBankField
from app.schemas.names import TrimmedName
from app.utils.money import MAX_MINOR_UNITS, MIN_MINOR_UNITS

# Running while a sync is fetching the import's next part or could fetch it now. Waiting while a
# failed attempt waits to retry, the bank needs a sign-in, or the provider refused the connection's
# credential, and waiting on the budget until the connection's daily request budget frees a request
BankImportState = Literal["running", "waiting", "waiting_on_budget"]

# The one state every surface shows for a live link, in the order the first that applies wins: what
# only the user can fix, an import fetching or waiting on the request budget, the review pause, a sync
# fetching, an opening balance to confirm, the review warning, a retry, and otherwise synced
BankSyncState = Literal[
    "reconnect_needed",
    "bank_signin_needed",
    "choose_account",
    "importing",
    "import_waiting_on_budget",
    "paused",
    "syncing",
    "opening_balance",
    "review_warning",
    "retrying",
    "synced",
]


# More fields than any provider's connect form has, so a body can't send a pile of them
MAX_CREDENTIAL_FIELDS = 8


class CredentialRequest(BaseModel):
    """A request body carrying credentials the user supplied, which no refusal of the body may repeat"""

    # Each of the provider's credential fields by its key. Each value is a secret, such as a setup
    # token: it is claimed once and never stored, logged or shown, so printing the request masks it
    credentials: dict[str, SecretStr] = Field(max_length=MAX_CREDENTIAL_FIELDS)

    @model_validator(mode="before")
    @classmethod
    def _mask_credentials(cls, value: object) -> object:
        """Mask every credential before the fields are checked

        A refusal repeats what it refused in the 422 response, such as the whole body for a missing
        field. Anything but an object, such as a body sent as text, is replaced, since a credential
        could be anywhere in it. Only the model's own fields are kept, since a credential could be
        sent under another name. Credentials that aren't an object of text are replaced with null,
        so they are still refused

        Args:
            value: The request body as sent

        Returns:
            The model's fields with the credentials masked, or None for a body that isn't an object
        """
        if not isinstance(value, dict):
            return None
        fields = {name: value[name] for name in cls.model_fields if name in value}
        if "credentials" in fields:
            credentials = fields["credentials"]
            readable = isinstance(credentials, dict) and all(
                isinstance(key, str) and isinstance(text, str) for key, text in credentials.items()
            )
            fields["credentials"] = {key: SecretStr(text) for key, text in credentials.items()} if readable else None
        return fields


class CreateBankConnectionRequest(CredentialRequest):
    """A credential to claim as a new connection"""

    provider: str = Field(max_length=PROVIDER_ID_MAX_LENGTH)

    # Blank means none. The length is checked where the refusal can say it in a sentence
    nickname: TrimmedName | None = None


class ReconnectBankConnectionRequest(CredentialRequest):
    """A new credential for a connection whose old one the provider rejected"""


class UpdateBankConnectionRequest(BaseModel):
    """A connection's new nickname, where blank or null brings back the provider's name"""

    # Required, so an empty body can't clear it by accident
    nickname: TrimmedName | None


class BankRequestBudgetResponse(BaseModel):
    """A connection's requests to its provider over the last 24 hours"""

    # Null once the provider is no longer installed, when nothing is sent and none are counted
    limit: int | None
    used: int

    # When the next request can be sent once the budget is spent, null while one is free
    available_again_at: datetime | None

    # Whether the provider's word that its quota is spent, rather than the connection's own limit over
    # the last 24 hours, holds the next request back
    held_by_provider: bool


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
    provider: str

    # The provider's name, the one its connection stored once the provider is no longer installed,
    # and the site where its bank logins are managed, None once it is no longer installed
    provider_name: str
    provider_site: str | None

    # False once the provider is no longer installed on this server, when the connection syncs
    # nothing and keeps what it brought in
    provider_available: bool
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


class CredentialFieldResponse(BaseModel):
    """One field of a provider's connect form"""

    # The name its value is sent under, in the claim's credentials
    key: str
    label: str
    placeholder: str

    # The longest value the field takes, which the claim also refuses past
    max_length: int


class BankProviderResponse(BaseModel):
    """A bank provider the deployment enables"""

    id: str
    name: str

    # Where the user manages the bank logins the provider reaches
    site: str

    # One sentence on what connecting it reaches
    description: str

    # The fields the user fills in to connect, in order, and the steps to get what they take, each a
    # sentence. The connect form draws whatever is listed
    credential_fields: list[CredentialFieldResponse]
    connect_steps: list[str]
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
    provider: str

    # The provider's name, the one its connection stored once the provider is no longer installed,
    # and the site where its bank logins are managed, None once it is no longer installed
    provider_name: str
    provider_site: str | None

    # False once the provider is no longer installed on this server, when the link syncs nothing
    provider_available: bool
    external_account_id: str
    external_account_name: str
    institution_name: str
    import_start: date
    linked_at: datetime


class BankImportProgressResponse(BaseModel):
    """How far a link's import has got. An import runs to today whatever the review backlog"""

    kind: BankImportKind

    state: BankImportState
    requested_start: date

    # The windows a fetch of the days from the requested start through today splits into, and how
    # many of them are stored
    windows_total: int
    windows_done: int

    # Bank transactions received for the account since the import began
    items_found: int

    # The earliest booked date the provider returned, None until one arrives
    earliest_returned_date: date | None


class BankSyncFailureResponse(BaseModel):
    """A link's last attempt, which failed"""

    at: datetime
    reason: str


class BankSyncStatusResponse(BaseModel):
    """A live link's sync state, with the facts its Sync details and notices word"""

    state: BankSyncState

    # Kept through failed attempts, None until the link first syncs
    last_success_at: datetime | None

    # The last attempt only when it failed, since a successful one is the last success
    last_failure: BankSyncFailureResponse | None

    # When the next sync or retry runs, or for an import waiting on the request budget, when a request
    # frees up for its next part. None while the link is due at once, as while its import catches up,
    # and after a rejected credential, which stops its sync until a reconnect. A bank sign-in keeps
    # the daily time the app checks again at
    next_attempt_at: datetime | None

    # The next sync is due before the connection's request budget frees a request, so it waits for one
    waiting_on_budget: bool

    # Whether the provider's word that its quota is spent, rather than the connection's own limit over
    # the last 24 hours, holds the connection's next request back
    held_by_provider: bool

    # A worker is syncing the link, which the state shows as syncing unless a state outranks it, such
    # as a bank sign-in
    sync_running: bool

    # The user asked to sync the link now, the sync is due and no worker has started it yet, so the
    # state is still the one before it. A sync waiting for the request budget isn't due until a
    # request frees up
    sync_requested: bool

    # New items awaiting their first review, and whether they hold the sync or warn that they soon
    # will, as the review block says too. Neither while only the user can restart the sync
    waiting_new_count: int
    paused: bool
    review_warning: bool


class BankHistoryReminderResponse(BaseModel):
    """The reminder an import or catch-up raises when it returns less history than it asked for

    Unverified, since a quiet account can simply have had no activity early on
    """

    # The first day the import or catch-up asked from
    requested_start: date

    # The earliest booked date it got, more than a week after the requested start, or None when it
    # got none
    earliest_returned: date | None


class BankLinkResponse(BankAccountLinkResponse):
    """A live link with its import and sync status, as the account's page and the list of links show it"""

    # Choose account while the provider lists the bank account differently, until the user chooses it again
    state: Literal[BankLinkState.ACTIVE, BankLinkState.CHOOSE_ACCOUNT]

    # Sent as "import", which Python keeps as a keyword. None while the link shows no import's
    # progress: no import runs, it waits for its bank account to be chosen again, or it catches up
    # after a reconnect
    import_progress: BankImportProgressResponse | None = Field(serialization_alias="import")
    sync: BankSyncStatusResponse

    # The last import or catch-up that fell short, None when none did or the user dismissed it, or
    # when it got nothing and a later sync has since brought booked history from the day it asked from
    history_reminder: BankHistoryReminderResponse | None

    # The latest day kept though it brought back as many transactions as the provider sends at once,
    # so some of that day's may be missing. None when no day did or the user dismissed it
    cut_off_day: date | None


class DismissHistoryReminderRequest(BaseModel):
    """The history reminder the user dismissed, as it showed, so a newer one raised meanwhile stays"""

    requested_start: date
    earliest_returned: date | None


class DismissCutOffDayRequest(BaseModel):
    """The day whose reminder the user dismissed, so a later day raised meanwhile stays"""

    day: date


class PreviousBankLinkResponse(BaseModel):
    """What an account was last linked to, kept after unlinking"""

    provider_name: str
    external_account_id: str
    external_account_name: str
    institution_name: str
    unlinked_at: datetime


class BankBalanceResponse(BaseModel):
    """The bank's balance for a linked account beside the ledger's at the end of the bank's balance date

    Information only: a difference never adjusts the ledger or changes a total
    """

    # The bank's balance in the account currency's minor units, compared with the sign the bank sent.
    # None when it can't be read exactly in that currency, which shows as unavailable and isn't compared
    amount: int | None

    # Read-only, in minor units, and None when the bank gives none or it can't be read exactly
    available: int | None

    # Whether the bank gave an available balance that can't be read exactly in the account's
    # currency, which shows as unavailable rather than being left out like one the bank never gives
    available_unreadable: bool

    # The moment the bank gives the balance as of
    balance_date: datetime

    # The account's balance in minor units at the end of the balance date's day in the owner's profile
    # timezone, so transactions dated later, future-dated ones included, are left out
    ledger_balance: int

    # The ledger against the bank, ledger minus bank, in minor units, None while amount is
    difference: int | None


class OpeningAdjustmentResponse(BaseModel):
    """The one-time offer to record the gap between the bank's balance and the ledger's once the import is reviewed

    It leaves out what the items still waiting for review would change, which the bank's balance
    already holds
    """

    # The bank's balance minus the ledger's and waiting_amount, in minor units signed as the ledger
    # keeps them, which closes the balances' difference once the items waiting are approved
    amount: int

    # How much approving the items waiting as the bank sent them would move the ledger by the bank's
    # balance date, in signed minor units, zero when nothing waits or nothing it changes is dated by then
    waiting_amount: int

    # The day before the import start, the latest day the bank doesn't supply
    adjustment_date: date


class RecordOpeningAdjustmentRequest(BaseModel):
    """The opening adjustment to record, the amount offered or one the user entered in its place"""

    # Signed minor units, as the ledger keeps them
    amount: int = Field(ge=MIN_MINOR_UNITS, le=MAX_MINOR_UNITS)

    @field_validator("amount")
    @classmethod
    def _refuse_zero(cls, amount: int) -> int:
        """Refuse an adjustment of nothing, which skipping stands for"""
        if amount == 0:
            raise ValueError("Enter an amount other than zero")
        return amount


class AccountBankStatusResponse(BaseModel):
    """An account's live link to a bank account, or what it was last linked to when it has none"""

    account_id: uuid.UUID
    link: BankLinkResponse | None
    previous_link: PreviousBankLinkResponse | None

    # Only for a live link that has synced and follows its bank account as the provider lists it
    balance: BankBalanceResponse | None

    # Only while the opening adjustment is offered and the balances compare
    opening_adjustment: OpeningAdjustmentResponse | None


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


class BankPendingTransactionResponse(BaseModel):
    """A transaction the bank hasn't posted yet, shown for awareness and never in the ledger, review or any total"""

    id: uuid.UUID
    account_id: uuid.UUID
    date: date

    # Signed minor units in the account's currency, money out negative. Null when the bank sent more
    # decimal places than the currency holds, which is never rounded: raw_amount then holds the
    # amount exactly as sent
    amount: int | None
    raw_amount: str | None
    description: str

    # When the request that brought it was sent. An account that can't sync keeps its earlier items,
    # so this says how old they are
    observed_at: datetime


class BankHoldResponse(BaseModel):
    """A booked bank record of no amount, listed for awareness and never in the ledger, review or any total"""

    id: uuid.UUID
    account_id: uuid.UUID
    date: date
    description: str

    # When the request that brought it was sent
    observed_at: datetime


class TransactionBankSource(BaseModel):
    """Where a bank-imported ledger transaction came from, readable after unlinking or disconnecting"""

    provider: str
    provider_name: str

    # The latest values the bank supplied
    bank_values: BankValues

    # When the app received the bank's record of the transaction
    received_at: datetime

    # The fields whose ledger value differs from the bank value it was last aligned with
    edited_fields: list[EditableBankField]

    # The waiting correction or removal about this transaction, if any
    review_item_id: uuid.UUID | None


class RestoreBankValueRequest(BaseModel):
    """The edited field of a bank-imported transaction to put the bank's latest value back on"""

    field: EditableBankField


class ReviewPreferencesResponse(BaseModel):
    """Whether each kind of bank data arriving for an account waits for review or is applied as it arrives"""

    # In this release new bank items wait for review whatever this says, since nothing fills in their
    # merchant and category until the classifier ships
    new_transactions: ReviewDecision
    corrections: ReviewDecision
    removals: ReviewDecision


class UpdateReviewPreferencesRequest(ReviewPreferencesResponse):
    """All three choices, replacing the account's, so a save never leaves a mix of two saves"""
