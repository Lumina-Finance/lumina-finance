"""fold tag names differing only in capitals and compare them that way

Revision ID: 5b9e2d7a4c16
Revises: e3b7d9a1c5f2
Create Date: 2026-10-31 14:20:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "5b9e2d7a4c16"
down_revision: str | Sequence[str] | None = "e3b7d9a1c5f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The scope a tag name has to be unique within: a group's tags by group, whoever owns them, and any
# other tag by its owner. A group's tag carries an owner as well as its group, so grouping on the
# columns the way categories are grouped would put two members' tags of one group in separate sets
# and leave the pair the group index forbids. Written as the key each of the two indexes is built on
_TAG_NAME_SCOPE = """
    CASE
        WHEN group_id IS NOT NULL THEN 'group:' || group_id::text
        ELSE 'owner:' || owner_id::text
    END
"""


def upgrade() -> None:
    """Make the name a tag is found under ignore capitals

    The indexes come off first, because folding is what makes the new ones buildable at all. Names
    are not trimmed, since the tag routes have always stored a name as typed and the indexes compare
    it that way
    """
    _drop_byte_exact_indexes()
    _fold_tags()
    _create_folded_indexes()


def downgrade() -> None:
    """Put the byte-exact indexes back

    What was folded stays folded. The rows are gone and their transactions have moved, so there is
    nothing to hand back, and a database that goes down and up again is left exactly as this run
    leaves it
    """
    _drop_folded_indexes()
    _create_byte_exact_indexes()


def _fold_tags() -> None:
    """Merge tags differing only in capitals into the oldest of each set

    Every transaction that carried a tag of a set carries the survivor afterwards, once. A
    transaction that carried two spellings ends up with one link rather than a pair the table's
    primary key forbids, so no transaction loses a tag. Transactions are the only thing pointing at
    a tag, so they are the only thing to move
    """
    # The oldest of each set is the one kept, so a run against a copy of the database reaches the
    # same result as the run against the database itself
    op.execute(
        sa.text(
            "CREATE TEMP TABLE folded_tags ON COMMIT DROP AS "
            "SELECT id AS loser_id, survivor_id FROM ("
            "  SELECT id, first_value(id) OVER same_tag AS survivor_id"
            "  FROM tags"
            f"  WINDOW same_tag AS (PARTITION BY {_TAG_NAME_SCOPE}, lower(name)"
            "    ORDER BY created_at, id)"
            ") ranked WHERE id <> survivor_id",
        ),
    )

    # Links are written for the survivor before any loser's goes, and the conflict clause skips the
    # link a transaction already has, whether to the survivor itself or to another loser of the same
    # set that was written first. Moving the rows with an update instead would fail on both
    op.execute(
        sa.text(
            "INSERT INTO transaction_tags (transaction_id, tag_id)"
            " SELECT DISTINCT t.transaction_id, f.survivor_id"
            " FROM transaction_tags t JOIN folded_tags f ON f.loser_id = t.tag_id"
            " ON CONFLICT (transaction_id, tag_id) DO NOTHING",
        ),
    )
    op.execute(
        sa.text(
            "DELETE FROM transaction_tags t USING folded_tags f WHERE t.tag_id = f.loser_id",
        ),
    )
    op.execute(sa.text("DELETE FROM tags g USING folded_tags f WHERE g.id = f.loser_id"))


def _drop_byte_exact_indexes() -> None:
    """Remove the indexes built on the name as stored"""
    op.drop_index("uq_tag_owner_name", table_name="tags", postgresql_where=sa.text("group_id IS NULL"))

    # A unique constraint rather than an index, and it comes back as an index, since a constraint
    # cannot be written against an expression
    op.drop_constraint("uq_tag_group_name", "tags", type_="unique")


def _create_folded_indexes() -> None:
    """Build the indexes on the name with its capitals folded"""
    op.create_index(
        "uq_tag_owner_name",
        "tags",
        ["owner_id", sa.literal_column("lower(name)")],
        unique=True,
        postgresql_where=sa.text("group_id IS NULL"),
    )
    op.create_index(
        "uq_tag_group_name",
        "tags",
        ["group_id", sa.literal_column("lower(name)")],
        unique=True,
        postgresql_where=sa.text("group_id IS NOT NULL"),
    )


def _drop_folded_indexes() -> None:
    """Remove the indexes built on the name with its capitals folded"""
    op.drop_index("uq_tag_owner_name", table_name="tags", postgresql_where=sa.text("group_id IS NULL"))
    op.drop_index("uq_tag_group_name", table_name="tags", postgresql_where=sa.text("group_id IS NOT NULL"))


def _create_byte_exact_indexes() -> None:
    """Build the indexes on the name as stored"""
    op.create_index(
        "uq_tag_owner_name",
        "tags",
        ["owner_id", "name"],
        unique=True,
        postgresql_where=sa.text("group_id IS NULL"),
    )
    op.create_unique_constraint("uq_tag_group_name", "tags", ["group_id", "name"])
