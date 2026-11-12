"""Bank connections, the bank accounts they list, and the links to accounts"""

import enum
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import (
    VARCHAR,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, check_values
from app.models.types import EncryptedText

# The longest provider id the provider columns hold
PROVIDER_ID_MAX_LENGTH = 32


def provider_id_check(table: str) -> CheckConstraint:
    """Return a provider column's check: lowercase letters, digits and underscores, starting with a letter

    The id names one of the provider folders the app finds as it starts, so the column takes any id
    of that form rather than a fixed list, and rows of a provider since removed stay valid. The
    registry holds adapters to the same form (services/bank_sync/providers/registry.py)
    """
    return CheckConstraint("provider ~ '^[a-z][a-z0-9_]*$'", name=f"ck_{table}_provider")


class ConnectsFrom(enum.StrEnum):
    """Where the user connects a provider"""

    # One connection in settings reaches many bank accounts, each then linked from its account
    SETTINGS = "settings"

    # Each account's link flow signs in to the bank itself
    ACCOUNT = "account"


class ProviderRequestPurpose(enum.StrEnum):
    """Why a request was sent to a provider, for the rolling request budget"""

    CLAIM = "claim"
    DISCOVERY = "discovery"
    SYNC = "sync"


class BankLinkState(enum.StrEnum):
    """Where a link between an account and a bank account stands"""

    ACTIVE = "active"

    # The provider no longer lists the bank account under the same identity, or its currency
    # changed, so syncing waits until the user chooses the bank account again
    CHOOSE_ACCOUNT = "choose_account"
    UNLINKED = "unlinked"


class BankImportKind(enum.StrEnum):
    """The latest import into a link: the first one, one from a new start, or a catch-up that resumed it

    A catch-up fetches from the link's checkpoint and never moves its import start
    """

    INITIAL = "initial"

    # Linking again after an unlink, as a new link with an import start of its own
    RELINK = "relink"

    # The import after the user chose the bank account again, from a new import start, since the
    # progress of the bank account as the provider listed it before doesn't carry over
    CHOOSE_AGAIN = "choose_again"

    # The catch-up after a rejected credential was replaced, fetching from the checkpoint
    RECONNECT = "reconnect"


class UnavailableReason(enum.StrEnum):
    """Why a bank account can't be linked to a given account"""

    ALREADY_LINKED = "already_linked"
    CURRENCY_MISMATCH = "currency_mismatch"
    CUSTOM_CURRENCY = "custom_currency"
    INSTITUTION_LIMIT = "institution_limit"


# Only rows that aren't unlinked count towards the one-link rules, so an unlinked row keeps its
# "Previously linked to" details without blocking a new link
_LIVE_LINK = "state <> 'unlinked'"

# How long a listing of a connection's bank accounts counts as fresh, or as still under way. Opening
# the link flow asks for a fresh listing once the last one is older, and the due scan lists a
# connection never listed only this long after its claim or its last failed listing, so a claim
# still listing isn't listed twice. Copied into the due scan function in app.db.rls.functions, so a
# change reaches a database only through a migration that recreates the helpers
FRESH_DISCOVERY_AGE = timedelta(hours=1)

# A link's date range import is set or cleared whole
_RANGE_TOGETHER = (
    "(range_first_day IS NULL) = (range_last_day IS NULL) AND (range_first_day IS NULL) = (range_next_day IS NULL) "
    "AND (range_first_day IS NULL) = (range_restores_dismissed IS NULL)"
)
_RANGE_DAYS = "range_first_day <= range_last_day AND range_first_day <= range_next_day AND range_next_day <= range_last_day + 1"


class BankConnection(Base):
    """One user's credential with a bank data provider

    The provider's own credential is the only way to read the user's bank data, so it is
    stored encrypted under the application key and never returned to the browser. The key
    rotation re-encrypts it with the other secrets. Whether the connection is healthy is
    worked out from the times recorded here rather than stored as a status
    """

    __tablename__ = "bank_connections"
    __table_args__ = (provider_id_check("bank_connections"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(VARCHAR(PROVIDER_ID_MAX_LENGTH), nullable=False)

    # The provider's name as its adapter last gave it, set when the connection is made and on each
    # listing, so the connection is still named properly once the provider's folder is deleted
    provider_name: Mapped[str] = mapped_column(Text, nullable=False)
    nickname: Mapped[str | None] = mapped_column(VARCHAR(64))

    # Whatever access the provider's claim handed over, such as a URL carrying the user's credentials
    credential_encrypted: Mapped[str] = mapped_column(EncryptedText, nullable=False)

    # The credential's host, the only part of it ever logged or shown ("Server")
    server_host: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # Set when the provider refuses the credential. That stops automatic sync until the user
    # reconnects. Its action-needed email goes out once the save that sets it commits
    credential_rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Discovery reads which bank accounts the connection lists
    discovered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    discovery_failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # When the due scan next queues a scheduled sync: the earliest time a link is due, a retry
    # included, or the next daily listing while a link waits for its bank account, worked out as
    # each job ends, or None while no link is due
    next_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Set when the provider says its request quota is spent, to when the oldest request then
    # counted leaves the 24 hours, so nothing more is sent before a request frees up
    request_budget_spent_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BankProviderRequest(Base):
    """One request sent to a provider, counted against the connection's rolling 24-hour budget

    Each is recorded before its request is sent, so a request whose sender died afterwards
    still counts, and records past the window are pruned as new ones arrive
    """

    __tablename__ = "bank_provider_requests"
    __table_args__ = (
        CheckConstraint(
            f"purpose IN ({check_values(ProviderRequestPurpose)})",
            name="ck_bank_provider_requests_purpose",
        ),
        # Serves counting and pruning one connection's requests within the window
        Index("ix_bank_provider_requests_connection_id_requested_at", "connection_id", "requested_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bank_connections.id", ondelete="CASCADE"), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    purpose: Mapped[str] = mapped_column(VARCHAR(16), nullable=False)


class BankExternalAccount(Base):
    """A bank account as its connection's provider last listed it

    The list is kept while a rejected credential waits for a reconnect, and goes with the
    connection. Whether a bank account is still listed is a flag rather than a deletion, so
    a link to one that vanished can still name it
    """

    __tablename__ = "bank_external_accounts"
    __table_args__ = (UniqueConstraint("connection_id", "external_id", name="uq_bank_external_accounts_connection_external_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bank_connections.id", ondelete="CASCADE"), nullable=False)
    external_id: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)

    # The institution's identity, counted once however many logins reach it, and its name
    institution_key: Mapped[str] = mapped_column(Text, nullable=False)
    institution_name: Mapped[str] = mapped_column(Text, nullable=False)

    # The bank login the account sits under. A bank sign-in problem is reported against it
    login_key: Mapped[str] = mapped_column(Text, nullable=False)

    # Exactly as the provider sent it. That may be an ISO code or a custom currency's URL, so a
    # bank account the app can't hold in a ledger is still listed and explained
    currency: Mapped[str] = mapped_column(Text, nullable=False)

    # In the currency's minor units, or null when the provider's figure can't be stored exactly
    balance: Mapped[int | None] = mapped_column(BigInteger)
    available_balance: Mapped[int | None] = mapped_column(BigInteger)
    balance_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Whether the provider sent an available balance that can't be stored exactly. A null
    # available balance can't tell that apart from one never sent
    available_balance_unreadable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    # Whether the latest discovery still listed it
    listed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class BankAccountLink(Base):
    """The link between one account and one bank account on a connection

    The link names its bank account by provider and external ID rather than by row, and
    keeps that account's name and institution, so "Previously linked to" reads correctly
    after unlinking or disconnecting has removed the connection and its bank accounts.
    Which accounts may be linked is decided by the bank-linking eligibility check,
    not here
    """

    __tablename__ = "bank_account_links"
    __table_args__ = (
        provider_id_check("bank_account_links"),
        CheckConstraint(f"state IN ({check_values(BankLinkState)})", name="ck_bank_account_links_state"),
        CheckConstraint(f"import_kind IN ({check_values(BankImportKind)})", name="ck_bank_account_links_import_kind"),
        CheckConstraint("(state = 'unlinked') = (unlinked_at IS NOT NULL)", name="ck_bank_account_links_unlinked_at"),
        # A connection can only be deleted once its links are unlinked, so deleting one that
        # still feeds a ledger is refused rather than leaving a link with nothing to sync from
        CheckConstraint("state = 'unlinked' OR connection_id IS NOT NULL", name="ck_bank_account_links_connection"),
        CheckConstraint("retry_count >= 0", name="ck_bank_account_links_retry_count"),
        CheckConstraint(_RANGE_TOGETHER, name="ck_bank_account_links_range"),
        # The next day runs from the first day to the day after the last, and a null leaves the check passing
        CheckConstraint(_RANGE_DAYS, name="ck_bank_account_links_range_days"),
        # An account follows at most one bank account at a time
        Index("uq_bank_account_links_account_id", "account_id", unique=True, postgresql_where=text(_LIVE_LINK)),
        # A bank account feeds at most one ledger per user, even when two connections reach it
        Index(
            "uq_bank_account_links_bank_account",
            "owner_id",
            "provider",
            "external_account_id",
            unique=True,
            postgresql_where=text(_LIVE_LINK),
        ),
        # Serves finding the links a connection syncs
        Index("ix_bank_account_links_connection_id", "connection_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    connection_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("bank_connections.id", ondelete="SET NULL"))

    # What the link was made to, kept after the connection and its bank accounts are gone
    provider: Mapped[str] = mapped_column(VARCHAR(PROVIDER_ID_MAX_LENGTH), nullable=False)
    external_account_id: Mapped[str] = mapped_column(Text, nullable=False)
    external_account_name: Mapped[str] = mapped_column(Text, nullable=False)
    institution_name: Mapped[str] = mapped_column(Text, nullable=False)

    state: Mapped[str] = mapped_column(
        VARCHAR(16),
        nullable=False,
        default=BankLinkState.ACTIVE,
        server_default=BankLinkState.ACTIVE.value,
    )
    import_kind: Mapped[str] = mapped_column(VARCHAR(16), nullable=False)

    # The first day the link's bank data covers. Choosing the bank account again sets it anew. A
    # catch-up fetches from the checkpoint instead and never moves it
    import_start: Mapped[date] = mapped_column(Date, nullable=False)
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    unlinked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # The last day the link's data is known complete through. It only moves forward once a
    # sync has stored everything up to it
    checkpoint: Mapped[date] = mapped_column(Date, nullable=False)

    # When the sync that last moved the checkpoint, or brought the bank account back whole through
    # today, started. Only a sync job sets it. The window planner reads a checkpoint short of the
    # day this falls on as an import or catch-up still under way, and any other as a link to re-read
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # When the link's last sync attempt sent its request, or stopped when the sync stopped before
    # recording it, and why the attempt failed, or None when it succeeded. A failure never moves
    # last_success_at
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_failure_reason: Mapped[str | None] = mapped_column(Text)

    # The failed attempts in the link's current retry series, 1 to 4, or 0 when it isn't waiting to
    # retry, and when its next attempt is due: a retry, the end of the rest after a series, or its
    # next daily sync. None when no time holds it back, such as during an import
    retry_count: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, server_default="0")
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Set once a sync leaves 100 or more new items waiting for review. That stops the link's sync,
    # and it is cleared once 50 or fewer are left, so the link stays paused in between
    paused: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    # While the link's latest import is under way. Syncs take an import to today whatever the review
    # backlog, and the pause applies once it ends. Every link starts with one
    importing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    signin_needed_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # The first day the running import or catch-up asked from: an import's start, or the first day a
    # catch-up over more than a week lacked. None while neither runs
    catchup_requested_start: Mapped[date | None] = mapped_column(Date)

    # The earliest booked date the provider returned to the running import or catch-up from its first
    # day on. It tells whether the import reached that day. None until one arrives
    earliest_booked_date: Mapped[date | None] = mapped_column(Date)

    # The reminder the last import or catch-up that fell short raised: the first day it asked from,
    # and the earliest booked date it got, or None when it got none. None when none was raised, or
    # when one that got none was cleared by a later sync bringing booked history from that first day on
    history_reminder_start: Mapped[date | None] = mapped_column(Date)
    history_reminder_earliest: Mapped[date | None] = mapped_column(Date)

    # Belongs to the import or catch-up that raised the incomplete-history reminder, so a later
    # one that falls short clears it to raise its own, and a later sync that brings booked history
    # from the first day of a reminder that got none clears it with that reminder
    history_reminder_dismissed: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )

    # The latest day kept although its response may have been cut short, as a single day that still
    # brought back as many transactions as the provider sends at once, and whether the user dismissed
    # its reminder. Only a later day raises it again
    cut_off_day: Mapped[date | None] = mapped_column(Date)
    cut_off_day_dismissed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    # A date range the user asked to import, its first and last days both included, the next day it
    # still has to fetch, and whether it brings back items dismissed before. It is fetched once, after
    # the link's routine sync, and clears once its last day is stored. All four are null while no
    # range runs
    range_first_day: Mapped[date | None] = mapped_column(Date)
    range_last_day: Mapped[date | None] = mapped_column(Date)
    range_next_day: Mapped[date | None] = mapped_column(Date)
    range_restores_dismissed: Mapped[bool | None] = mapped_column(Boolean)

    # Why the last date range import stopped short or left days out, as the Bank link section says it.
    # None when it brought in every day, and while a new one runs
    range_outcome: Mapped[str | None] = mapped_column(Text)
