"""What the allowance check refuses in bank sync besides linking, which each linking route's own refusal test covers

A new connection is refused before the user is sent to their bank or a one-time token is spent, and
Sync now is refused with the check's sentence and queues nothing
"""

import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from app.allowance_hook import AllowanceKind
from app.models.bank_connection import BankAccountLink
from app.services.bank_sync import account_link, range_import
from tests.conftest import TestSession
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check
from tests.routes.support.authorization_helpers import (
    _commit_rejected_connection,
    _finish,
    _sign_up_other_user,
    _start,
    _started_state,
    _stored_authorizations,
)
from tests.routes.support.bank_sync_helpers import (
    _commit_link,
    _commit_listed_connection,
    _new_account,
    _queued_jobs,
    _sign_up,
    _stored_connections,
)
from tests.services.bank_sync.fake_provider import ACCESS_KEY, FakeProviderAdapter, _returned

# Noon on October 5 in Toronto, the zone _sign_up stores
_NOW = datetime(2026, 10, 5, 12, 0, tzinfo=ZoneInfo("America/Toronto"))

# A credential the fake provider could claim, and a refused connection must leave it unclaimed
_CREDENTIAL = "fake-access-key"


async def test_claim_refused_a_new_connection_says_the_reason_and_spends_no_token(client, fake_provider: FakeProviderAdapter):
    """The credential stays claimable for the user's next try, and no connection is stored"""
    fake_provider.claimable[_CREDENTIAL] = "fake-stored-access"
    asked = install_check(refused={AllowanceKind.BANK_CONNECTION})
    headers, _ = await _sign_up(client)

    refused = await client.post("/bank-sync/connections", json={"provider": "fake", "credentials": {ACCESS_KEY: _CREDENTIAL}}, headers=headers)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == ALLOWANCE_REASON
    assert fake_provider.claimable == {_CREDENTIAL: "fake-stored-access"}, "the one-time credential was claimed before the refusal"
    assert await _stored_connections() == []
    assert [(request.kind, request.held, request.adding) for request in asked if request.kind == AllowanceKind.BANK_CONNECTION] == [
        (AllowanceKind.BANK_CONNECTION, 0, 1)
    ]


async def test_start_refused_a_new_connection_sends_the_user_nowhere(client, authorizing_provider):
    """Nothing is kept and the bank is never asked for an address, so the user isn't sent to sign in for a connection they can't have"""
    install_check(refused={AllowanceKind.BANK_CONNECTION})
    headers, _ = await _sign_up(client)

    refused = await _start(client, headers)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == ALLOWANCE_REASON
    assert authorizing_provider.starts == []
    assert await _stored_authorizations() == []


async def test_claim_tells_the_check_how_many_connections_the_user_holds_and_never_counts_another_users(
    client, fake_provider: FakeProviderAdapter
):
    """One connection of the user's own and one of another user's make the user's count one"""
    fake_provider.claimable[_CREDENTIAL] = "fake-stored-access"
    fake_provider.outcomes = [_returned("ACT-1")]
    headers, user_id = await _sign_up(client)
    _, other_id = await _sign_up_other_user(client)
    await _commit_listed_connection(user_id)
    await _commit_listed_connection(uuid.UUID(other_id))
    asked = install_check()

    claimed = await client.post("/bank-sync/connections", json={"provider": "fake", "credentials": {ACCESS_KEY: _CREDENTIAL}}, headers=headers)

    assert claimed.status_code == 201, claimed.text
    assert [(request.held, request.adding) for request in asked if request.kind == AllowanceKind.BANK_CONNECTION] == [(1, 1)]


async def test_finish_refused_a_new_connection_stores_none_and_the_code_is_never_exchanged(client, authorizing_provider):
    """The return asks again after the start, and a refusal spends the sign-in, so the user starts over, but never the bank's code"""
    headers, _ = await _sign_up(client)
    state = await _started_state(client, headers, authorizing_provider)
    install_check(refused={AllowanceKind.BANK_CONNECTION})

    refused = await _finish(client, headers, state)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == ALLOWANCE_REASON
    assert await _stored_connections() == []
    assert authorizing_provider.authorized == [], "the bank's code was exchanged for a connection the user may not have"
    assert await _stored_authorizations() == [], "the sign-in was kept after the refusal"


async def test_reconnecting_a_connection_never_asks_for_a_new_one(client, authorizing_provider):
    """A user refused a new connection can still sign in again at the bank, since a reconnection replaces a held connection's access"""
    headers, user_id = await _sign_up(client)
    rejected = await _commit_rejected_connection(user_id)
    authorizing_provider.outcomes = [_returned("ACT-1")]
    asked = install_check(refused={AllowanceKind.BANK_CONNECTION})
    state = await _started_state(client, headers, authorizing_provider, connection_id=str(rejected.id))

    finished = await _finish(client, headers, state)

    assert finished.status_code == 200, finished.text
    assert finished.json()["outcome"] == "reconnected"
    assert [request.kind for request in asked if request.kind == AllowanceKind.BANK_CONNECTION] == []


async def test_sync_now_refused_says_the_reason_and_queues_nothing(client):
    """Sync now on a linked account is asked of the check like a scheduled sync, and a refusal spends no request"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=datetime.now(UTC))
    await _commit_link(account_id, connection)
    install_check(refused={AllowanceKind.BANK_SYNC})

    refused = await client.post(f"/accounts/{account_id}/bank-link/sync", headers=headers)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == ALLOWANCE_REASON
    assert await _queued_jobs() == []


async def test_range_import_refused_says_the_reason_and_stores_no_range_and_queues_nothing(client, pin_clock):
    """Importing a date range is asked of the check like Sync now, and a refusal changes the link and queues nothing"""
    pin_clock(_NOW, range_import, account_link)
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    link = await _commit_link(account_id, connection, importing=False, last_success_at=_NOW - timedelta(hours=5))
    install_check(refused={AllowanceKind.BANK_SYNC})

    refused = await client.post(
        f"/accounts/{account_id}/bank-link/range-import", json={"first_day": "2026-03-01", "last_day": "2026-03-31"}, headers=headers
    )

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == ALLOWANCE_REASON
    async with TestSession() as session:
        stored = await session.get_one(BankAccountLink, link.id)
    assert (stored.range_first_day, stored.range_next_day, stored.importing) == (None, None, False)
    assert await _queued_jobs() == []
