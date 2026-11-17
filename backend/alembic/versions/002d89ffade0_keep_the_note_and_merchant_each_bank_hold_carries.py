"""keep the note and merchant each bank hold carries

Revision ID: 002d89ffade0
Revises: 1ab249c82417
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "002d89ffade0"
down_revision: str | Sequence[str] | None = "1ab249c82417"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# SimpleFIN, Akahu and Pluggy take their note from their description, so a saved description is
# already the note, as it was for bank transactions. Only one holding any text counts, as the adapters
# read a note, so one of only blanks stays no note. The others fill the description with a merchant's
# name when the bank sends no text, so their holds get the note the next time the bank sends them
_FILL_NOTES = r"UPDATE bank_holds SET note = description WHERE provider IN ('simplefin', 'akahu', 'pluggy') AND description ~ '\S'"


def upgrade() -> None:
    """Add the note and merchant a bank hold carries, the note filled where it is the description

    No saved field held the merchant, so every hold starts with none and gets it the next time the
    bank sends it. Every hold stays
    """
    op.add_column("bank_holds", sa.Column("note", sa.Text(), nullable=True))
    op.add_column("bank_holds", sa.Column("merchant", sa.Text(), nullable=True))
    op.execute(_FILL_NOTES)


def downgrade() -> None:
    """Drop every bank hold's note and merchant

    Every hold stays. Upgrading again fills the SimpleFIN, Akahu and Pluggy notes from their
    descriptions, and the rest come back as the bank sends each hold again
    """
    op.drop_column("bank_holds", "merchant")
    op.drop_column("bank_holds", "note")
