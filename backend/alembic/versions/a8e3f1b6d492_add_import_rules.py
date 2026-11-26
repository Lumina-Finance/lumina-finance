"""add import rules

Revision ID: a8e3f1b6d492
Revises: c7a3e5d91b24
Create Date: 2026-11-21 23:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op
from app.db.downgrade_guard import refuse_while_tables_hold_rows
from app.db.rls import secure_registered_table

revision: str = "a8e3f1b6d492"
down_revision: str | Sequence[str] | None = "c7a3e5d91b24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the import rules and the tags they add, empty, and enable their row-level security

    No existing row changes, so every user starts with no rules
    """
    op.create_table(
        "import_rules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.VARCHAR(length=100), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("match", sa.VARCHAR(length=3), nullable=False),
        sa.Column("conditions", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("merchant_id", sa.Uuid(), nullable=True),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["merchant_id"], ["merchants.id"]),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("match IN ('all', 'any')", name="ck_import_rules_match"),
        sa.CheckConstraint("position >= 0", name="ck_import_rules_position"),
        sa.UniqueConstraint(
            "owner_id",
            "position",
            name="uq_import_rules_owner_position",
            deferrable=True,
            initially="DEFERRED",
        ),
    )
    op.create_index("uq_import_rules_owner_name", "import_rules", ["owner_id", sa.text("lower(name)")], unique=True)
    op.create_index(op.f("ix_import_rules_merchant_id"), "import_rules", ["merchant_id"])
    op.create_index(op.f("ix_import_rules_category_id"), "import_rules", ["category_id"])

    op.create_table(
        "import_rule_tags",
        sa.Column("import_rule_id", sa.Uuid(), nullable=False),
        sa.Column("tag_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["import_rule_id"], ["import_rules.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"]),
        sa.PrimaryKeyConstraint("import_rule_id", "tag_id"),
    )
    op.create_index(op.f("ix_import_rule_tags_tag_id"), "import_rule_tags", ["tag_id"])

    secure_registered_table(op.get_bind(), "import_rules")
    secure_registered_table(op.get_bind(), "import_rule_tags")


def downgrade() -> None:
    """Drop the import rules and their tags, refusing while a rule exists

    Dropping them would delete every rule users wrote, with its conditions and the order it is
    checked in, and nothing can rebuild them. The rollback refuses rather than lose them. A tag
    link only exists beside its rule, so the rules alone are checked
    """
    refuse_while_tables_hold_rows(op.get_bind(), {"import_rules": "the import rules users wrote"})
    op.drop_table("import_rule_tags")
    op.drop_table("import_rules")
