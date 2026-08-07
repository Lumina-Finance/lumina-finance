"""fold names differing only in capitals and compare them that way

Revision ID: 60ed789e8b06
Revises: 6a1f132b9da2
Create Date: 2026-08-06 21:59:34.437974
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "60ed789e8b06"
down_revision: str | Sequence[str] | None = "6a1f132b9da2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The one transfer-kind category recording no counterparty account, mirroring
# app/services/categories/transfer_rules.py. Written out here rather than imported, so this keeps
# doing what it did on the day it ran however the application code moves on
_BALANCE_ADJUSTMENT_CATEGORY_NAME = "Balance Adjustment"

# The scope a name has to be unique within, which is the same three the check constraints describe:
# one that ships with the app, one a user owns, one a group owns. Grouping on all three columns at
# once covers the three cases in one pass, since the unused two are null in each
_NAME_SCOPE = "is_system, owner_id, group_id"


def upgrade() -> None:
    """Make the name a record is found under ignore capitals and surrounding spaces

    The indexes come off first, because trimming a name can produce the pair the old byte-exact
    index forbids, and folding is what makes the new ones buildable at all
    """
    _drop_byte_exact_indexes()

    # A name is stored trimmed from here on, so the routes and the indexes compare what is stored
    # rather than each trimming for themselves
    op.execute(sa.text("UPDATE categories SET name = btrim(name) WHERE name <> btrim(name)"))
    op.execute(sa.text("UPDATE merchants SET name = btrim(name) WHERE name <> btrim(name)"))

    _fold_categories()
    _rename_categories_colliding_across_kinds()
    _fold_merchants()
    _create_folded_indexes()


def downgrade() -> None:
    """Put the byte-exact indexes back

    What was folded stays folded. The rows are gone and their transactions have moved, so there is
    nothing to hand back, and a database that goes down and up again is left exactly as this run
    leaves it
    """
    _drop_folded_indexes()
    _create_byte_exact_indexes()


def _fold_categories() -> None:
    """Merge categories differing only in capitals into the oldest of each set

    Only categories of one kind are merged with each other, so nothing a user recorded as income
    starts counting as an expense. What is left colliding across kinds is renamed instead
    """
    # The oldest of each set is the one kept, so a run against a copy of the database reaches the
    # same result as the run against the database itself
    op.execute(
        sa.text(
            "CREATE TEMP TABLE folded_categories ON COMMIT DROP AS "
            "SELECT id AS loser_id, survivor_id, survivor_records_counterparty FROM ("
            "  SELECT"
            "    id,"
            "    first_value(id) OVER same_category AS survivor_id,"
            "    first_value(kind::text <> 'TRANSFER' OR name <> :balance_adjustment)"
            "      OVER same_category AS survivor_records_counterparty"
            "  FROM categories"
            f"  WINDOW same_category AS (PARTITION BY {_NAME_SCOPE}, kind, lower(name)"
            "    ORDER BY created_at, id)"
            ") ranked WHERE id <> survivor_id",
        ).bindparams(balance_adjustment=_BALANCE_ADJUSTMENT_CATEGORY_NAME),
    )

    # A budget tracking both categories would end up tracking the survivor twice, which the index on
    # the active rows forbids, so the loser's row goes rather than moving
    op.execute(
        sa.text(
            "DELETE FROM budget_tracked_categories AS loser_row"
            " USING folded_categories f"
            " WHERE loser_row.category_id = f.loser_id"
            "   AND loser_row.removed_at IS NULL"
            "   AND EXISTS ("
            "     SELECT 1 FROM budget_tracked_categories AS survivor_row"
            "     WHERE survivor_row.base_budget_id = loser_row.base_budget_id"
            "       AND survivor_row.category_id = f.survivor_id"
            "       AND survivor_row.removed_at IS NULL"
            "   )",
        ),
    )

    # Moving onto Balance Adjustment drops the account the movement recorded, since that category
    # corrects a stale balance rather than moving money anywhere, which is what editing one
    # transaction onto it does by hand
    op.execute(
        sa.text(
            "UPDATE transactions t SET"
            "   category_id = f.survivor_id,"
            "   counterparty_account_id ="
            "     CASE WHEN f.survivor_records_counterparty THEN t.counterparty_account_id END,"
            "   counterparty_account_scope ="
            "     CASE WHEN f.survivor_records_counterparty THEN t.counterparty_account_scope END"
            " FROM folded_categories f WHERE t.category_id = f.loser_id",
        ),
    )

    op.execute(
        sa.text(
            "UPDATE merchants m SET default_category_id = f.survivor_id"
            " FROM folded_categories f WHERE m.default_category_id = f.loser_id",
        ),
    )
    op.execute(
        sa.text(
            "UPDATE budget_tracked_categories b SET category_id = f.survivor_id"
            " FROM folded_categories f WHERE b.category_id = f.loser_id",
        ),
    )
    op.execute(sa.text("DELETE FROM categories c USING folded_categories f WHERE c.id = f.loser_id"))


def _rename_categories_colliding_across_kinds() -> None:
    """Number the categories that collide by name but record opposite directions

    Merging these would silently reclassify money, so an expense Bonus beside an income Bonus keeps
    both and the later one becomes Bonus (2). The number counts up until it is free, so a scope
    already holding a Bonus (2) does not block the rename
    """
    op.execute(
        sa.text(
            "DO $$"
            " DECLARE loser RECORD; candidate TEXT; suffix INT;"
            " BEGIN"
            "   FOR loser IN"
            "     SELECT id, name, is_system, owner_id, group_id FROM ("
            "       SELECT id, name, is_system, owner_id, group_id, created_at,"
            f"         first_value(id) OVER (PARTITION BY {_NAME_SCOPE}, lower(name)"
            "            ORDER BY created_at, id) AS survivor_id"
            "       FROM categories"
            "     ) ranked WHERE id <> survivor_id ORDER BY created_at, id"
            "   LOOP"
            "     suffix := 2;"
            "     LOOP"
            "       candidate := loser.name || ' (' || suffix || ')';"
            "       EXIT WHEN NOT EXISTS ("
            "         SELECT 1 FROM categories other"
            "         WHERE other.id <> loser.id"
            "           AND other.is_system IS NOT DISTINCT FROM loser.is_system"
            "           AND other.owner_id IS NOT DISTINCT FROM loser.owner_id"
            "           AND other.group_id IS NOT DISTINCT FROM loser.group_id"
            "           AND lower(other.name) = lower(candidate)"
            "       );"
            "       suffix := suffix + 1;"
            "     END LOOP;"
            "     UPDATE categories SET name = candidate WHERE id = loser.id;"
            "   END LOOP;"
            " END $$",
        ),
    )


def _fold_merchants() -> None:
    """Merge merchants differing only in capitals into the oldest of each set

    A merchant records no direction, so every collision folds and none is renamed. Transactions are
    the only thing pointing at a merchant, so they are the only thing to move
    """
    op.execute(
        sa.text(
            "CREATE TEMP TABLE folded_merchants ON COMMIT DROP AS "
            "SELECT id AS loser_id, survivor_id FROM ("
            "  SELECT id, first_value(id) OVER same_merchant AS survivor_id"
            "  FROM merchants"
            f"  WINDOW same_merchant AS (PARTITION BY {_NAME_SCOPE}, lower(name)"
            "    ORDER BY created_at, id)"
            ") ranked WHERE id <> survivor_id",
        ),
    )

    op.execute(
        sa.text(
            "UPDATE transactions t SET merchant_id = f.survivor_id"
            " FROM folded_merchants f WHERE t.merchant_id = f.loser_id",
        ),
    )
    op.execute(sa.text("DELETE FROM merchants m USING folded_merchants f WHERE m.id = f.loser_id"))


def _drop_byte_exact_indexes() -> None:
    """Remove the indexes built on the name as stored"""
    op.drop_index("uq_category_group_name", table_name="categories", postgresql_where=sa.text("group_id IS NOT NULL"))
    op.drop_index(
        "uq_category_owner_name",
        table_name="categories",
        postgresql_where=sa.text("owner_id IS NOT NULL AND group_id IS NULL"),
    )
    op.drop_index("uq_category_system_name", table_name="categories", postgresql_where=sa.text("is_system = true"))

    # A unique constraint rather than an index, and it comes back as an index, since a constraint
    # cannot be written against an expression
    op.drop_constraint("uq_merchant_group_name", "merchants", type_="unique")
    op.drop_index("uq_merchant_owner_name", table_name="merchants", postgresql_where=sa.text("group_id IS NULL"))
    op.drop_index("uq_merchant_system_name", table_name="merchants", postgresql_where=sa.text("is_system = true"))


def _create_folded_indexes() -> None:
    """Build the indexes on the name with its capitals folded"""
    op.create_index(
        "uq_category_group_name",
        "categories",
        ["group_id", sa.literal_column("lower(name)")],
        unique=True,
        postgresql_where=sa.text("group_id IS NOT NULL"),
    )
    op.create_index(
        "uq_category_owner_name",
        "categories",
        ["owner_id", sa.literal_column("lower(name)")],
        unique=True,
        postgresql_where=sa.text("owner_id IS NOT NULL AND group_id IS NULL"),
    )
    op.create_index(
        "uq_category_system_name",
        "categories",
        [sa.literal_column("lower(name)")],
        unique=True,
        postgresql_where=sa.text("is_system = true"),
    )
    op.create_index(
        "uq_merchant_group_name",
        "merchants",
        ["group_id", sa.literal_column("lower(name)")],
        unique=True,
        postgresql_where=sa.text("group_id IS NOT NULL"),
    )
    op.create_index(
        "uq_merchant_owner_name",
        "merchants",
        ["owner_id", sa.literal_column("lower(name)")],
        unique=True,
        postgresql_where=sa.text("group_id IS NULL"),
    )
    op.create_index(
        "uq_merchant_system_name",
        "merchants",
        [sa.literal_column("lower(name)")],
        unique=True,
        postgresql_where=sa.text("is_system = true"),
    )


def _drop_folded_indexes() -> None:
    """Remove the indexes built on the name with its capitals folded"""
    op.drop_index("uq_category_group_name", table_name="categories", postgresql_where=sa.text("group_id IS NOT NULL"))
    op.drop_index(
        "uq_category_owner_name",
        table_name="categories",
        postgresql_where=sa.text("owner_id IS NOT NULL AND group_id IS NULL"),
    )
    op.drop_index("uq_category_system_name", table_name="categories", postgresql_where=sa.text("is_system = true"))
    op.drop_index("uq_merchant_group_name", table_name="merchants", postgresql_where=sa.text("group_id IS NOT NULL"))
    op.drop_index("uq_merchant_owner_name", table_name="merchants", postgresql_where=sa.text("group_id IS NULL"))
    op.drop_index("uq_merchant_system_name", table_name="merchants", postgresql_where=sa.text("is_system = true"))


def _create_byte_exact_indexes() -> None:
    """Build the indexes on the name as stored"""
    op.create_index(
        "uq_category_group_name",
        "categories",
        ["group_id", "name"],
        unique=True,
        postgresql_where=sa.text("group_id IS NOT NULL"),
    )
    op.create_index(
        "uq_category_owner_name",
        "categories",
        ["owner_id", "name"],
        unique=True,
        postgresql_where=sa.text("owner_id IS NOT NULL AND group_id IS NULL"),
    )
    op.create_index(
        "uq_category_system_name",
        "categories",
        ["name"],
        unique=True,
        postgresql_where=sa.text("is_system = true"),
    )
    op.create_index(
        "uq_merchant_owner_name",
        "merchants",
        ["owner_id", "name"],
        unique=True,
        postgresql_where=sa.text("group_id IS NULL"),
    )
    op.create_index(
        "uq_merchant_system_name",
        "merchants",
        ["name"],
        unique=True,
        postgresql_where=sa.text("is_system = true"),
    )
    op.create_unique_constraint("uq_merchant_group_name", "merchants", ["group_id", "name"])
