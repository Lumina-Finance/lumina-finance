"""add the unknown system merchant

Revision ID: 9563defdb8fd
Revises: 93e7aa96d2ae
Create Date: 2026-08-05 00:29:53.917450
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "9563defdb8fd"
down_revision: str | Sequence[str] | None = "93e7aa96d2ae"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SYSTEM_MERCHANT_NAME = "Unknown"


def upgrade() -> None:
    """Add the merchant an import stamps on a row stating no payee, folding everyone's own into it"""
    # Seeded here rather than left to the seed script, because the fold below needs it to exist and
    # migrations run before seeding. Left alone where it is already there, since the seed script can
    # have been run by hand against a database this has not reached yet
    op.execute(
        sa.text(
            "INSERT INTO merchants (id, owner_id, group_id, name, is_system) "
            "VALUES (gen_random_uuid(), NULL, NULL, :name, true) "
            "ON CONFLICT DO NOTHING",
        ).bindparams(name=_SYSTEM_MERCHANT_NAME),
    )

    # A user who already had their own Unknown keeps their transactions, now pointing at the shared
    # one, since the name is taken in every scope once it ships with the app. Matched without regard
    # to capitalisation, the same rule the merchants route applies.
    #
    # A group's own merchant is left alone, unlike the fold that added Myself, because whether an
    # app-wide name should take a group's merchant from it is undecided. Sparing it leaves a group
    # member seeing two entries reading the same, which is recoverable, where folding it would move
    # the group's transactions onto a merchant the whole app shares and could not be undone
    op.execute(
        sa.text(
            "UPDATE transactions SET merchant_id = ("
            "  SELECT id FROM merchants WHERE is_system = true AND name = :name"
            ") WHERE merchant_id IN ("
            "  SELECT id FROM merchants"
            "  WHERE is_system = false AND group_id IS NULL AND lower(name) = lower(:name)"
            ")",
        ).bindparams(name=_SYSTEM_MERCHANT_NAME),
    )

    # Any default category they had set on it goes with the row, since a shared merchant cannot
    # carry one person's default
    op.execute(
        sa.text(
            "DELETE FROM merchants"
            " WHERE is_system = false AND group_id IS NULL AND lower(name) = lower(:name)",
        ).bindparams(name=_SYSTEM_MERCHANT_NAME),
    )


def downgrade() -> None:
    """Remove it, detaching the transactions that were folded onto it

    The merchants those users had before are gone, so their transactions cannot be handed back and
    are left without a merchant rather than blocking the downgrade on the foreign key. That covers
    imported rows this merchant was stamped on as well, which belonged to nobody's own merchant to
    begin with, so downgrading and upgrading again leaves both sets holding no merchant at all
    """
    op.execute(
        sa.text(
            "UPDATE transactions SET merchant_id = NULL WHERE merchant_id IN ("
            "  SELECT id FROM merchants WHERE is_system = true AND name = :name"
            ")",
        ).bindparams(name=_SYSTEM_MERCHANT_NAME),
    )
    op.execute(
        sa.text(
            "DELETE FROM merchants WHERE is_system = true AND name = :name",
        ).bindparams(name=_SYSTEM_MERCHANT_NAME),
    )
