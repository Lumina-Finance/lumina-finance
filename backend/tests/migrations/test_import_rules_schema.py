"""Import rule storage rules, checked on a database the migrations built

The rest of the suite builds its schema from the models, so a uniqueness rule, a cascade or a
rollback guard the migration left out would still pass there. These tests share one migrated
database per worker and run inside a transaction rolled back at its end. The rollback test is the
exception and builds its own database
"""

from uuid import UUID

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_rule import ImportRule, ImportRuleTag
from app.models.tag import Tag
from tests.conftest import WORKER_DB_NAME
from tests.migrations.support import (
    _create_engine_for_database,
    _drop_database,
    _recreate_database,
    _run_alembic,
    _run_alembic_upgrade,
)
from tests.routes.support.bank_sync_helpers import _build_user

_DATABASE_NAME = f"{WORKER_DB_NAME}_alembic_import_rules_schema"
_ROLLBACK_DATABASE_NAME = f"{WORKER_DB_NAME}_alembic_import_rules"
_IMPORT_RULES_REVISION = "a8e3f1b6d492"
_CONDITIONS = [{"kind": "condition", "attribute": "description", "operator": "contains", "value": "market"}]


@pytest.fixture(scope="module")
async def migrated_database():
    """Build one database through the migrations for every test in this module"""
    await _recreate_database(_DATABASE_NAME)
    try:
        _run_alembic_upgrade(_DATABASE_NAME)
        yield _DATABASE_NAME
    finally:
        await _drop_database(_DATABASE_NAME)


