"""Durable bank sync jobs and the worker's heartbeat"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    VARCHAR,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, check_values


class ProviderErrorKind(enum.StrEnum):
    """What a provider failure means for sync, and so whether trying again can help

    Provider adapters report these, and a job stores the last one it met
    """

    # The stored credential no longer works, so automatic sync stops until the user reconnects
    CREDENTIAL_REJECTED = "credential_rejected"

    # The bank needs the user to sign in again at the provider, and retrying can't fix that
    BANK_LOGIN_NEEDED = "bank_login_needed"

    # The provider refuses requests until the user settles a payment problem with it
    PAYMENT_REQUIRED = "payment_required"
    RATE_LIMITED = "rate_limited"
    TEMPORARY = "temporary"
    UNKNOWN = "unknown"


class BankSyncJobKind(enum.StrEnum):
    """Why a job was queued, in the order jobs are claimed"""

    INITIAL = "initial"
    MANUAL = "manual"
    RETRY = "retry"
    SCHEDULED = "scheduled"


# Each kind's rank in the claim order, lowest claimed first, taken from the order the kinds are
# declared in. The claim and the merge of new work into a queued job both rank by it. Copied into the
# claim function in app.db.rls.functions, so a change reaches a database only through a migration that
# recreates the helpers
CLAIM_RANK: dict[BankSyncJobKind, int] = {kind: rank for rank, kind in enumerate(BankSyncJobKind)}


class BankSyncJobStatus(enum.StrEnum):
    """Where a job stands"""

    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


# The heartbeat table holds one row, and this is its id
HEARTBEAT_ID = 1


class BankSyncJob(Base):
    """One sync of a connection, queued in the database so a crashed worker loses nothing

    The date window isn't stored: the job works it out from its links' checkpoints when it runs.
    A connection has at most one running and one queued job, and new work merges into the queued
    one. A claim sets a lease and moves the attempt number, so a runner that outlived its lease
    can tell it no longer holds the job. These rows are the whole queue, so nothing here depends on
    a queue service
    """

    __tablename__ = "bank_sync_jobs"
    __table_args__ = (
        CheckConstraint(f"kind IN ({check_values(BankSyncJobKind)})", name="ck_bank_sync_jobs_kind"),
        CheckConstraint(f"status IN ({check_values(BankSyncJobStatus)})", name="ck_bank_sync_jobs_status"),
        CheckConstraint(
            f"last_error_kind IN ({check_values(ProviderErrorKind)})",
            name="ck_bank_sync_jobs_last_error_kind",
        ),
        CheckConstraint(
            "(status IN ('succeeded', 'failed')) = (finished_at IS NOT NULL)",
            name="ck_bank_sync_jobs_finished_at",
        ),
        CheckConstraint("status <> 'running' OR lease_expires_at IS NOT NULL", name="ck_bank_sync_jobs_lease"),
        CheckConstraint("attempt >= 0", name="ck_bank_sync_jobs_attempt"),
        Index("uq_bank_sync_jobs_running", "connection_id", unique=True, postgresql_where=text("status = 'running'")),
        Index("uq_bank_sync_jobs_queued", "connection_id", unique=True, postgresql_where=text("status = 'queued'")),
        # Serves the claim. The claim looks for queued jobs that are due and running ones whose lease ran out
        Index("ix_bank_sync_jobs_status_run_after", "status", "run_after"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bank_connections.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(VARCHAR(16), nullable=False)

    # Whether to list the connection's bank accounts again before syncing
    discover: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    status: Mapped[str] = mapped_column(
        VARCHAR(16),
        nullable=False,
        default=BankSyncJobStatus.QUEUED,
        server_default=BankSyncJobStatus.QUEUED.value,
    )
    run_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # The links the job syncs, recorded once it runs so their status can say a sync is under way
    covered_link_ids: Mapped[list[uuid.UUID] | None] = mapped_column(ARRAY(Uuid))

    # The links an earlier job of the connection couldn't bring back whole. This job plans them
    # only once no other link is due, so a link failing on every request doesn't take each request
    # the budget frees ahead of links that can progress
    deferred_link_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(Uuid), nullable=False, default=list, server_default="{}")

    # The links the user asked to sync now. The job syncs them whatever their next daily time, and
    # a queued job's status reads as requested until a worker starts it
    requested_link_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(Uuid), nullable=False, default=list, server_default="{}")

    # The kind of the last failure the provider adapter reported
    last_error_kind: Mapped[str | None] = mapped_column(VARCHAR(32))

    # The provider's own message or one built from its host and status, cut to 500 characters, and
    # never built from the credential
    last_error_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # Finished jobs are deleted 30 days after this by the expired-record cleanup
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BankSyncHeartbeat(Base):
    """When the bank sync worker last scanned for due work

    The app reads it to tell when sync isn't running, and only the worker writes it, through a
    definer function, since the row describes the deployment rather than any user
    """

    __tablename__ = "bank_sync_heartbeat"
    __table_args__ = (CheckConstraint(f"id = {HEARTBEAT_ID}", name="ck_bank_sync_heartbeat_singleton"),)

    # autoincrement is stated so the metadata and the migration build the same column, as on the
    # encryption key fingerprint
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False, default=HEARTBEAT_ID)
    last_scan_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
