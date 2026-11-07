"""The provider list: what a deployment offers and whether the user can link bank accounts now

The app offers only what this list returns, so a disabled or withdrawn provider, a user who may not
link bank accounts and a stopped worker all have to show here. The routes can't run under a frozen
clock, so the heartbeat is set against the real one, well inside 15 minutes, and the service tests
own the boundary
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models.bank_connection import BankLinkState
from app.models.bank_sync_job import BankSyncHeartbeat
from app.services.bank_sync import availability
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _build_account,
    _build_bank_connection,
    _build_bank_link,
    _build_external_account,
    _build_user,
    _sign_up,
)
from tests.services.bank_sync.fake_provider import FAKE_PROVIDER, FakeProviderAdapter, remove_provider, use_adapter

_FAKE = {
    "id": "fake",
    "name": "Fake Bank",
    "site": "Fake Bank Online",
    "description": "One access key reaches every account you hold at Fake Bank.",
    "credential_fields": [{"key": "access_key", "label": "Access key", "placeholder": "Paste the key", "max_length": 512}],
    "connect_steps": ["Sign in to Fake Bank Online.", "Create an access key and paste it here."],
    "connects_from": "settings",
    "offered": True,
    "history_limit_months": 12,
    "advertises_history": False,
    "institution_limit": None,
    "institutions_in_use": [],
}


async def _record_heartbeat(minutes_ago: int) -> None:
    """Commit the worker's heartbeat as last scanning the given number of minutes ago"""
    async with TestSession() as session:
        session.add(BankSyncHeartbeat(last_scan_at=datetime.now(UTC) - timedelta(minutes=minutes_ago)))
        await session.commit()


async def _link_at(owner_id: uuid.UUID, institution_key: str, institution_name: str, *, login_key: str, unlinked: bool = False) -> None:
    """Commit a new connection whose one bank account, at the institution, is linked to a new account"""
    async with TestSession() as session:
        connection = _build_bank_connection(owner_id)
        account = _build_account(owner_id, f"{institution_name} {login_key}")
        session.add_all([connection, account])
        await session.flush()
        bank_account = _build_external_account(connection, f"ACT-{login_key}")
        bank_account.institution_key = institution_key
        bank_account.institution_name = institution_name
        bank_account.login_key = login_key
        link = _build_bank_link(account, connection, f"ACT-{login_key}")
        if unlinked:
            link.state = BankLinkState.UNLINKED
            link.unlinked_at = datetime(2026, 10, 2, tzinfo=UTC)
        session.add_all([bank_account, link])
        await session.commit()


async def test_providers_offer_an_installed_provider_with_its_credential_steps_and_no_limit(client):
    """With no settings changed, an installed provider is enabled and offered with how to get its credential, and no institution limit"""
    headers, _ = await _sign_up(client)
    await _record_heartbeat(minutes_ago=5)

    response = await client.get("/bank-sync/providers", headers=headers)

    assert response.status_code == 200, response.text
    assert response.json() == {"may_link": True, "sync_running": True, "providers": [_FAKE]}


async def test_providers_list_in_display_order_then_by_id(client, monkeypatch):
    """A provider placed earlier lists first, and two placed alike list by id"""
    second, third, first = FakeProviderAdapter(), FakeProviderAdapter(), FakeProviderAdapter()
    second.provider_id, third.provider_id, first.provider_id = "alpha_bank", "beta_bank", "zeta_bank"
    first.display_order = -1
    for adapter in (second, third, first):
        use_adapter(monkeypatch, adapter)
    headers, _ = await _sign_up(client)

    response = await client.get("/bank-sync/providers", headers=headers)

    assert [provider["id"] for provider in response.json()["providers"]] == ["zeta_bank", "alpha_bank", "beta_bank", "fake"]


async def test_providers_report_a_withdrawn_provider_as_not_offered(client, fake_provider, monkeypatch):
    """A provider stays listed once the environment withdraws its offer, so existing connections keep its facts"""
    use_adapter(monkeypatch, fake_provider, offered=False)
    headers, _ = await _sign_up(client)
    await _record_heartbeat(minutes_ago=0)

    response = await client.get("/bank-sync/providers", headers=headers)

    assert response.status_code == 200, response.text
    assert response.json()["providers"] == [{**_FAKE, "offered": False}]


@pytest.mark.parametrize("gone", ["turned-off", "removed"])
async def test_providers_leave_out_a_provider_turned_off_or_removed(client, fake_provider, monkeypatch, gone):
    """A deployment that turned its one provider off, or deleted its folder, has no provider to offer"""
    if gone == "turned-off":
        use_adapter(monkeypatch, fake_provider, enabled=False)
    else:
        remove_provider(monkeypatch, FAKE_PROVIDER)
    headers, _ = await _sign_up(client)
    await _record_heartbeat(minutes_ago=0)

    response = await client.get("/bank-sync/providers", headers=headers)

    assert response.status_code == 200, response.text
    assert response.json() == {"may_link": True, "sync_running": True, "providers": []}


async def test_providers_offer_nothing_to_a_user_who_may_not_link_bank_accounts(client, monkeypatch):
    """A user failing the bank-linking check sees no provider options"""
    monkeypatch.setattr(availability, "may_link_bank_accounts", lambda _user_id: False)
    headers, _ = await _sign_up(client)
    await _record_heartbeat(minutes_ago=0)

    response = await client.get("/bank-sync/providers", headers=headers)

    assert response.status_code == 200, response.text
    assert response.json() == {"may_link": False, "sync_running": True, "providers": []}


async def test_providers_say_sync_isnt_running_before_the_worker_ever_scans(client):
    """A deployment whose worker never started has no heartbeat at all"""
    headers, _ = await _sign_up(client)

    response = await client.get("/bank-sync/providers", headers=headers)

    assert response.status_code == 200, response.text
    assert response.json()["sync_running"] is False


async def test_providers_count_an_institution_once_however_many_logins_reach_it(client):
    """Two Harbour Bank logins count once, and an unlinked Northgate account and another user's bank don't count"""
    headers, user_id = await _sign_up(client)
    async with TestSession() as session:
        other = _build_user("other@example.com")
        session.add(other)
        await session.commit()
    await _link_at(user_id, "harbour", "Harbour Bank", login_key="login-1")
    await _link_at(user_id, "harbour", "Harbour Bank", login_key="login-2")
    await _link_at(user_id, "northgate", "Northgate Credit Union", login_key="login-3", unlinked=True)
    await _link_at(other.id, "lakeshore", "Lakeshore Trust", login_key="login-4")
    await _record_heartbeat(minutes_ago=0)

    response = await client.get("/bank-sync/providers", headers=headers)

    assert response.status_code == 200, response.text
    assert response.json()["providers"] == [{**_FAKE, "institutions_in_use": ["Harbour Bank"]}]
