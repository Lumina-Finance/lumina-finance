"""Provider request records, which the rolling 24-hour request budget counts

A record kept past the window would count against a budget it no longer belongs to, and one
pruned early would let Lumina exceed the Bridge's limit, which disables the user's token
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.models.bank_connection import BankProviderRequest, ProviderRequestPurpose
from app.models.currency import Currency
from app.services.bank_sync.provider_requests import record_provider_request
from tests.routes.support.bank_sync_helpers import _build_bank_connection, _build_user

_NOW = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)


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
