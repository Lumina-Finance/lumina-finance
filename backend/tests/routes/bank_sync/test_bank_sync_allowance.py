"""What the allowance check refuses in bank sync besides linking, which each linking route's own refusal test covers

A new connection is refused before the user is sent to their bank or a one-time token is spent, and
Sync now is refused with the deployment's sentence and queues nothing
"""

from datetime import UTC, datetime

from app.allowance_hook import AllowanceKind
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check
from tests.routes.support.authorization_helpers import _start, _stored_authorizations
from tests.routes.support.bank_sync_helpers import (
    _commit_link,
    _commit_listed_connection,
    _new_account,
    _queued_jobs,
    _sign_up,
    _stored_connections,
)
from tests.services.bank_sync.fake_provider import ACCESS_KEY, FakeProviderAdapter

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
