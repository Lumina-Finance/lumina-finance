"""add system merchants

Revision ID: 316916eab402
Revises: cbf7ada87de3
Create Date: 2026-07-31 18:30:47.330268
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "316916eab402"
down_revision: str | Sequence[str] | None = "cbf7ada87de3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SYSTEM_MERCHANT_NAME = "Myself"


def upgrade() -> None:
    """Let a merchant ship with the app, and fold everyone's own Myself into the seeded one"""
    op.add_column("merchants", sa.Column("is_system", sa.Boolean(), nullable=False, server_default="false"))

    # A system merchant belongs to nobody, so the owner it has always required becomes optional
    op.alter_column("merchants", "owner_id", existing_type=sa.UUID(), nullable=True)
    op.create_check_constraint(
        "ck_merchants_scope",
        "merchants",
        """
        (
            is_system = true
            AND owner_id IS NULL
            AND group_id IS NULL
        )
        OR (
            is_system = false
            AND owner_id IS NOT NULL
        )
        """,
    )
    op.create_index(
        "uq_merchant_system_name", "merchants", ["name"],
        unique=True, postgresql_where=sa.text("is_system = true"),
    )

    # Seeded here rather than left to the seed script, because the fold below needs it to exist and
    # migrations run before seeding
    op.execute(
        sa.text(
            "INSERT INTO merchants (id, owner_id, group_id, name, is_system) "
            "VALUES (gen_random_uuid(), NULL, NULL, :name, true)",
        ).bindparams(name=_SYSTEM_MERCHANT_NAME),
    )

    # Everyone who typed their own Myself keeps their transactions, now pointing at the shared one.
    # Matched without regard to capitalisation, since "myself" and "MYSELF" are the same intent and
    # would otherwise be left behind unable to be renamed onto the name this reserves
    op.execute(
        sa.text(
            "UPDATE transactions SET merchant_id = ("
            "  SELECT id FROM merchants WHERE is_system = true AND name = :name"
            ") WHERE merchant_id IN ("
            "  SELECT id FROM merchants WHERE is_system = false AND lower(name) = lower(:name)"
            ")",
        ).bindparams(name=_SYSTEM_MERCHANT_NAME),
    )

    # Any default category they had set on it goes with the row, since a shared merchant cannot
    # carry one person's default
    op.execute(
        sa.text(
            "DELETE FROM merchants WHERE is_system = false AND lower(name) = lower(:name)",
        ).bindparams(name=_SYSTEM_MERCHANT_NAME),
    )


def downgrade() -> None:
    """Remove system merchants, detaching the transactions that were folded onto them"""

    # The merchants everyone had before are gone, so the transactions cannot be handed back and are
    # left without a merchant rather than blocking the downgrade on the foreign key
    op.execute(
        sa.text(
            "UPDATE transactions SET merchant_id = NULL WHERE merchant_id IN ("
            "  SELECT id FROM merchants WHERE is_system = true"
            ")",
        ),
    )
    op.execute(sa.text("DELETE FROM merchants WHERE is_system = true"))

    op.drop_index("uq_merchant_system_name", table_name="merchants", postgresql_where=sa.text("is_system = true"))
    op.drop_constraint("ck_merchants_scope", "merchants", type_="check")
    op.alter_column("merchants", "owner_id", existing_type=sa.UUID(), nullable=False)
    op.drop_column("merchants", "is_system")
