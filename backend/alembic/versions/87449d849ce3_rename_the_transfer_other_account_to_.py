"""rename the transfer other account to counterparty account

Revision ID: 87449d849ce3
Revises: 316916eab402
Create Date: 2026-08-02 20:23:30.511080
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "87449d849ce3"
down_revision: str | Sequence[str] | None = "316916eab402"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The scope column's type under its old name, which is what that column is typed with until the
# type itself is renamed at the end of the upgrade
OTHER_ACCOUNT_SCOPE_TYPE = postgresql.ENUM("TRACKED", "OUTSIDE", name="transferotheraccountscope", create_type=False)


def upgrade() -> None:
    """Rename the transfer's other account columns and every object named after them"""

    # Autogenerate reads a rename as one column dropped and another added, which would throw away
    # every counterparty already recorded, so both are renamed in place
    op.alter_column(
        "transactions",
        "other_account_id",
        new_column_name="counterparty_account_id",
        existing_type=sa.Uuid(),
        existing_nullable=True,
    )
    op.alter_column(
        "transactions",
        "other_account_scope",
        new_column_name="counterparty_account_scope",
        existing_type=OTHER_ACCOUNT_SCOPE_TYPE,
        existing_nullable=True,
    )

    # Renaming a column renames nothing else, while the model derives the index name from the
    # column and the enum type name from the Python class, so both would read as changed on the
    # next autogenerate unless they move too. Alembic has no operation for either rename, nor for
    # a constraint. The check constraint's own expression follows the columns without being touched
    op.execute("ALTER INDEX ix_transactions_other_account_id RENAME TO ix_transactions_counterparty_account_id")
    op.execute(
        "ALTER TABLE transactions RENAME CONSTRAINT fk_transactions_other_account_id_accounts "
        "TO fk_transactions_counterparty_account_id_accounts",
    )
    op.execute(
        "ALTER TABLE transactions RENAME CONSTRAINT ck_transactions_other_account_scope_matches_id "
        "TO ck_transactions_counterparty_account_scope_matches_id",
    )
    op.execute("ALTER TYPE transferotheraccountscope RENAME TO transfercounterpartyscope")


def downgrade() -> None:
    """Restore the other account naming, in the reverse order the upgrade applied it"""
    op.execute("ALTER TYPE transfercounterpartyscope RENAME TO transferotheraccountscope")
    op.execute(
        "ALTER TABLE transactions RENAME CONSTRAINT ck_transactions_counterparty_account_scope_matches_id "
        "TO ck_transactions_other_account_scope_matches_id",
    )
    op.execute(
        "ALTER TABLE transactions RENAME CONSTRAINT fk_transactions_counterparty_account_id_accounts "
        "TO fk_transactions_other_account_id_accounts",
    )
    op.execute("ALTER INDEX ix_transactions_counterparty_account_id RENAME TO ix_transactions_other_account_id")
    op.alter_column(
        "transactions",
        "counterparty_account_scope",
        new_column_name="other_account_scope",
        existing_type=OTHER_ACCOUNT_SCOPE_TYPE,
        existing_nullable=True,
    )
    op.alter_column(
        "transactions",
        "counterparty_account_id",
        new_column_name="other_account_id",
        existing_type=sa.Uuid(),
        existing_nullable=True,
    )