@pytest.fixture
async def session(migrated_database):
    """Yield a session on the migrated database whose work is rolled back afterwards

    A refused write is tried inside a savepoint, so the test carries on in the same transaction
    """
    engine = _create_engine_for_database(migrated_database)
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            session = AsyncSession(bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint")
            try:
                await session.execute(
                    text(
                        "INSERT INTO currencies (id, name, symbol, minor_unit_exponent) "
                        "VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING"
                    )
                )
                yield session
            finally:
                await session.close()
                await transaction.rollback()
    finally:
        await engine.dispose()


async def _add(session: AsyncSession, *rows) -> None:
    """Add rows and flush them, so the next level can point at them"""
    session.add_all(rows)
    await session.flush()


async def _refused(session: AsyncSession, row, constraint: str) -> None:
    """Assert that adding a row is refused by the named constraint, leaving the transaction usable"""
    with pytest.raises(IntegrityError, match=constraint):
        async with session.begin_nested():
            session.add(row)
            await session.flush()


async def _owner(session: AsyncSession):
    """Add and return a user"""
    user = _build_user("owner@example.com")
    await _add(session, user)
    return user


def _rule(owner_id: UUID, name: str, position: int, **overrides) -> ImportRule:
    """Return an unsaved rule with one condition"""
    values = {"owner_id": owner_id, "name": name, "position": position, "match": "all", "conditions": _CONDITIONS, **overrides}
    return ImportRule(**values)


async def test_rule_names_clash_whatever_their_capitals_and_only_within_one_user(session):
    """Market beside market is refused for one user, while another user may use the name"""
    owner = await _owner(session)
    other = _build_user("other@example.com")
    await _add(session, other, _rule(owner.id, "Market", 0))

    await _refused(session, _rule(owner.id, "MARKET", 1), "uq_import_rules_owner_name")
    await _add(session, _rule(other.id, "Market", 0))


async def test_rule_positions_clash_only_when_the_transaction_ends_so_rules_can_swap_places(session):
    """A move shifts rules onto each other's positions inside one statement, as the deferred check allows"""
    owner = await _owner(session)
    first, second = _rule(owner.id, "First", 0), _rule(owner.id, "Second", 1)
    await _add(session, first, second)

    first.position, second.position = 1, 0
    await session.flush()
    await session.execute(text("SET CONSTRAINTS uq_import_rules_owner_position IMMEDIATE"))
    assert sorted((await session.scalars(select(ImportRule.position))).all()) == [0, 1]

    # Back to deferred, so the repeat below is only found when the check is asked for
    await session.execute(text("SET CONSTRAINTS uq_import_rules_owner_position DEFERRED"))
    second.position = 1
    await session.flush()
    with pytest.raises(IntegrityError, match="uq_import_rules_owner_position"):
        await session.execute(text("SET CONSTRAINTS uq_import_rules_owner_position IMMEDIATE"))


async def test_rule_match_other_than_all_or_any_and_a_negative_position_are_refused(session):
    """The database holds the rule's own choices to the values the matcher understands"""
    owner = await _owner(session)

    await _refused(session, _rule(owner.id, "Neither", 0, match="non"), "ck_import_rules_match")
    await _refused(session, _rule(owner.id, "Above", -1), "ck_import_rules_position")


async def test_deleting_a_rule_removes_its_tags_and_deleting_its_owner_removes_the_rule(session):
    """Tag links and rules follow their rule and their owner"""
    owner = await _owner(session)
    tag = Tag(owner_id=owner.id, name="review")
    rule = _rule(owner.id, "Market", 0)
    await _add(session, tag, rule)
    await _add(session, ImportRuleTag(import_rule_id=rule.id, tag_id=tag.id))

    await session.execute(delete(ImportRule).where(ImportRule.id == rule.id))
    assert (await session.scalars(select(ImportRuleTag.tag_id))).all() == []

    await _add(session, _rule(owner.id, "Kept", 1))
    await session.execute(delete(Tag).where(Tag.id == tag.id))
    await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": owner.id})
    assert (await session.scalars(select(ImportRule.id))).all() == []


async def test_a_tag_a_rule_adds_cannot_be_deleted_underneath_it(session):
    """The tag's key does not cascade, so deleting it directly is refused rather than dropping the rule's action"""
    owner = await _owner(session)
    tag = Tag(owner_id=owner.id, name="review")
    rule = _rule(owner.id, "Market", 0)
    await _add(session, tag, rule)
    await _add(session, ImportRuleTag(import_rule_id=rule.id, tag_id=tag.id))

    with pytest.raises(IntegrityError, match="import_rule_tags"):
        async with session.begin_nested():
            await session.execute(delete(Tag).where(Tag.id == tag.id))


async def test_import_rule_tables_have_row_level_security_and_a_policy_from_the_migrations(session):
    """A rules table the migration left unsecured would show one user's rules to every user"""
    tables = ["import_rules", "import_rule_tags"]
    secured = (
        await session.execute(
            text(
                "SELECT c.relname, c.relrowsecurity, EXISTS (SELECT 1 FROM pg_policies p "
                "WHERE p.schemaname = 'public' AND p.tablename = c.relname) "
                "FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY(:tables)"
            ),
            {"tables": tables},
        )
    ).all()

    assert {name: (enabled, has_policy) for name, enabled, has_policy in secured} == dict.fromkeys(tables, (True, True))


async def _execute(database_name: str, statements: tuple[str, ...]) -> int:
    """Run statements against a generated database in one transaction, returning how many rows the last touched"""
    engine = _create_engine_for_database(database_name)
    try:
        async with engine.begin() as connection:
            for statement in statements:
                result = await connection.execute(text(statement))
            return result.rowcount
    finally:
        await engine.dispose()


async def _tables_present(database_name: str) -> set[str]:
    """Return which of the import rule tables a generated database holds"""
    engine = _create_engine_for_database(database_name)
    try:
        async with engine.connect() as connection:
            found = await connection.scalars(
                text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('import_rules', 'import_rule_tags')")
            )
            return set(found)
    finally:
        await engine.dispose()


async def test_rolling_back_refuses_while_a_rule_exists_and_succeeds_once_there_are_none():
    """Dropping the tables would delete rules nothing can rebuild, so the downgrade names them and keeps them"""
    await _recreate_database(_ROLLBACK_DATABASE_NAME)
    try:
        _run_alembic_upgrade(_ROLLBACK_DATABASE_NAME, revision=_IMPORT_RULES_REVISION)
        await _execute(
            _ROLLBACK_DATABASE_NAME,
            (
                "INSERT INTO currencies (id, name, symbol, minor_unit_exponent) "
                "VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING",
                "INSERT INTO users (id, email, first_name, tz, base_currency) "
                "VALUES ('11111111-1111-4111-8111-111111111111', 'rules@example.com', 'Rules', 'America/Toronto', 'CAD')",
                "INSERT INTO import_rules (id, owner_id, name, position, match, conditions) VALUES "
                "(gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'Market', 0, 'all', '[]'::jsonb)",
            ),
        )

        refused = _run_alembic(_ROLLBACK_DATABASE_NAME, "downgrade", "-1")

        assert refused.returncode != 0
        assert "Refusing to roll back: it would delete the import rules users wrote" in refused.stderr
        assert await _tables_present(_ROLLBACK_DATABASE_NAME) == {"import_rules", "import_rule_tags"}

        assert await _execute(_ROLLBACK_DATABASE_NAME, ("DELETE FROM import_rules",)) == 1
        emptied = _run_alembic(_ROLLBACK_DATABASE_NAME, "downgrade", "-1")
        assert emptied.returncode == 0, emptied.stdout + emptied.stderr
        assert await _tables_present(_ROLLBACK_DATABASE_NAME) == set()

        # The rollback is a true inverse, so upgrading again brings both tables back
        _run_alembic_upgrade(_ROLLBACK_DATABASE_NAME, revision=_IMPORT_RULES_REVISION)
        assert await _tables_present(_ROLLBACK_DATABASE_NAME) == {"import_rules", "import_rule_tags"}
    finally:
        await _drop_database(_ROLLBACK_DATABASE_NAME)
