"""add bank connections, their bank accounts and account links

Revision ID: 5b8e2d4f7a13
Revises: 8d3f6a1c4e72
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.downgrade_guard import refuse_while_tables_hold_rows
from app.db.rls import secure_registered_table

revision: str = "5b8e2d4f7a13"
down_revision: str | Sequence[str] | None = "8d3f6a1c4e72"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_LIVE_LINK = "state <> 'unlinked'"

# Dropped in reverse, so a table goes before the ones it references
_TABLES = (
    "bank_connections",
    "bank_provider_requests",
    "bank_external_accounts",
    "bank_account_links",
)


def upgrade() -> None:
    """Create the bank connection tables, empty, and enable their row-level security

    Nothing existing changes: no account is linked until a user connects a bank
    """
    op.create_table(
        "bank_connections",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.VARCHAR(length=32), nullable=False),
        sa.Column("nickname", sa.VARCHAR(length=64), nullable=True),
        sa.Column("credential_encrypted", sa.Text(), nullable=False),
        sa.Column("server_host", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("credential_rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("discovered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("discovery_failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("provider ~ '^[a-z][a-z0-9_]*$'", name="ck_bank_connections_provider"),
    )
    op.create_table(
        "bank_provider_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("connection_id", sa.Uuid(), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("purpose", sa.VARCHAR(length=16), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["connection_id"], ["bank_connections.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("purpose IN ('claim', 'discovery', 'sync')", name="ck_bank_provider_requests_purpose"),
    )
    op.create_index(
        "ix_bank_provider_requests_connection_id_requested_at",
        "bank_provider_requests",
        ["connection_id", "requested_at"],
    )
    op.create_table(
        "bank_external_accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("connection_id", sa.Uuid(), nullable=False),
        sa.Column("external_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("institution_key", sa.Text(), nullable=False),
        sa.Column("institution_name", sa.Text(), nullable=False),
        sa.Column("login_key", sa.Text(), nullable=False),
        sa.Column("currency", sa.Text(), nullable=False),
        sa.Column("balance", sa.BigInteger(), nullable=True),
        sa.Column("available_balance", sa.BigInteger(), nullable=True),
        sa.Column("balance_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("listed", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["connection_id"], ["bank_connections.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("connection_id", "external_id", name="uq_bank_external_accounts_connection_external_id"),
    )
    op.create_table(
        "bank_account_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("connection_id", sa.Uuid(), nullable=True),
        sa.Column("provider", sa.VARCHAR(length=32), nullable=False),
        sa.Column("external_account_id", sa.Text(), nullable=False),
        sa.Column("external_account_name", sa.Text(), nullable=False),
        sa.Column("institution_name", sa.Text(), nullable=False),
        sa.Column("state", sa.VARCHAR(length=16), server_default="active", nullable=False),
        sa.Column("import_kind", sa.VARCHAR(length=16), nullable=False),
        sa.Column("import_start", sa.Date(), nullable=False),
        sa.Column("linked_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("unlinked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("checkpoint", sa.Date(), nullable=False),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_failure_reason", sa.Text(), nullable=True),
        sa.Column("retry_count", sa.SmallInteger(), server_default="0", nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paused", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("signin_needed_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("catchup_requested_start", sa.Date(), nullable=True),
        sa.Column("earliest_booked_date", sa.Date(), nullable=True),
        sa.Column("history_reminder_dismissed", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("opening_adjustment_state", sa.VARCHAR(length=16), server_default="not_ready", nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["connection_id"], ["bank_connections.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("provider ~ '^[a-z][a-z0-9_]*$'", name="ck_bank_account_links_provider"),
        sa.CheckConstraint("state IN ('active', 'choose_account', 'unlinked')", name="ck_bank_account_links_state"),
        sa.CheckConstraint(
            "import_kind IN ('initial', 'relink', 'choose_again', 'reconnect')",
            name="ck_bank_account_links_import_kind",
        ),
        sa.CheckConstraint(
            "opening_adjustment_state IN ('not_ready', 'offered', 'recorded', 'skipped', 'none')",
            name="ck_bank_account_links_opening_adjustment_state",
        ),
        sa.CheckConstraint("(state = 'unlinked') = (unlinked_at IS NOT NULL)", name="ck_bank_account_links_unlinked_at"),
        sa.CheckConstraint("state = 'unlinked' OR connection_id IS NOT NULL", name="ck_bank_account_links_connection"),
        sa.CheckConstraint("retry_count >= 0", name="ck_bank_account_links_retry_count"),
    )
    op.create_index(
        "uq_bank_account_links_account_id",
        "bank_account_links",
        ["account_id"],
        unique=True,
        postgresql_where=sa.text(_LIVE_LINK),
    )
    op.create_index(
        "uq_bank_account_links_bank_account",
        "bank_account_links",
        ["owner_id", "provider", "external_account_id"],
        unique=True,
        postgresql_where=sa.text(_LIVE_LINK),
    )
    op.create_index("ix_bank_account_links_connection_id", "bank_account_links", ["connection_id"])
    for table in _TABLES:
        secure_registered_table(op.get_bind(), table)


def downgrade() -> None:
    """Drop the bank connection tables, refusing while any of them holds a row

    Dropping them would delete users' stored bank credentials, which only a new setup token
    could replace, and every account link with its sync progress and "Previously linked to"
    details, so the rollback refuses rather than destroy them
    """
    refuse_while_tables_hold_rows(
        op.get_bind(),
        {
            "bank_connections": "bank connections and their stored credentials",
            "bank_external_accounts": "the bank accounts connections list",
            "bank_account_links": "links between Lumina accounts and bank accounts",
            "bank_provider_requests": "the record of provider requests the daily request budget counts",
        },
    )
    for table in reversed(_TABLES):
        op.drop_table(table)
