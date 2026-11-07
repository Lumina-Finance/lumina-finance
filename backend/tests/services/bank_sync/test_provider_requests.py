"""Provider request records, and the rolling 24-hour request budget they count

A record kept past the window would count against a budget it no longer belongs to, and one
pruned early, a request let through at the cap or a quota warning ignored would let Lumina exceed
the Bridge's limit. Exceeding it disables the user's token
"""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text

from app.models.bank_connection import BankConnection, BankProviderRequest, ProviderRequestPurpose
from app.models.currency import Currency
from app.services.bank_sync.provider_requests import (
    RequestBudget,
    RequestBudgetSpent,
    read_request_budget,
    record_provider_request,
    reserve_provider_request,
    summarize_request_budget,
)
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _build_bank_connection, _build_user
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.services.bank_sync.fake_provider import remove_provider

_NOW = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)

# Connection A in the example: 20 requests in the last 24 hours, the oldest at 09:12 yesterday
_EXAMPLE_NOW = datetime(2026, 10, 4, 8, 30, tzinfo=UTC)
_EXAMPLE_OLDEST = datetime(2026, 10, 3, 9, 12, tzinfo=UTC)


async def _seed_connection(db, email: str):
    """Add a user and their connection, returning the connection"""
    user = _build_user(email)
    db.add(user)
    await db.flush()
    connection = _build_bank_connection(user.id)
    db.add(connection)
    await db.flush()
    return connection


async def test_record_provider_request_prunes_the_connections_records_past_24_hours(db):
    """A record from 25 hours ago goes, one from 23 hours ago stays, and the new one is added"""
    db.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
    await db.flush()
    connection = await _seed_connection(db, "budget@example.com")
    other_connection = await _seed_connection(db, "other@example.com")
    for owner_connection, hours_ago in ((connection, 25), (connection, 23), (other_connection, 25)):
        db.add(
            BankProviderRequest(
                owner_id=owner_connection.owner_id,
                connection_id=owner_connection.id,
                purpose=ProviderRequestPurpose.SYNC,
                requested_at=_NOW - timedelta(hours=hours_ago),
            )
        )
    await db.flush()

    await record_provider_request(
        db,
        owner_id=connection.owner_id,
        connection_id=connection.id,
        purpose=ProviderRequestPurpose.DISCOVERY,
        now=_NOW,
    )

    kept = (
        await db.execute(
            select(BankProviderRequest.connection_id, BankProviderRequest.requested_at, BankProviderRequest.purpose).order_by(
                BankProviderRequest.connection_id == connection.id, BankProviderRequest.requested_at
            )
        )
    ).all()
    assert [tuple(row) for row in kept] == [
        # Another connection's records are left for its own budget to prune
        (other_connection.id, _NOW - timedelta(hours=25), "sync"),
        (connection.id, _NOW - timedelta(hours=23), "sync"),
        (connection.id, _NOW, "discovery"),
    ]


async def _connection_with_requests(db, *sent_at: datetime) -> BankConnection:
    """Add a user and their connection. The connection sent a request at each of the times"""
    db.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
    await db.flush()
    connection = await _seed_connection(db, "budget@example.com")
    db.add_all(
        BankProviderRequest(owner_id=connection.owner_id, connection_id=connection.id, purpose=ProviderRequestPurpose.SYNC, requested_at=moment)
        for moment in sent_at
    )
    await db.flush()
    return connection


def _example_requests(count: int = 20) -> list[datetime]:
    """Return Connection A's request times: the oldest at 09:12 yesterday, then one every 30 minutes"""
    return [_EXAMPLE_OLDEST + timedelta(minutes=30 * step) for step in range(count)]


async def _counted(db, connection: BankConnection) -> int:
    """Return how many request records the connection has"""
    return len((await db.scalars(select(BankProviderRequest.id).where(BankProviderRequest.connection_id == connection.id))).all())


async def test_request_budget_at_20_of_20_frees_when_the_oldest_request_leaves_the_24_hours(db):
    """Connection A's 20 requests since 09:12 yesterday leave none at 08:30, and one frees at 09:12"""
    connection = await _connection_with_requests(db, *_example_requests())

    budget = await read_request_budget(db, connection, now=_EXAMPLE_NOW)

    assert budget == RequestBudget(limit=20, used=20, available_again_at=datetime(2026, 10, 4, 9, 12, tzinfo=UTC))


def test_request_budget_after_the_limit_is_lowered_waits_for_enough_requests_to_leave():
    """With 22 counted under a limit of 20, three have to leave before a request frees, so the third oldest decides"""
    counted = [_NOW - timedelta(hours=23, minutes=minutes) for minutes in range(22, 0, -1)]

    budget = summarize_request_budget(counted, limit=20, spent_until=None, now=_NOW)

    assert budget == RequestBudget(limit=20, used=22, available_again_at=counted[2] + timedelta(hours=24))


async def test_reserve_at_the_cap_is_refused_until_the_oldest_request_leaves(db):
    """The sync due at 08:30 is refused with 09:12 and counts nothing, and goes ahead at 09:12"""
    connection = await _connection_with_requests(db, *_example_requests())

    with pytest.raises(RequestBudgetSpent) as refused:
        await reserve_provider_request(db, connection, purpose=ProviderRequestPurpose.SYNC, now=_EXAMPLE_NOW)
    assert refused.value.available_again_at == datetime(2026, 10, 4, 9, 12, tzinfo=UTC)
    assert await _counted(db, connection) == 20

    await reserve_provider_request(db, connection, purpose=ProviderRequestPurpose.SYNC, now=datetime(2026, 10, 4, 9, 12, tzinfo=UTC))

    # The oldest left the 24 hours and was pruned as the new one was counted
    assert await _counted(db, connection) == 20


async def test_reserve_by_two_senders_at_once_gives_the_last_request_to_one():
    """At 19 of 20, a second sender waits for the first and is refused, rather than both sending"""
    async with TestSession() as setup:
        connection = await _connection_with_requests(setup, *_example_requests(19))
        await setup.commit()

    async with TestSession() as first, TestSession() as second:
        await reserve_provider_request(first, connection, purpose=ProviderRequestPurpose.SYNC, now=_EXAMPLE_NOW)
        first_pid = await first.scalar(text("SELECT pg_backend_pid()"))
        await second.execute(text("SET LOCAL lock_timeout = '5s'"))
        racing = asyncio.create_task(reserve_provider_request(second, connection, purpose=ProviderRequestPurpose.SYNC, now=_EXAMPLE_NOW))

        # The second sender has to be waiting on the first one's lock before the first commits,
        # so a missing lock fails here rather than letting both through
        await _wait_until_waiting_on(first_pid, racing)
        await first.commit()

        with pytest.raises(RequestBudgetSpent):
            async with asyncio.timeout(5):
                await racing

    async with TestSession() as check:
        assert await _counted(check, connection) == 20


async def test_request_budget_of_a_provider_no_longer_installed_reads_as_none_used_with_no_limit(db, monkeypatch):
    """With the provider's folder deleted the connection can't send anything, so its budget shows no use and no limit"""
    connection = await _connection_with_requests(db, _NOW - timedelta(hours=1))
    remove_provider(monkeypatch, connection.provider)

    assert await read_request_budget(db, connection, now=_NOW) == RequestBudget(limit=None, used=0, available_again_at=None)
