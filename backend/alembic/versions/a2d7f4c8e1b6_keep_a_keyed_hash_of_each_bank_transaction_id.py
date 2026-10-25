"""keep a keyed hash of each bank transaction ID and only the bank fields the app uses

Revision ID: a2d7f4c8e1b6
Revises: 8d86357d118a
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op
from app.bank_transaction_key import resolve_key
from app.db.downgrade_guard import refuse_while_tables_hold_rows

revision: str = "a2d7f4c8e1b6"
down_revision: str | Sequence[str] | None = "8d86357d118a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Characters of a SHA-256 digest in lower-case hex
_HASH_LENGTH = 64

# Bytes in one SHA-256 block, which HMAC pads its key to
_SHA256_BLOCK_BYTES = 64

# The columns a dismissed record keeps empty, before and after the fields the app never shows go
_OBSERVATION_BEFORE = (
    "observed_date",
    "observed_amount",
    "raw_amount",
    "description",
    "merchant_name",
    "category_hint",
    "extras",
    "observed_at",
)
_OBSERVATION_AFTER = ("observed_date", "observed_amount", "raw_amount", "description", "observed_at")

# The same keyed hash an OFX import keeps (app.bank_transaction_key), over the provider and the
# bank account joined by a colon as the bank account key and the provider's transaction ID as the
# bank ID. HMAC is built from its definition as in the OFX migration, since Postgres has no HMAC
# without an extension. It must match the server byte for byte, or the next sync would bring in
# again every transaction the user already decided
_HASH_SAVED_IDS = r"""
    UPDATE bank_transactions
    SET external_transaction_hash = encode(
        sha256(:outer_key || sha256(:inner_key || sha256(
            convert_to(provider || ':' || external_account_id, 'UTF8') || '\x00'::bytea
            || convert_to(external_transaction_id, 'UTF8')
        ))),
        'hex'
    )
"""


def _hmac_keys(key: bytes) -> tuple[bytes, bytes]:
    """Return the server key padded to a block and masked for HMAC's inner and outer hash"""
    padded = key.ljust(_SHA256_BLOCK_BYTES, b"\x00")
    return bytes(byte ^ 0x36 for byte in padded), bytes(byte ^ 0x5C for byte in padded)


def _dismissed_check(columns: Sequence[str]) -> str:
    """Return the condition that a dismissed record keeps only its identity"""
    return "disposition <> 'dismissed' OR (" + " AND ".join(f"{column} IS NULL" for column in columns) + ")"


def upgrade() -> None:
    """Replace each bank transaction's ID with its keyed hash, and drop the fields the app never shows

    Every saved record gets the keyed hash the server now keeps for it, so a sync still recognizes
    what the user already reviewed. That needs the server's bank transaction hash key, and the
    upgrade stops without it. The IDs, and the payee, memo and extra fields the bank sent, are then
    dropped and cannot be recovered. A pending item keeps no ID, since it is replaced at every sync
    """
    key = resolve_key(generate=False)
    inner_key, outer_key = _hmac_keys(key)
    op.drop_constraint("ck_bank_transactions_dismissed", "bank_transactions", type_="check")
    op.add_column("bank_transactions", sa.Column("external_transaction_hash", sa.VARCHAR(length=_HASH_LENGTH), nullable=True))
    op.execute(
        sa.text(_HASH_SAVED_IDS).bindparams(
            sa.bindparam("inner_key", inner_key, type_=sa.LargeBinary),
            sa.bindparam("outer_key", outer_key, type_=sa.LargeBinary),
        )
    )
    op.alter_column("bank_transactions", "external_transaction_hash", nullable=False)

    # Dropping a column drops the identity constraint that names it
    for column in ("external_transaction_id", "merchant_name", "category_hint", "extras"):
        op.drop_column("bank_transactions", column)
    op.create_unique_constraint(
        "uq_bank_transactions_identity",
        "bank_transactions",
        ["account_id", "provider", "external_account_id", "external_transaction_hash"],
    )
    op.create_check_constraint("ck_bank_transactions_dismissed", "bank_transactions", _dismissed_check(_OBSERVATION_AFTER))
    op.drop_column("bank_pending_transactions", "external_transaction_id")


def downgrade() -> None:
    """Bring back the ID and the payee, memo and extra columns empty, and drop the hashes

    Irreversible for the data: a hash cannot be turned back into the ID, so this refuses while any
    bank transaction is saved. Pending items are replaced at the next sync, so they are cleared
    """
    refuse_while_tables_hold_rows(op.get_bind(), {"bank_transactions": "the keyed hashes of bank transaction IDs"})
    op.execute(sa.text("DELETE FROM bank_pending_transactions"))
    op.add_column("bank_pending_transactions", sa.Column("external_transaction_id", sa.Text(), nullable=False))
    op.drop_constraint("ck_bank_transactions_dismissed", "bank_transactions", type_="check")
    op.drop_constraint("uq_bank_transactions_identity", "bank_transactions", type_="unique")
    op.add_column("bank_transactions", sa.Column("external_transaction_id", sa.Text(), nullable=False))
    op.add_column("bank_transactions", sa.Column("merchant_name", sa.Text(), nullable=True))
    op.add_column("bank_transactions", sa.Column("category_hint", sa.Text(), nullable=True))
    op.add_column("bank_transactions", sa.Column("extras", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.drop_column("bank_transactions", "external_transaction_hash")
    op.create_unique_constraint(
        "uq_bank_transactions_identity",
        "bank_transactions",
        ["account_id", "provider", "external_account_id", "external_transaction_id"],
    )
    op.create_check_constraint("ck_bank_transactions_dismissed", "bank_transactions", _dismissed_check(_OBSERVATION_BEFORE))
