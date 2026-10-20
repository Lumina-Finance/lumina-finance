"""keep a one-way hash of each OFX transaction's bank account and bank ID instead of the numbers

Revision ID: 7c2e9a4d1f58
Revises: f3a9c1d7b265
Create Date: 2026-10-19 22:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.bank_transaction_key import key_fingerprint, resolve_key
from app.db.rls import grant_global_read_table

revision: str = "7c2e9a4d1f58"
down_revision: str | Sequence[str] | None = "f3a9c1d7b265"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Characters of a SHA-256 digest in lower-case hex
_HASH_LENGTH = 64

# Characters the raw bank account key and bank ID columns took
_RAW_LENGTH = 255

# The single-row record of which key the hashes are made with
_FINGERPRINT_TABLE = "bank_transaction_key_fingerprint"

# Bytes in one SHA-256 block, which HMAC pads its key to
_SHA256_BLOCK_BYTES = 64

# What the server keeps for a transaction: HMAC-SHA256 under its secret key of the SHA-256 digest
# over the bank account key's UTF-8 bytes, a zero byte and the bank ID's UTF-8 bytes, which the
# server takes from what the import page sends. Postgres has SHA-256 but no HMAC without an
# extension, so HMAC is built from its definition, SHA-256(outer key || SHA-256(inner key ||
# message)), with both padded keys made in Python and sent as parameters rather than written into
# the statement. It must match the server byte for byte, or a statement imported again would bring
# back every transaction saved before it
_HASH_SAVED_BANK_IDS = r"""
    UPDATE transactions
    SET bank_transaction_hash = encode(
        sha256(:outer_key || sha256(:inner_key || sha256(
            convert_to(bank_account_key, 'UTF8') || '\x00'::bytea || convert_to(bank_transaction_id, 'UTF8')
        ))),
        'hex'
    )
    WHERE bank_transaction_id IS NOT NULL
"""

# A staged row of an unsaved CSV run was written by the previous version with both fields set to
# null, and rows now refuse fields they do not take, so its commit would fail without this
_FORGET_STAGED_BANK_FIELDS = """
    UPDATE import_staged_rows
    SET payload = payload - 'bank_account_key' - 'bank_transaction_id'
    WHERE payload ?| ARRAY['bank_account_key', 'bank_transaction_id']
"""


def _hmac_keys(key: bytes) -> tuple[bytes, bytes]:
    """Return the server key padded to a block and masked for HMAC's inner and outer hash"""
    padded = key.ljust(_SHA256_BLOCK_BYTES, b"\x00")
    return bytes(byte ^ 0x36 for byte in padded), bytes(byte ^ 0x5C for byte in padded)


def _record_key_fingerprint(key: bytes) -> None:
    """Create the record of the key the hashes are made with, holding this key's fingerprint

    Recorded here, with the hashes, so the app refuses to start under any other key from now on
    """
    op.create_table(
        _FINGERPRINT_TABLE,
        # Not a sequence: the row is the fixed singleton id, as on the encryption key's record
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("fingerprint", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_bank_transaction_key_fingerprint_singleton"),
        sa.PrimaryKeyConstraint("id"),
    )

    # Added after the row-level security bootstrap, so the app role, which checks it at every
    # start, is granted its read here
    grant_global_read_table(op.get_bind(), _FINGERPRINT_TABLE)
    op.execute(
        sa.text(f"INSERT INTO {_FINGERPRINT_TABLE} (id, fingerprint) VALUES (1, :fingerprint)").bindparams(  # noqa: S608
            fingerprint=key_fingerprint(key)
        )
    )


def upgrade() -> None:
    """Replace each transaction's bank account key and bank ID with their hash, and drop unsaved OFX runs

    Every transaction an OFX import saved gets the keyed hash the server now keeps for it, so a
    statement imported again still skips what is already in the account. That needs the server's
    bank transaction hash key, which this refuses to run without. The account and card numbers and
    the bank IDs are then dropped and cannot be recovered

    An OFX run not yet saved is deleted with its staged rows, which hold the same numbers. Nothing of
    it is in the ledger, and the page reloaded for this version cannot resume it, so its user imports
    the files again
    """
    key = resolve_key(generate=False)
    _record_key_fingerprint(key)
    inner_key, outer_key = _hmac_keys(key)
    op.add_column("transactions", sa.Column("bank_transaction_hash", sa.VARCHAR(length=_HASH_LENGTH), nullable=True))
    op.execute(
        sa.text(_HASH_SAVED_BANK_IDS).bindparams(
            sa.bindparam("inner_key", inner_key, type_=sa.LargeBinary),
            sa.bindparam("outer_key", outer_key, type_=sa.LargeBinary),
        )
    )
    op.execute(sa.text("DELETE FROM import_runs WHERE source = 'ofx' AND committed_at IS NULL"))
    op.execute(sa.text(_FORGET_STAGED_BANK_FIELDS))

    op.drop_index("uq_transactions_account_bank_transaction", table_name="transactions")
    op.drop_constraint("ck_transactions_bank_account_key_matches_bank_transaction_id", "transactions", type_="check")
    op.drop_column("transactions", "bank_transaction_id")
    op.drop_column("transactions", "bank_account_key")
    op.create_index(
        "uq_transactions_account_bank_transaction",
        "transactions",
        ["account_id", "bank_transaction_hash"],
        unique=True,
        postgresql_where=sa.text("bank_transaction_hash IS NOT NULL"),
    )


def downgrade() -> None:
    """Bring back the bank account key and bank ID columns empty, and drop the hashes

    Irreversible for the data: a hash cannot be turned back into the numbers, so every transaction
    comes back without a bank ID, and an import after this brings in again every transaction an
    earlier OFX import wrote. The OFX runs deleted on upgrade stay deleted
    """
    op.drop_index("uq_transactions_account_bank_transaction", table_name="transactions")
    op.add_column("transactions", sa.Column("bank_account_key", sa.VARCHAR(length=_RAW_LENGTH), nullable=True))
    op.add_column("transactions", sa.Column("bank_transaction_id", sa.VARCHAR(length=_RAW_LENGTH), nullable=True))
    op.drop_column("transactions", "bank_transaction_hash")
    op.drop_table(_FINGERPRINT_TABLE)
    op.create_check_constraint(
        "ck_transactions_bank_account_key_matches_bank_transaction_id",
        "transactions",
        "(bank_account_key IS NULL) = (bank_transaction_id IS NULL)",
    )
    op.create_index(
        "uq_transactions_account_bank_transaction",
        "transactions",
        ["account_id", "bank_account_key", "bank_transaction_id"],
        unique=True,
        postgresql_where=sa.text("bank_transaction_id IS NOT NULL"),
    )
