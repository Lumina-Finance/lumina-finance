"""count failed sign-ins per browser as well as per email

Revision ID: 5d3c8f1a7b92
Revises: c7e4a9d2b3f5
Create Date: 2026-11-21 23:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "5d3c8f1a7b92"
down_revision: str | Sequence[str] | None = "c7e4a9d2b3f5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "login_lockouts"
_PRIMARY_KEY = "login_lockouts_pkey"

# The bucket for every sender without a known browser for the address. Every row counted before buckets
# existed counted these senders. Matches app.services.auth.known_browser.SHARED_BUCKET
_SHARED_BUCKET = ""


def upgrade() -> None:
    """Key each lockout record by its bucket too, filing every existing record in the shared bucket

    Nobody is unlocked or given a fresh allowance, since every count and lock that exists carries over
    unchanged as the count of everyone without a known browser. A known browser starts with no count,
    so an owner locked out by a stranger before the upgrade signs in again once the lock lapses
    """
    op.add_column(_TABLE, sa.Column("bucket_hash", sa.VARCHAR(length=64), server_default=_SHARED_BUCKET, nullable=False))
    op.alter_column(_TABLE, "bucket_hash", server_default=None)
    op.drop_constraint(_PRIMARY_KEY, _TABLE, type_="primary")
    op.create_primary_key(_PRIMARY_KEY, _TABLE, ["email_hash", "bucket_hash"])


def downgrade() -> None:
    """Return to one record per email, keeping only the shared bucket's

    A record counted for a known browser or a session is deleted, so a count or lock held there is
    forgotten. That can unlock an address that a browser had locked or a session had failed a step-up
    on. The shared records are kept as they are. Upgrading again files them in the shared bucket again
    """
    op.execute(sa.text(f"DELETE FROM {_TABLE} WHERE bucket_hash <> :shared").bindparams(shared=_SHARED_BUCKET))  # noqa: S608
    op.drop_constraint(_PRIMARY_KEY, _TABLE, type_="primary")
    op.create_primary_key(_PRIMARY_KEY, _TABLE, ["email_hash"])
    op.drop_column(_TABLE, "bucket_hash")
