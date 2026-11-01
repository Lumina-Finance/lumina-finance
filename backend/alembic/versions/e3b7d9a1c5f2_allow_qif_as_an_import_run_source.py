"""allow QIF as an import run's source

Revision ID: e3b7d9a1c5f2
Revises: b5e1d7a3c902
Create Date: 2026-10-31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e3b7d9a1c5f2"
down_revision: str | Sequence[str] | None = "b5e1d7a3c902"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Both tables name an importer, and an account remembers the source of the run that last wrote to it
_SOURCE_CHECKS = (
    ("import_runs", "ck_import_runs_source"),
    ("account_import_sources", "ck_account_import_sources_source"),
)


def _replace_source_checks(sources: tuple[str, ...]) -> None:
    """Replace the check on each table that names an importer with one naming exactly these sources"""
    values = ", ".join(f"'{source}'" for source in sources)
    for table, constraint in _SOURCE_CHECKS:
        op.drop_constraint(constraint, table, type_="check")
        op.create_check_constraint(constraint, table, f"source IN ({values})")


def upgrade() -> None:
    """Let a run, and the source an account remembers, name QIF as the importer

    Widens the checks only, so every run and remembered source already saved keeps the source it has
    """
    _replace_source_checks(("generic", "firefly", "actual_budget", "ofx", "qif"))


def downgrade() -> None:
    """Narrow the checks again, deleting every QIF run and remembered QIF source first

    The constraints would refuse those rows, and re-labelling them as CSV would make a committed QIF
    import read as a CSV one on the last import card. A committed run holds only its summary and the
    transactions it wrote live on in the ledger, so deleting the runs loses no transaction, only the
    chance to undo that import. An account that remembered QIF opens its import page on CSV again, and
    an import that replaced a remembered QIF source no longer puts one back when it is undone
    """
    op.execute(sa.text("DELETE FROM import_runs WHERE source = 'qif'"))
    op.execute(sa.text("DELETE FROM account_import_sources WHERE source = 'qif'"))
    op.execute(
        sa.text(
            "UPDATE import_runs SET replaced_account_sources = ("
            " SELECT jsonb_object_agg(key, CASE WHEN value = CAST('\"qif\"' AS jsonb) THEN CAST('null' AS jsonb) ELSE value END)"
            " FROM jsonb_each(replaced_account_sources))"
            " WHERE replaced_account_sources::text LIKE '%\"qif\"%'"
        )
    )
    _replace_source_checks(("generic", "firefly", "actual_budget", "ofx"))
