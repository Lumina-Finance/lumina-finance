"""count failed sign-ins per email instead of per password credential

Revision ID: 4e8b2d6a9c15
Revises: 9d2f6b4e7a31
Create Date: 2026-10-24 07:00:00.000000
"""

import hashlib
import hmac
from collections.abc import Callable, Sequence

import sqlalchemy as sa

from alembic import op
from app.bank_transaction_key import resolve_key
from app.db.rls import grant_auth_table

revision: str = "4e8b2d6a9c15"
down_revision: str | Sequence[str] | None = "9d2f6b4e7a31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "login_lockouts"

# What the server keeps to recognise an email: HMAC-SHA256 of its UTF-8 bytes under a key that is
# itself HMAC-SHA256 of this label under the server's bank transaction hash key. The label and key
# must match app.services.auth.login_email_hash, or a lock carried over would no longer match its email
# and the account would unlock. That module now folds A to Z first, so only a lock in force on the day
# of this upgrade, on an address with capitals, is forgotten
_LOCKOUT_KEY_LABEL = b"login-lockout"


def _email_hasher() -> Callable[[str], str]:
    """Return a function that gives an email's stored hash, which needs the server's secret key"""
    lockout_key = hmac.new(resolve_key(generate=False), _LOCKOUT_KEY_LABEL, hashlib.sha256).digest()
    return lambda email: hmac.new(lockout_key, email.encode(), hashlib.sha256).hexdigest()


def upgrade() -> None:
    """Create the per-email lockout records, carry every existing count and lock into them and drop the old columns

    Each credential with a failure count or a lock moves to the row of its account's email, so nobody
    is unlocked or given a fresh allowance by the upgrade. The old columns held no failure time, so a
    carried row records the upgrade time, which only decides when the scheduled cleanup forgets an
    idle count. The server's bank transaction hash key is needed only when there is something to carry
    """
    op.create_table(
        _TABLE,
        sa.Column("email_hash", sa.VARCHAR(length=64), nullable=False),
        sa.Column("failed_attempt_count", sa.Integer(), nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_failed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("email_hash"),
    )

    # Added after the row-level security bootstrap, so grant the app role here
    grant_auth_table(op.get_bind(), _TABLE)

    connection = op.get_bind()
    carried = connection.execute(
        sa.text(
            "SELECT users.email, password_credentials.failed_attempt_count, password_credentials.locked_until "
            "FROM password_credentials JOIN users ON users.id = password_credentials.user_id "
            "WHERE password_credentials.failed_attempt_count > 0 OR password_credentials.locked_until IS NOT NULL"
        )
    ).all()
    if carried:
        hash_email = _email_hasher()
        for email, failed_attempt_count, locked_until in carried:
            connection.execute(
                sa.text(
                    f"INSERT INTO {_TABLE} (email_hash, failed_attempt_count, locked_until, last_failed_at) "  # noqa: S608
                    "VALUES (:email_hash, :failed_attempt_count, :locked_until, now())"
                ),
                {
                    "email_hash": hash_email(email),
                    "failed_attempt_count": failed_attempt_count,
                    "locked_until": locked_until,
                },
            )

    op.drop_column("password_credentials", "locked_until")
    op.drop_column("password_credentials", "failed_attempt_count")


def downgrade() -> None:
    """Put the counts and locks back on the password credentials and drop the per-email records

    A record goes back to the account whose email it names, found by hashing every account's email
    with the server's bank transaction hash key, which this needs only when there are records. When
    the key is not the one the records were made with, no record matches an account and every count
    and lock is dropped. Records of emails no account has are dropped too. Upgrading again carries
    back what was restored
    """
    op.add_column(
        "password_credentials",
        sa.Column("failed_attempt_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.alter_column("password_credentials", "failed_attempt_count", server_default=None)
    op.add_column("password_credentials", sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True))

    connection = op.get_bind()
    records = connection.execute(
        sa.text(f"SELECT email_hash, failed_attempt_count, locked_until FROM {_TABLE}")  # noqa: S608
    ).all()
    if records:
        hash_email = _email_hasher()
        user_ids_by_hash = {
            hash_email(email): user_id
            for user_id, email in connection.execute(
                sa.text(
                    "SELECT users.id, users.email FROM users "
                    "JOIN password_credentials ON password_credentials.user_id = users.id"
                )
            )
        }
        for email_hash, failed_attempt_count, locked_until in records:
            user_id = user_ids_by_hash.get(email_hash)
            if user_id is not None:
                connection.execute(
                    sa.text(
                        "UPDATE password_credentials SET failed_attempt_count = :failed_attempt_count, "
                        "locked_until = :locked_until WHERE user_id = :user_id"
                    ),
                    {"failed_attempt_count": failed_attempt_count, "locked_until": locked_until, "user_id": user_id},
                )

    op.drop_table(_TABLE)
