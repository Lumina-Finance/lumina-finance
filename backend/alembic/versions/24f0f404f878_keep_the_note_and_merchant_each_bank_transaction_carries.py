"""keep the note and merchant each bank transaction carries

Revision ID: 24f0f404f878
Revises: d4b9e1a7c3f6
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "24f0f404f878"
down_revision: str | Sequence[str] | None = "d4b9e1a7c3f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The columns a dismissed record keeps empty, before and after the note and merchant join them
_OBSERVATION_BEFORE = ("observed_date", "observed_amount", "raw_amount", "description", "observed_at")
_OBSERVATION_AFTER = ("observed_date", "observed_amount", "raw_amount", "description", "note", "merchant", "observed_at")

# SimpleFIN, Akahu and Pluggy take their note from their description, so a saved description is
# already the note. Only one holding any text counts, as the adapters read a note, so one of only
# blanks stays no note. The others fill the description with a merchant's name when the bank sends
# no text. A saved name and a saved note look alike, so their records get the note the next time
# the bank sends them
_FILL_NOTES = r"UPDATE bank_transactions SET note = description WHERE provider IN ('simplefin', 'akahu', 'pluggy') AND description ~ '\S'"


def _dismissed_check(columns: Sequence[str]) -> str:
    """Return the condition that a dismissed record keeps only its identity"""
    return "disposition <> 'dismissed' OR (" + " AND ".join(f"{column} IS NULL" for column in columns) + ")"


def upgrade() -> None:
    """Add the note and merchant a bank transaction carries, the note filled where it is the description

    Every SimpleFIN, Akahu and Pluggy record still in play gets its description as its note. No
    saved field held the merchant, so every record starts with none. Each record gets what it lacks
    the next time the bank sends it, so one older than the range a sync reads keeps none. A
    dismissed record keeps neither, as it keeps no description
    """
    op.drop_constraint("ck_bank_transactions_dismissed", "bank_transactions", type_="check")
    op.add_column("bank_transactions", sa.Column("note", sa.Text(), nullable=True))
    op.add_column("bank_transactions", sa.Column("merchant", sa.Text(), nullable=True))
    op.execute(_FILL_NOTES)
    op.create_check_constraint("ck_bank_transactions_dismissed", "bank_transactions", _dismissed_check(_OBSERVATION_AFTER))


def downgrade() -> None:
    """Drop every bank transaction's note and merchant

    Upgrading again fills the SimpleFIN, Akahu and Pluggy notes from their descriptions, and the
    rest come back as the bank sends each record again. A record older than the range a sync
    reads loses its note and merchant for good
    """
    op.drop_constraint("ck_bank_transactions_dismissed", "bank_transactions", type_="check")
    op.drop_column("bank_transactions", "merchant")
    op.drop_column("bank_transactions", "note")
    op.create_check_constraint("ck_bank_transactions_dismissed", "bank_transactions", _dismissed_check(_OBSERVATION_BEFORE))
