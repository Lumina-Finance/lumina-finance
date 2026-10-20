"""keep a one-way hash of each OFX transaction's bank account and bank ID instead of the numbers

Revision ID: 7c2e9a4d1f58
Revises: f3a9c1d7b265
Create Date: 2026-10-19 22:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "7c2e9a4d1f58"
down_revision: str | Sequence[str] | None = "f3a9c1d7b265"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Characters of a SHA-256 digest in lower-case hex
_HASH_LENGTH = 64

# Characters the raw bank account key and bank ID columns took
_RAW_LENGTH = 255

# The digest the import page builds: SHA-256 over the bank account key's UTF-8 bytes, a zero byte
# and the bank ID's UTF-8 bytes, in lower-case hex. It must match the page byte for byte, or a
# statement imported again after this would bring back every transaction saved before it
_HASH_SAVED_BANK_IDS = r"""
    UPDATE transactions
    SET bank_transaction_hash = encode(
        sha256(convert_to(bank_account_key, 'UTF8') || '\x00'::bytea || convert_to(bank_transaction_id, 'UTF8')),
        'hex'
    )
    WHERE bank_transaction_id IS NOT NULL
"""


def upgrade() -> None:
    """Replace each transaction's bank account key and bank ID with their hash, and drop unsaved OFX runs

    Every transaction an OFX import saved gets the hash the import page now sends for it, so a
    statement imported again still skips what is already in the account. The account and card
    numbers and the bank IDs are then dropped and cannot be recovered

    An OFX run not yet saved is deleted with its staged rows, which hold the same numbers. Nothing of
    it is in the ledger, and the page reloaded for this version cannot resume it, so its user imports
    the files again
    """
    op.add_column("transactions", sa.Column("bank_transaction_hash", sa.VARCHAR(length=_HASH_LENGTH), nullable=True))
    op.execute(sa.text(_HASH_SAVED_BANK_IDS))
    op.execute(sa.text("DELETE FROM import_runs WHERE source = 'ofx' AND committed_at IS NULL"))

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
