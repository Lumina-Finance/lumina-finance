"""forget the account numbers saved OFX import runs name their statements by

Revision ID: 9e1b5c3a7d24
Revises: 7c2e9a4d1f58
Create Date: 2026-10-19 23:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "9e1b5c3a7d24"
down_revision: str | Sequence[str] | None = "7c2e9a4d1f58"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# A saved OFX run named each statement's account answer by its bank, account or card number, in its
# answers and in the summary a repeated save is answered with. Nothing reads a saved run's answers,
# so they are emptied. The summary's names become statement-1, statement-2 and so on, numbered in
# the order Postgres keeps the object's keys rather than the order of the file's statements. Each
# keeps the account it went to, which is all the page reads of them
_FORGET_SAVED_RUN_ACCOUNT_NUMBERS = """
    UPDATE import_runs r
    SET account_mappings = '{}'::jsonb,
        summary = jsonb_set(
            r.summary,
            '{account_source_ids}',
            COALESCE(
                (
                    SELECT jsonb_object_agg('statement-' || e.position, e.account_id)
                    FROM jsonb_each(r.summary -> 'account_source_ids') WITH ORDINALITY AS e(source, account_id, position)
                ),
                '{}'::jsonb
            )
        )
    WHERE r.source = 'ofx' AND r.committed_at IS NOT NULL AND r.summary ? 'account_source_ids'
"""


def upgrade() -> None:
    """Empty each saved OFX run's account answers and rename its summary's statements by position

    Undoing the import and answering a repeated save still work, since neither reads the answers and
    the summary keeps every account the run wrote to. The account numbers cannot be recovered
    """
    op.execute(sa.text(_FORGET_SAVED_RUN_ACCOUNT_NUMBERS))


def downgrade() -> None:
    """Leave the runs as they are

    The account numbers are gone for good, and nothing before this revision reads them back, so
    there is nothing to restore
    """
