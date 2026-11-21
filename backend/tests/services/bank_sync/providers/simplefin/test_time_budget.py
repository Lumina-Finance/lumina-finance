"""The time budget a connect gives its calls to SimpleFIN Bridge, and the sync job it leaves alone

The user waits on a connect, so a stalled Bridge ends it while the browser still waits for its answer.
A Bridge that is slow but answers in time connects as before, and no one waits on a sync job, so it
keeps waiting for a slow Bridge as it always has
"""

import asyncio
import uuid
from datetime import date

import pytest
from sqlalchemy import select, update

from app.encryption import encrypt
from app.models.bank_connection import BankConnection
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind
from app.models.bank_transaction import BankTransaction
from app.services.bank_sync import outbound
from app.services.bank_sync.providers.simplefin.adapter import SimpleFinAdapter
from app.services.bank_sync.providers.simplefin.config import PROVIDER_ID
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _seed_job, _sign_up, _stored_connections
from tests.services.bank_sync.fake_provider import use_adapter
from tests.services.bank_sync.providers.simplefin.stand_ins import FakeBridgeScenario, PausedBridge, SlowBridge, simplefin_adapter
from tests.services.bank_sync.support import (
    _BANK_ID,
    _KNOWN_BANK_IDS,
    _TODAY,
    _bank_transactions,
    _checkpoints,
    _link,
    _run_jobs_until_none_is_due,
)

_UNREACHABLE = "SimpleFIN Bridge couldn't be reached. Please try again in a few minutes"

# The budget these tests give a request, short to keep them quick
_BUDGET_SECONDS = 1.0

# Each request's delay at a Bridge that is slow but leaves a connect's two requests inside the budget
_INSIDE_THE_BUDGET_SECONDS = 0.1

# Each request's delay at a Bridge slower than the whole budget, and far inside the per-call timeout
_PAST_THE_BUDGET_SECONDS = 1.5

# Long past the budget, so a request still waiting then was never stopped by it
_GIVE_UP_SECONDS = 10


@pytest.fixture(autouse=True)
def short_budget(monkeypatch) -> None:
    """Give each request the tests' short budget"""
    monkeypatch.setattr(outbound, "WAITED_REQUEST_BUDGET_SECONDS", _BUDGET_SECONDS)


async def _claim(client, headers, setup_token: str):
    """Claim a setup token through the route"""
    return await client.post(
        "/bank-sync/connections", json={"provider": "simplefin", "credentials": {"setup_token": setup_token}}, headers=headers
    )


async def test_connect_to_a_stalled_bridge_answers_within_the_budget_and_saves_nothing(client, scenario: FakeBridgeScenario, monkeypatch):
    """The claim gets no answer, so the request stops at its budget and says SimpleFIN Bridge couldn't be reached"""
    headers, _ = await _sign_up(client)
    stalled = PausedBridge("/claim/")
    use_adapter(monkeypatch, simplefin_adapter(stalled))

    async with asyncio.timeout(_GIVE_UP_SECONDS):
        refused = await _claim(client, headers, scenario.setup_token)

    assert stalled.reached.is_set()
    assert refused.status_code == 502, refused.text
    assert refused.json()["detail"] == _UNREACHABLE
    assert await _stored_connections() == []


async def test_connect_whose_listing_stalls_keeps_the_claimed_connection_and_queues_discovery(
    client, scenario: FakeBridgeScenario, monkeypatch
):
    """The token is spent once the claim answers, so a listing that runs out the budget still saves the connection"""
    headers, _ = await _sign_up(client)
    await scenario.add_harbour_accounts()
    stalled = PausedBridge("/accounts")
    use_adapter(monkeypatch, simplefin_adapter(stalled))

    async with asyncio.timeout(_GIVE_UP_SECONDS):
        response = await _claim(client, headers, scenario.setup_token)

    assert stalled.reached.is_set()
    assert response.status_code == 201, response.text
    assert response.json()["accounts"] == []
    assert response.json()["discovery_pending"] is True
    async with TestSession() as session:
        jobs = (await session.execute(select(BankSyncJob.connection_id, BankSyncJob.discover, BankSyncJob.status))).all()
    assert [tuple(job) for job in jobs] == [(uuid.UUID(response.json()["id"]), True, "queued")]


async def test_connect_to_a_slow_bridge_inside_the_budget_lists_its_bank_accounts(client, scenario: FakeBridgeScenario, monkeypatch):
    """Each answer is slow, but both come inside the budget, so the connect works as before"""
    headers, _ = await _sign_up(client)
    await scenario.add_harbour_accounts()
    use_adapter(monkeypatch, simplefin_adapter(SlowBridge(_INSIDE_THE_BUDGET_SECONDS)))

    response = await _claim(client, headers, scenario.setup_token)

    assert response.status_code == 201, response.text
    assert sorted(account["name"] for account in response.json()["accounts"]) == ["Everyday Chequing", "Online Savings", "Rewards Visa"]
    assert response.json()["discovery_pending"] is False


@pytest.mark.usefixtures("worker_sessions")
async def test_sync_job_waits_for_a_bridge_slower_than_the_budget(
    connection, scenario: FakeBridgeScenario, simplefin_reaches_the_fake_bridge: SimpleFinAdapter, monkeypatch
):
    """No one waits on a sync job, so a Bridge answering after the budget still brings its record in"""
    await scenario.change("POST", "/connections", {"conn_id": "CON-harbour", "name": "Harbour Bank", "org_id": "ORG-harbour"})
    bank_account = {
        "id": "ACT-1",
        "name": "Everyday Chequing",
        "conn_id": "CON-harbour",
        "currency": "CAD",
        "balance": "100.00",
        "balance_date": 1791115200,
    }
    await scenario.change("POST", "/accounts", bank_account)
    coffee = {"id": "TRN-coffee", "posted": "2026-10-02", "amount": "-4.50", "description": "POS 4411 COFFEE"}
    await scenario.change("POST", "/accounts/ACT-1/transactions", {"transactions": [coffee]})
    access_url = await simplefin_reaches_the_fake_bridge.claim_setup_token(scenario.setup_token)
    async with TestSession() as session:
        await session.execute(
            update(BankConnection)
            .where(BankConnection.id == connection.id)
            .values(provider=PROVIDER_ID, credential_encrypted=encrypt(access_url))
        )
        await session.commit()
    connection.provider = PROVIDER_ID
    link = await _link(connection, "ACT-1", import_start=date(2026, 10, 1), checkpoint=date(2026, 10, 1))
    _KNOWN_BANK_IDS.add("TRN-coffee")
    await _seed_job(connection, BankSyncJobKind.INITIAL)
    use_adapter(monkeypatch, simplefin_adapter(SlowBridge(_PAST_THE_BUDGET_SECONDS)))

    async with asyncio.timeout(_GIVE_UP_SECONDS):
        await _run_jobs_until_none_is_due()

    assert await _bank_transactions(_BANK_ID, BankTransaction.observed_date) == [("TRN-coffee", date(2026, 10, 2))]
    assert await _checkpoints(link) == [_TODAY]
