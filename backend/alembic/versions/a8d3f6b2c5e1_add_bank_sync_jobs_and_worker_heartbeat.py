"""add bank sync jobs, the worker heartbeat and the worker's functions

Revision ID: a8d3f6b2c5e1
Revises: 2e9b5d8c1f47
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op
from app.db.downgrade_guard import refuse_while_tables_hold_rows
from app.db.rls import grant_global_read_table, secure_registered_table
from app.db.rls.functions import create_helper_functions

revision: str = "a8d3f6b2c5e1"
down_revision: str | Sequence[str] | None = "2e9b5d8c1f47"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_WORKER_FUNCTIONS = (
    "public.claim_bank_sync_jobs(integer)",
    "public.list_due_bank_connections(timestamptz)",
    "public.record_bank_sync_scan(timestamptz)",
    "public.migration_revisions()",
)


def upgrade() -> None:
    """Create the job and heartbeat tables, empty, and the worker's definer functions

    No heartbeat row exists until a worker first scans, which reads as sync not running. A
    database that ran the bootstrap migration on this code already has the functions, and
    creating them again replaces them with the same bodies
    """
    op.create_table(
        "bank_sync_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("connection_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.VARCHAR(length=16), nullable=False),
        sa.Column("discover", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("status", sa.VARCHAR(length=16), server_default="queued", nullable=False),
        sa.Column("run_after", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("attempt", sa.Integer(), server_default="0", nullable=False),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("covered_link_ids", postgresql.ARRAY(sa.Uuid()), nullable=True),
        sa.Column("last_error_kind", sa.VARCHAR(length=32), nullable=True),
        sa.Column("last_error_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["connection_id"], ["bank_connections.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("kind IN ('initial', 'manual', 'retry', 'scheduled')", name="ck_bank_sync_jobs_kind"),
        sa.CheckConstraint("status IN ('queued', 'running', 'succeeded', 'failed')", name="ck_bank_sync_jobs_status"),
        sa.CheckConstraint(
            "last_error_kind IN ('credential_rejected', 'bank_login_needed', 'payment_required', 'rate_limited', 'temporary', 'unknown')",
            name="ck_bank_sync_jobs_last_error_kind",
        ),
        sa.CheckConstraint(
            "(status IN ('succeeded', 'failed')) = (finished_at IS NOT NULL)", name="ck_bank_sync_jobs_finished_at",
        ),
        sa.CheckConstraint("status <> 'running' OR lease_expires_at IS NOT NULL", name="ck_bank_sync_jobs_lease"),
        sa.CheckConstraint("attempt >= 0", name="ck_bank_sync_jobs_attempt"),
    )
    op.create_index(
        "uq_bank_sync_jobs_running",
        "bank_sync_jobs",
        ["connection_id"],
        unique=True,
        postgresql_where=sa.text("status = 'running'"),
    )
    op.create_index(
        "uq_bank_sync_jobs_queued",
        "bank_sync_jobs",
        ["connection_id"],
        unique=True,
        postgresql_where=sa.text("status = 'queued'"),
    )
    op.create_index("ix_bank_sync_jobs_status_run_after", "bank_sync_jobs", ["status", "run_after"])
    op.create_table(
        "bank_sync_heartbeat",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("last_scan_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("id = 1", name="ck_bank_sync_heartbeat_singleton"),
    )
    secure_registered_table(op.get_bind(), "bank_sync_jobs")
    grant_global_read_table(op.get_bind(), "bank_sync_heartbeat")
    create_helper_functions(op.get_bind())


def downgrade() -> None:
    """Drop the jobs, the heartbeat and the worker's functions, refusing while any job exists

    Dropping a queued or running job would silently cancel a sync or an import part way, and
    finished jobs hold the last errors their links' status reads. The heartbeat only says when
    the worker last scanned, which it writes again on its next scan, so it doesn't hold the
    rollback back
    """
    refuse_while_tables_hold_rows(op.get_bind(), {"bank_sync_jobs": "bank sync jobs, queued, running and finished"})
    for signature in _WORKER_FUNCTIONS:
        op.execute(sa.text(f"DROP FUNCTION IF EXISTS {signature}"))
    op.drop_table("bank_sync_heartbeat")
    op.drop_table("bank_sync_jobs")
