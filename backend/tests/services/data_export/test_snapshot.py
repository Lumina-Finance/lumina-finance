"""The export's own transaction is repeatable read and read only, and carries the signed-in user for row-level security"""

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from app.models.user import User
from app.services.data_export.archive import start_data_export
from tests.routes.support.identity_helpers import _act_as, _seed_users


async def test_export_transaction_is_repeatable_read_read_only_and_stamped_with_the_user():
    """The transaction that replaces authentication's is repeatable read, rejects writes and is stamped with the user."""
    [user] = await _seed_users("snapshot@example.com")

    async with _act_as(user.id) as session:
        # What authentication does first. It opens the transaction the export has to replace
        await session.scalar(select(func.count()).select_from(User))
        await start_data_export(session, user)

        settings = (
            await session.execute(
                text(
                    "SELECT current_setting('transaction_isolation'), current_setting('transaction_read_only'), "
                    "current_setting('app.current_user_id')"
                )
            )
        ).one()
        visible_users = await session.scalar(select(func.count()).select_from(User))

        assert tuple(settings) == ("repeatable read", "on", str(user.id)), "the export's own transaction"
        assert visible_users == 1, "row-level security still limits the snapshot to the user"
        with pytest.raises(DBAPIError, match="read-only transaction"):
            await session.execute(text("UPDATE users SET first_name = 'Changed'"))
