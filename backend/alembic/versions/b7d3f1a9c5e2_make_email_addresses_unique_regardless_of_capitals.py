"""make email addresses unique regardless of capitals

Revision ID: b7d3f1a9c5e2
Revises: c4d8e2f6a1b3
Create Date: 2026-10-31 03:50:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from alembic.util import CommandError

revision: str = "b7d3f1a9c5e2"
down_revision: str | Sequence[str] | None = "c4d8e2f6a1b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PLAIN_UNIQUE_CONSTRAINT = "users_email_key"
_FOLDED_UNIQUE_INDEX = "uq_users_email_lower"

# Printed in full by the container log when the upgrade refuses, since that is where the person
# running the instance reads it. It names addresses and nothing else about the accounts
_REFUSAL = """Cannot upgrade: these email addresses belong to more than one account, differing only in the capitals of A to Z:
{addresses}

An email address now identifies one account whatever the capitals of its letters A to Z. Nothing was
merged, changed or deleted, because merging accounts could give one person access to another person's
finances.

To continue, stop the app (docker compose stop app), decide with each owner which account stays, and
change the email address of every other one to an address nobody else uses. Then start the app again
and the upgrade runs. The queries to list the accounts and change an address are in the documentation
under "Accounts with the same email in different capitals"."""


def upgrade() -> None:
    """Replace the unique constraint on users.email with a unique index on its A to Z folded form

    Refuses, changing nothing, while two accounts hold the same address in different capitals, naming
    every such group so the instance's owner can resolve them. The app's start-up stops at the
    refusal, and a run after the accounts are resolved succeeds. No row changes

    Only A to Z fold, through the C collation, so the result never depends on the database's locale and
    Python can fold the same way. Addresses differing in other capitals, such as Émile@ and émile@, stay
    separate accounts
    """
    bind = op.get_bind()

    # No sign-up can add a pair between the check and the index, so the check is what the index sees.
    # Reads carry on until the drop below, whose ACCESS EXCLUSIVE lock blocks them too until commit. Every
    # pending migration shares one transaction (alembic/env.py), so a refusal also rolls back the ones
    # before this one, and each refused restart runs them again
    bind.execute(sa.text("LOCK TABLE users IN EXCLUSIVE MODE"))
    groups = bind.execute(
        sa.text('SELECT array_agg(email ORDER BY email COLLATE "C") FROM users GROUP BY lower(email COLLATE "C") HAVING count(*) > 1 ORDER BY min(lower(email COLLATE "C"))')
    ).scalars()
    addresses = "\n".join("  " + ", ".join(group) for group in groups)
    if addresses:
        raise CommandError(_REFUSAL.format(addresses=addresses))

    op.drop_constraint(_PLAIN_UNIQUE_CONSTRAINT, "users", type_="unique")
    op.create_index(_FOLDED_UNIQUE_INDEX, "users", [sa.text('lower(email COLLATE "C")')], unique=True)


def downgrade() -> None:
    """Restore the exact-match unique constraint, which every address the index allowed also satisfies"""
    op.drop_index(_FOLDED_UNIQUE_INDEX, table_name="users")
    op.create_unique_constraint(_PLAIN_UNIQUE_CONSTRAINT, "users", ["email"])
