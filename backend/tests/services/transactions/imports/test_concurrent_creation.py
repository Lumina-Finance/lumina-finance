"""Import record creation when another request has already written the same name

Two imports running at once for one user both look for a category, merchant or tag they need, both
find nothing, and both go on to write it. These cover what the second one does when it gets there:
the insert skips the row that is already present, and the record is loaded and reused rather than
the whole import failing on the unique index.

The interleaving itself is not reproduced. What a race reaches is the state where the name is taken
by the time the insert runs, and these put the code in exactly that state, which is also what a user
creating the same record in another tab does.

One branch stays uncovered: the category path re-reads after a skipped insert and applies the same
direction check there, and nothing can reach that re-read in one session, since the lookup running
just before the insert would already have found the row.
"""

import uuid

from sqlalchemy import literal_column, select, text

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.merchant import Merchant
from app.models.tag import Tag
from app.models.user import User
from app.services.importers.shared.insertion_helpers import insert_import_records_if_absent
from app.services.importers.shared.merchants import (
    ImportMerchants,
    create_missing_import_merchants,
    get_import_merchant_key,
)
from app.services.importers.shared.stats import ImportStats
from app.services.importers.shared.tags import create_missing_import_tags
from tests.conftest import TestSession

_CATEGORY_CONFLICT = {
    "index_elements": [Category.owner_id, literal_column("lower(name)")],
    "index_where": text("owner_id IS NOT NULL AND group_id IS NULL"),
}
_MERCHANT_CONFLICT = {
    "index_elements": [Merchant.owner_id, literal_column("lower(name)")],
    "index_where": text("group_id IS NULL"),
}
_TAG_CONFLICT = {
    "index_elements": [Tag.owner_id, Tag.name],
    "index_where": text("group_id IS NULL"),
}


async def _seed_user(session) -> uuid.UUID:
    """Insert the user the records belong to

    Args:
        session: Database session the test runs in

    Returns:
        Identifier of the user
    """
    session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
    user = User(
        email="concurrent-import@example.com",
        first_name="Concurrent",
        tz="America/Toronto",
        base_currency="CAD",
    )
    session.add(user)
    await session.flush()
    return user.id


async def test_a_category_of_that_name_already_written_is_skipped_by_the_insert():
    """The second insert writes nothing rather than breaking the unique index and the transaction."""
    async with TestSession() as session:
        user_id = await _seed_user(session)
        values = [{"owner_id": user_id, "group_id": None, "name": "Bonus", "kind": CategoryKind.INCOME}]

        first = await insert_import_records_if_absent(session, Category, values, **_CATEGORY_CONFLICT)
        second = await insert_import_records_if_absent(session, Category, values, **_CATEGORY_CONFLICT)

        assert len(first) == 1
        assert list(second) == []

        stored = (await session.execute(
            select(Category.id).where(Category.owner_id == user_id),
        )).scalars().all()
        assert len(stored) == 1


async def test_a_category_spelled_differently_is_skipped_by_the_insert_too():
    """The insert skips on the same rule the routes compare by, not on the name as spelled."""
    async with TestSession() as session:
        user_id = await _seed_user(session)

        await insert_import_records_if_absent(
            session,
            Category,
            [{"owner_id": user_id, "group_id": None, "name": "Bonus", "kind": CategoryKind.INCOME}],
            **_CATEGORY_CONFLICT,
        )
        second = await insert_import_records_if_absent(
            session,
            Category,
            [{"owner_id": user_id, "group_id": None, "name": "BONUS", "kind": CategoryKind.INCOME}],
            **_CATEGORY_CONFLICT,
        )

        assert list(second) == []


async def test_only_the_merchants_not_already_there_are_written():
    """One insert carries every new merchant, and the ones another request wrote are left alone."""
    async with TestSession() as session:
        user_id = await _seed_user(session)
        await insert_import_records_if_absent(
            session,
            Merchant,
            [{"owner_id": user_id, "group_id": None, "name": "Amazon", "default_category_id": None}],
            **_MERCHANT_CONFLICT,
        )

        inserted = await insert_import_records_if_absent(
            session,
            Merchant,
            [
                {"owner_id": user_id, "group_id": None, "name": name, "default_category_id": None}
                for name in ("AMAZON", "Bakery", "Corner Cafe")
            ],
            **_MERCHANT_CONFLICT,
        )

        assert {merchant.name for merchant in inserted} == {"Bakery", "Corner Cafe"}


async def test_a_merchant_written_after_the_lookup_is_reused_rather_than_failing_the_import():
    """A lookup taken before another request committed is what a race leaves this holding."""
    async with TestSession() as session:
        user_id = await _seed_user(session)
        existing = (await insert_import_records_if_absent(
            session,
            Merchant,
            [{"owner_id": user_id, "group_id": None, "name": "Amazon", "default_category_id": None}],
            **_MERCHANT_CONFLICT,
        ))[0]

        # Empty, as it would be for an import whose merchants were loaded before that row landed
        merchants = ImportMerchants(by_key={})
        stats = ImportStats()

        await create_missing_import_merchants(session, user_id, ["Amazon"], [], merchants, stats)

        # Counted as neither created nor written twice, and the rows using it get the row that won
        assert stats.merchants_created == 0
        assert stats.created_merchant_ids == []
        assert merchants.by_key[get_import_merchant_key("Amazon")].id == existing.id


async def test_a_tag_written_after_the_lookup_is_reused_rather_than_failing_the_import():
    """Tags carry the same insert, so two imports both introducing one name do not fail either."""
    async with TestSession() as session:
        user_id = await _seed_user(session)
        existing = (await insert_import_records_if_absent(
            session,
            Tag,
            [{"owner_id": user_id, "group_id": None, "name": "travel"}],
            **_TAG_CONFLICT,
        ))[0]

        tags_by_name: dict[str, Tag] = {}
        stats = ImportStats()

        await create_missing_import_tags(session, user_id, ["travel"], tags_by_name, stats)

        assert stats.tags_created == 0
        assert stats.created_tag_ids == []
        assert tags_by_name["travel"].id == existing.id


async def test_another_users_merchant_does_not_block_writing_your_own():
    """The insert skips only within the scope its index covers, so one user's names bound nobody else."""
    async with TestSession() as session:
        user_id = await _seed_user(session)
        other_user_id = await _seed_other_user(session)

        # Owned by somebody else, so the insert skips nothing and the row is invisible to this user.
        # Reached by handing the create step a name whose row is out of its scope
        await insert_import_records_if_absent(
            session,
            Merchant,
            [{"owner_id": other_user_id, "group_id": None, "name": "Amazon", "default_category_id": None}],
            **_MERCHANT_CONFLICT,
        )

        merchants = ImportMerchants(by_key={})
        stats = ImportStats()

        await create_missing_import_merchants(session, user_id, ["Amazon"], [], merchants, stats)

        # Another user's merchant does not block this one, so the import writes its own
        assert stats.merchants_created == 1
        assert merchants.by_key[get_import_merchant_key("Amazon")].owner_id == user_id


async def _seed_other_user(session) -> uuid.UUID:
    """Insert a second user, so a record owned by somebody else can be written

    Args:
        session: Database session the test runs in

    Returns:
        Identifier of the second user
    """
    user = User(
        email="concurrent-import-other@example.com",
        first_name="Other",
        tz="America/Toronto",
        base_currency="CAD",
    )
    session.add(user)
    await session.flush()
    return user.id
