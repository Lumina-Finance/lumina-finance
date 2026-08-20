"""Which cached figures an import marks stale when it touches more than one account

An import writes rows into every account its file names, and walks those accounts marking the scope
that owns each one. Every import test before this one used a single personal account, so the walk
only ever went round once and never reached a group.

The group mark is what this can check. The user's own figures are marked once before the walk starts,
whatever the walk then does, so finding that mark says nothing about the accounts at all.

The marking is called directly rather than through a committed import, because nothing the route
returns says which scopes were marked, and the table holding them is not exposed by any endpoint.
"""

import uuid
from datetime import date

from sqlalchemy import select

from app.models.account import Account
from app.models.base import AccountKind, AccountType
from app.models.cache_state import GroupCacheState
from app.models.currency import Currency
from app.models.group import Group
from app.models.user import User
from app.services.importers.generic.service import _mark_caches_changed_for_imported_accounts
from tests.conftest import TestSession


async def _seed_user(session) -> uuid.UUID:
    """Insert the user the accounts belong to

    Args:
        session: Database session the test runs in

    Returns:
        Identifier of the user
    """
    session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
    user = User(
        email="import-cache@example.com",
        first_name="Cache",
        tz="America/Toronto",
        base_currency="CAD",
    )
    session.add(user)
    await session.flush()
    return user.id


async def test_an_import_reaching_a_group_account_after_a_personal_one_marks_the_group():
    """The walk carries on past the first account, so a group account behind one still refreshes."""
    async with TestSession() as session:
        user_id = await _seed_user(session)
        group = Group(owner_id=user_id, name="Household")
        session.add(group)
        await session.flush()

        personal = Account(
            owner_id=user_id,
            group_id=None,
            account_kind=AccountKind.ASSET,
            account_type=AccountType.CHECKING,
            name="Chequing",
            currency="CAD",
        )
        shared = Account(
            owner_id=None,
            group_id=group.id,
            account_kind=AccountKind.ASSET,
            account_type=AccountType.SAVINGS,
            name="Joint Savings",
            currency="CAD",
        )
        session.add_all([personal, shared])
        await session.flush()

        await _mark_caches_changed_for_imported_accounts(
            session,
            user_id,
            {"Chequing": personal, "Joint Savings": shared},
            {personal.id: date(2026, 4, 10), shared.id: date(2026, 4, 12)},
        )
        await session.flush()

        group_marks = await session.execute(
            select(GroupCacheState).where(GroupCacheState.group_id == group.id),
        )

        assert group_marks.scalar_one_or_none() is not None
