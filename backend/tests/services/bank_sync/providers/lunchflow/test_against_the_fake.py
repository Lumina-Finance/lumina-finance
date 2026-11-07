"""The Lunch Flow adapter against the fake Lunch Flow

Guards that the fake the dev instance and the browser tests sync with speaks what the adapter reads,
so a browser test that fails points at the app and not at a fake the adapter can't understand
"""

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.services.bank_sync.providers.contract import ClaimRefused
from tests.fake_lunchflow import app
from tests.services.bank_sync.providers.lunchflow.stand_ins import lunchflow_adapter


async def test_the_adapter_claims_discovers_and_fetches_the_fakes_sample_scenario():
    """The sample's key claims, both accounts are found with their balances, and the last 10 days import exactly"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://fake.test") as control:
        api_key = (await control.post("/control/scenarios/sample")).json()["api_key"]
    adapter = lunchflow_adapter(transport)

    stored = await adapter.claim({"api_key": api_key})
    discovered = await adapter.discover(stored, currency_exponents={"CAD": 2})
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    fetched = await adapter.fetch(
        stored,
        account_ids=[account.external_id for account in discovered.accounts],
        start=today - timedelta(days=10),
        end=today + timedelta(days=1),
        include_pending=True,
        timezone=UTC,
        currency_exponents={"CAD": 2},
    )

    assert discovered.request_error is None
    assert [(account.name, account.balance, account.institution_name) for account in discovered.accounts] == [
        ("Everyday Chequing", 241836, "Harbour Bank"),
        ("Rewards Visa", -61240, "Harbour Bank"),
    ]
    assert len({account.login_key for account in discovered.accounts}) == 1
    assert fetched.request_error is None
    assert fetched.account_errors == {}
    chequing, visa = fetched.accounts
    assert [(record.description, record.amount, record.pending) for record in chequing.records] == [
        ("EFTPOS BEAN THERE CAFE", -575, False),
        ("DIRECT CREDIT BRIGHTWORKS LTD SALARY", 265000, False),
        ("EFTPOS NORTHERN FUEL STOP", -7210, False),
    ]
    assert [(record.description, record.amount) for record in visa.records] == [
        ("VISA PURCHASE PARCELPOINT ONLINE", -12995),
        ("VISA PURCHASE CITYLINK TRANSIT TOPUP", -2000),
    ]


async def test_the_adapter_reports_a_key_the_fake_does_not_know_as_refused():
    """The fake answers an unknown key with Lunch Flow's 401, and the claim turns it into the way to make a new key"""
    adapter = lunchflow_adapter(httpx.ASGITransport(app=app))

    with pytest.raises(ClaimRefused):
        await adapter.claim({"api_key": "lf_not_a_key"})
