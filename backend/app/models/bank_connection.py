"""Bank connections, the bank accounts they list, and the links to Lumina accounts"""

import enum
import uuid
from datetime import date, datetime

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


class BankProvider(enum.StrEnum):
    """A bank data provider Lumina can hold a connection to"""

    SIMPLEFIN = "simplefin"


class ProviderRequestPurpose(enum.StrEnum):
    """Why a request was sent to a provider, for the rolling request budget"""

    CLAIM = "claim"
    DISCOVERY = "discovery"
    SYNC = "sync"


class BankLinkState(enum.StrEnum):
    """Where a link between a Lumina account and a bank account stands"""

    ACTIVE = "active"

    # The provider no longer lists the bank account under the same identity, or its currency
    # changed, so syncing waits until the user chooses the bank account again
    CHOOSE_ACCOUNT = "choose_account"
    UNLINKED = "unlinked"


class BankImportKind(enum.StrEnum):
    """The latest import into a link: the first one, or a catch-up that resumed it

    A catch-up fetches from the link's checkpoint and never moves its import start
    """

    INITIAL = "initial"

    # Linking again after an unlink, as a new link with an import start of its own
    RELINK = "relink"

    # The catch-up after the user chose the bank account again, fetching from the checkpoint
    CHOOSE_AGAIN = "choose_again"

    # The catch-up after a rejected credential was replaced, fetching from the checkpoint
    RECONNECT = "reconnect"


class OpeningAdjustmentState(enum.StrEnum):
    """Where a link's one-time opening adjustment offer stands"""

    NOT_READY = "not_ready"
    OFFERED = "offered"
    ACCEPTED = "accepted"
    SKIPPED = "skipped"

    # Nothing to offer: the balances matched, or the bank gave no usable balance
    NONE = "none"


# Only rows that aren't unlinked count towards the one-link rules, so an unlinked row keeps its
# "Previously linked to" details without blocking a new link
_LIVE_LINK = "state <> 'unlinked'"


class BankConnection(Base):
    """One user's credential with a bank data provider

    The provider's own credential is the only way to read the user's bank data, so it is
    stored encrypted under the application key, which the key rotation re-encrypts with the
    other secrets, and it is never returned to the browser. Whether the connection is
    healthy is worked out from the times recorded here rather than stored as a status
    """

    __tablename__ = "bank_connections"
    __table_args__ = (CheckConstraint(f"provider IN ({check_values(BankProvider)})", name="ck_bank_connections_provider"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(VARCHAR(32), nullable=False)
    nickname: Mapped[str | None] = mapped_column(VARCHAR(64))

    # For SimpleFIN, the Access URL, which carries the user's credentials before the Bridge's host
    credential_encrypted: Mapped[str] = mapped_column(EncryptedText, nullable=False)

    # The credential's host, the only part of it ever logged or shown ("Server")
    server_host: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # Set when the provider refuses the credential, which stops automatic sync until the user
    # reconnects, and the time the action-needed email for it went out, so it goes out once
    credential_rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rejection_emailed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Discovery reads which bank accounts the connection lists
    discovered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    discovery_failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


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

    # The institution's identity, which counts once however many logins reach it, and its name
    institution_key: Mapped[str] = mapped_column(Text, nullable=False)
    institution_name: Mapped[str] = mapped_column(Text, nullable=False)

    # The bank login the account sits under, which a bank sign-in problem is reported against
    login_key: Mapped[str] = mapped_column(Text, nullable=False)

    # Exactly as the provider sent it, which may be an ISO code or a custom currency's URL, so a
    # bank account Lumina can't hold in a ledger is still listed and explained
    currency: Mapped[str] = mapped_column(Text, nullable=False)

    # In the currency's minor units, or null when the provider's figure can't be stored exactly
    balance: Mapped[int | None] = mapped_column(BigInteger)
    available_balance: Mapped[int | None] = mapped_column(BigInteger)
    balance_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Whether the latest discovery still listed it
    listed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class BankAccountLink(Base):
    """The link between one Lumina account and one bank account on a connection

    The link names its bank account by provider and external ID rather than by row, and
    keeps that account's name and institution, so "Previously linked to" reads correctly
    after unlinking or disconnecting has removed the connection and its bank accounts.
    Which Lumina accounts may be linked is decided by the bank-linking eligibility check,
    not here
    """

    __tablename__ = "bank_account_links"
    __table_args__ = (
        CheckConstraint(f"provider IN ({check_values(BankProvider)})", name="ck_bank_account_links_provider"),
        CheckConstraint(f"state IN ({check_values(BankLinkState)})", name="ck_bank_account_links_state"),
        CheckConstraint(f"import_kind IN ({check_values(BankImportKind)})", name="ck_bank_account_links_import_kind"),
        CheckConstraint(
            f"opening_adjustment_state IN ({check_values(OpeningAdjustmentState)})",
            name="ck_bank_account_links_opening_adjustment_state",
        ),
        CheckConstraint("(state = 'unlinked') = (unlinked_at IS NOT NULL)", name="ck_bank_account_links_unlinked_at"),
        # A connection can only be deleted once its links are unlinked, so deleting one that
        # still feeds a ledger is refused rather than leaving a link with nothing to sync from
        CheckConstraint("state = 'unlinked' OR connection_id IS NOT NULL", name="ck_bank_account_links_connection"),
        CheckConstraint("retry_count >= 0", name="ck_bank_account_links_retry_count"),
        # A Lumina account follows at most one bank account at a time
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
    provider: Mapped[str] = mapped_column(VARCHAR(32), nullable=False)
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

    # The first day the link's bank data covers. A catch-up fetches from the checkpoint instead
    # and never moves it
    import_start: Mapped[date] = mapped_column(Date, nullable=False)
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    unlinked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # The last day the link's data is known complete through, which only moves forward once a
    # sync has stored everything up to it
    checkpoint: Mapped[date] = mapped_column(Date, nullable=False)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_failure_reason: Mapped[str | None] = mapped_column(Text)
    retry_count: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, server_default="0")
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Sync stops while too many new items wait for review, and resumes once enough are decided
    paused: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    signin_needed_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    catchup_requested_start: Mapped[date | None] = mapped_column(Date)

    # The earliest booked date the provider returned, which tells whether the import reached its start
    earliest_booked_date: Mapped[date | None] = mapped_column(Date)

    # Belongs to the import or catch-up that raised the incomplete-history reminder, so a later
    # one that falls short clears it to raise its own
    history_reminder_dismissed: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )
    opening_adjustment_state: Mapped[str] = mapped_column(
        VARCHAR(16),
        nullable=False,
        default=OpeningAdjustmentState.NOT_READY,
        server_default=OpeningAdjustmentState.NOT_READY.value,
    )


class BankSigninNotice(Base):
    """A bank login on a connection that needs the user to sign in again at the bank

    One row per login while the problem lasts, so the action-needed email goes out once
    each time the problem starts
    """

    __tablename__ = "bank_signin_notices"
    __table_args__ = (UniqueConstraint("connection_id", "login_key", name="uq_bank_signin_notices_connection_login"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bank_connections.id", ondelete="CASCADE"), nullable=False)
    login_key: Mapped[str] = mapped_column(Text, nullable=False)
    since: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    emailed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
