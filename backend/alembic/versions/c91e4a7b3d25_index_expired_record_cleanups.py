"""Index the columns the scheduled cleanup of expired records filters on.

Revision ID: c91e4a7b3d25
Revises: 7f3c2a9e4b51
Create Date: 2026-11-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c91e4a7b3d25"
down_revision: str | Sequence[str] | None = "7f3c2a9e4b51"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (index, table, column, the condition a partial index holds rows for, or None for every row). A
# partial index holds only the rows the cleanup can remove, so it stays small as the table grows
_INDEXES = (
    ("ix_auth_sessions_expires_at", "auth_sessions", "expires_at", None),
    ("ix_auth_tokens_expires_at", "auth_tokens", "expires_at", None),
    ("ix_auth_tokens_refresh_grace_expires_at", "auth_tokens", "refresh_grace_expires_at", "refresh_grace_expires_at IS NOT NULL"),
    ("ix_webauthn_challenges_expires_at", "webauthn_challenges", "expires_at", None),
    ("ix_mfa_challenges_expires_at", "mfa_challenges", "expires_at", None),
    ("ix_oidc_authorization_requests_expires_at", "oidc_authorization_requests", "expires_at", None),
    ("ix_bank_authorizations_expires_at", "bank_authorizations", "expires_at", None),
    ("ix_login_lockouts_last_failed_at", "login_lockouts", "last_failed_at", None),
    ("ix_signup_email_sends_created_at", "signup_email_sends", "created_at", None),
    ("ix_webauthn_credentials_staged_created_at", "webauthn_credentials", "created_at", "confirmed_at IS NULL"),
    ("ix_totp_credentials_staged_created_at", "totp_credentials", "created_at", "confirmed_at IS NULL"),
    ("ix_recovery_codes_pending_created_at", "recovery_codes", "created_at", "pending IS TRUE"),
    ("ix_import_runs_uncommitted_created_at", "import_runs", "created_at", "committed_at IS NULL"),
    ("ix_import_runs_committed_at", "import_runs", "committed_at", "committed_at IS NOT NULL"),
    ("ix_bank_sync_jobs_finished_at", "bank_sync_jobs", "finished_at", "finished_at IS NOT NULL"),
)


def upgrade() -> None:
    """Add an index for each column the scheduled cleanup filters on that has none.

    No data changes. Building an index holds writes to its table until it is built. Most of these
    tables hold only rows that expire within days. The rest hold confirmed passkeys, authenticators
    and recovery codes, a few for each user, so none grows large enough to hold writes for long
    """
    for name, table, column, condition in _INDEXES:
        op.create_index(name, table, [column], postgresql_where=sa.text(condition) if condition else None)


def downgrade() -> None:
    """Drop the indexes.

    No data changes. The scheduled cleanup goes back to reading each table in full
    """
    for name, table, _column, _condition in reversed(_INDEXES):
        op.drop_index(name, table_name=table)
