"""The system categories and merchants a database starts with, seeded by runs that may overlap

Two deploys of one release can seed at once, and a seed that selects before it inserts lets the one
that loses the race fail on the unique index
"""

import asyncio
from collections.abc import Awaitable, Callable

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.categories.defaults import SYSTEM_CATEGORY_DEFAULTS, seed_system_categories
from app.services.merchants.defaults import SYSTEM_MERCHANT_NAMES, UNKNOWN_MERCHANT_NAME, seed_system_merchants
from tests.conftest import TestSession, engine

# Seconds the tests give a seed that waits on another to notice it
_WAIT_SECONDS = 30


async def _seed_and_commit(seed: Callable[[AsyncSession], Awaitable[object]]) -> None:
    """Seed in a session of its own, committing as the job does"""
    async with TestSession() as session:
        await seed(session)
        await session.commit()


async def _wait_until_a_statement_waits_on_a_lock() -> None:
    """Return once another connection of the database is waiting on a lock"""
    waiting = "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'"
    async with asyncio.timeout(_WAIT_SECONDS):
        while True:
            async with engine.connect() as connection:
                if await connection.scalar(text(waiting)):
                    return
            await asyncio.sleep(0.05)


@pytest.mark.parametrize(
    ("table", "seed", "expected"),
    [
        ("categories", seed_system_categories, len(SYSTEM_CATEGORY_DEFAULTS)),
        ("merchants", seed_system_merchants, len(SYSTEM_MERCHANT_NAMES)),
    ],
)
async def test_a_seed_started_while_another_has_not_committed_waits_and_adds_nothing_twice(table, seed, expected):
    """The first seed holds the rows it inserted, so the second reaches the same rows, waits, and then finds them"""
    async with TestSession() as first:
        await first.execute(text(f"DELETE FROM {table} WHERE is_system"))  # noqa: S608
        await first.commit()
        await seed(first)

        second = asyncio.create_task(_seed_and_commit(seed))
        await _wait_until_a_statement_waits_on_a_lock()
        await first.commit()
        await second

    async with TestSession() as session:
        assert await session.scalar(text(f"SELECT count(*) FROM {table} WHERE is_system")) == expected  # noqa: S608


async def test_a_system_category_kept_in_other_capitals_is_updated_in_place():
    """A stored name that differs from the default only in capitals is the same category, so it takes the default's spelling and icon"""
    default = SYSTEM_CATEGORY_DEFAULTS[0]
    async with TestSession() as session:
        await session.execute(
            text("UPDATE categories SET name = upper(name), icon = 'x' WHERE is_system AND name = :name"), {"name": default.name}
        )
        await session.commit()
        original_id = await session.scalar(
            text("SELECT id FROM categories WHERE is_system AND lower(name) = lower(:name)"), {"name": default.name}
        )

        await seed_system_categories(session)
        await session.commit()

        rows = (
            await session.execute(
                text("SELECT id, name, icon FROM categories WHERE is_system AND lower(name) = lower(:name)"), {"name": default.name}
            )
        ).all()
    assert [tuple(row) for row in rows] == [(original_id, default.name, default.icon)]


async def test_seeding_the_merchants_reports_only_the_ones_it_created():
    """A run that finds every system merchant already there creates none, and one that finds one missing says which"""
    async with TestSession() as session:
        assert await seed_system_merchants(session) == [], "a database that has them all gets none"

        await session.execute(text("DELETE FROM merchants WHERE is_system AND name = :name"), {"name": UNKNOWN_MERCHANT_NAME})
        assert await seed_system_merchants(session) == [UNKNOWN_MERCHANT_NAME], "the missing one is created and named"
        await session.commit()
