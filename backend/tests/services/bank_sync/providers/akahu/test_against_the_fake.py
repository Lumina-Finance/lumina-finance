"""The Akahu adapter against the fake Akahu

Guards that the fake the dev instance and the browser tests sync with speaks what the adapter reads,
so a browser test that fails points at the app and not at a fake the adapter can't understand
"""

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.services.bank_sync.providers.contract import ClaimRefused
from tests.fake_akahu import app
from tests.services.bank_sync.providers.akahu.stand_ins import akahu_adapter


async def test_the_adapter_claims_discovers_and_fetches_the_fakes_sample_scenario():
    """The sample's tokens claim, both accounts are found with their balances, the last 10 days import exactly, and the hold shows as pending"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://fake.test") as control:
        scenario = (await control.post("/control/scenarios/sample")).json()
    adapter = akahu_adapter(transport)

    stored = await adapter.claim({"app_id_token": scenario["app_id_token"], "user_access_token": scenario["user_access_token"]})
    discovered = await adapter.discover(stored, currency_exponents={"NZD": 2})
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    fetched = await adapter.fetch(
        stored,
        account_ids=[account.external_id for account in discovered.accounts],
        start=today - timedelta(days=10),
        end=today + timedelta(days=1),
        include_pending=True,
        timezone=UTC,
        currency_exponents={"NZD": 2},
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
        ("CARD PURCHASE FRESHWAY MARKET", -1200, True),
    ]
    assert [(record.description, record.amount) for record in visa.records] == [
        ("VISA PURCHASE PARCELPOINT ONLINE", -12995),
        ("VISA PURCHASE CITYLINK TRANSIT TOPUP", -2000),
    ]


async def test_the_adapter_reports_tokens_the_fake_does_not_know_as_refused():
    """The fake answers an unknown pair with Akahu's 401, and the claim turns that into the way to check both tokens"""
    adapter = akahu_adapter(httpx.ASGITransport(app=app))

    with pytest.raises(ClaimRefused):
        await adapter.claim({"app_id_token": "app_token_unknown", "user_access_token": "user_token_unknown"})
