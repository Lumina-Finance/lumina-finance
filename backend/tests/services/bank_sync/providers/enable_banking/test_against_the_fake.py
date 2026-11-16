"""The Enable Banking adapter against the fake Enable Banking

Guards that the fake the dev instance and the browser tests sync with speaks what the adapter reads, so a
browser test that fails points at the app and not at a fake the adapter can't understand
"""

from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from app.services.bank_sync.outbound import OutboundGuard
from app.services.bank_sync.providers.contract import ClaimRefused, ProviderErrorKind
from app.services.bank_sync.providers.enable_banking import adapter as adapter_module
from tests.fake_enable_banking import app
from tests.services.bank_sync.providers.enable_banking.stand_ins import ENABLE_BANKING_ORIGIN, REDIRECT_URL
from tests.services.bank_sync.stand_ins import PUBLIC_ADDRESS, FixedResolver

_EXPONENTS = {"EUR": 2}


def _adapter(transport: httpx.AsyncBaseTransport) -> adapter_module.EnableBankingAdapter:
    """Return an adapter whose requests go to the fake only"""
    return adapter_module.EnableBankingAdapter(
        OutboundGuard([ENABLE_BANKING_ORIGIN], resolve=FixedResolver(PUBLIC_ADDRESS), transport=transport)
    )


def _supplied(scenario: dict) -> dict[str, str]:
    """Return the fields a user would fill in for a scenario"""
    return {
        "application_id": scenario["application_id"],
        "private_key": scenario["private_key"],
        "country": scenario["country"],
        "bank": scenario["bank"],
    }


async def _connect(
    adapter: adapter_module.EnableBankingAdapter, browser: httpx.AsyncClient, scenario: dict, *, approve: bool = True
) -> str | None:
    """Start a sign-in, answer the bank's page as a browser would and, when approved, claim what the bank returned"""
    url = await adapter.start_authorization(_supplied(scenario), redirect_url=REDIRECT_URL, state="the-state")
    page = urlsplit(url).path
    redirect = await browser.get(f"{page}/{'approve' if approve else 'decline'}")
    query = parse_qs(urlsplit(redirect.headers["location"]).query)
    assert query["state"] == ["the-state"]
    if not approve:
        assert query["error"] == ["access_denied"]
        return None
    return await adapter.claim_authorized(_supplied(scenario), code=query["code"][0])


async def test_the_adapter_signs_in_claims_discovers_and_fetches_the_fakes_sample_scenario():
    """The sample connects through the bank's page, both accounts are found, the last 10 days import exactly, and the hold is pending"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://fake.test") as browser:
        scenario = (await browser.post("/control/scenarios/sample")).json()
        adapter = _adapter(transport)
        stored = await _connect(adapter, browser, scenario)

    assert stored is not None
    discovered = await adapter.discover(stored, currency_exponents=_EXPONENTS)
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    fetched = await adapter.fetch(
        stored,
        account_ids=[account.external_id for account in discovered.accounts],
        start=today - timedelta(days=10),
        end=today + timedelta(days=1),
        include_pending=True,
        timezone=UTC,
        currency_exponents=_EXPONENTS,
    )

    assert discovered.request_error is None
    assert [(account.name, account.balance, account.available_balance, account.institution_name) for account in discovered.accounts] == [
        ("Everyday", 241836, 231836, "Aurora Bank"),
        ("Visa Gold", -41240, None, "Aurora Bank"),
    ]
    assert fetched.request_error is None
    assert (fetched.account_errors, fetched.login_errors) == ({}, {})
    checking, card = fetched.accounts
    assert [(record.description, record.amount, record.pending) for record in checking.records] == [
        ("CARD PURCHASE BAKERY SOL", -575, False),
        ("SALARY BRIGHTWORKS OY", 320000, False),
        ("CARD PURCHASE STATION NORTH", -7210, False),
    ]
    assert [(record.description, record.amount, record.pending) for record in card.records] == [
        ("ONLINE SHOP PARCELPOINT", -12995, False),
        ("SUPERMARKET FRESH", -3200, True),
    ]


async def test_a_first_import_of_the_whole_history_limit_gets_what_a_bank_sharing_90_days_still_shares():
    """A first import of two years takes what a bank sharing only 90 days still shares, with no error

    Asking that bank for the exact dates would be refused. Every sample transaction falls in the last 90 days
    """
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://fake.test") as browser:
        scenario = (await browser.post("/control/scenarios/sample")).json()
        await browser.patch(f"/control/scenarios/{scenario['id']}", json={"history_days": 90})
        adapter = _adapter(transport)
        stored = await _connect(adapter, browser, scenario)

    assert stored is not None
    discovered = await adapter.discover(stored, currency_exponents=_EXPONENTS)
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    fetched = await adapter.fetch(
        stored,
        account_ids=[account.external_id for account in discovered.accounts],
        start=today - timedelta(days=730),
        end=today + timedelta(days=1),
        include_pending=False,
        timezone=UTC,
        currency_exponents=_EXPONENTS,
    )

    assert (fetched.request_error, fetched.account_errors) == (None, {})
    assert [len(account.records) for account in fetched.accounts] == [8, 4]


async def test_the_adapter_sees_a_declined_sign_in_and_an_unlisted_bank_the_fake_sets_up():
    """The bank's error reaches the app as no code to claim, and a bank the application doesn't list is refused by name"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://fake.test") as browser:
        scenario = (await browser.post("/control/scenarios/sample")).json()
        adapter = _adapter(transport)

        declined = await _connect(adapter, browser, scenario, approve=False)
        with pytest.raises(ClaimRefused, match="couldn't find"):
            await adapter.start_authorization({**_supplied(scenario), "bank": "Nowhere"}, redirect_url=REDIRECT_URL, state="s")

    assert declined is None


async def test_the_adapter_sees_an_expired_session_and_a_bank_asking_for_the_user_again():
    """The two controls the browser tests use reach the adapter as a rejected credential, which a reconnect answers"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://fake.test") as control:
        scenario = (await control.post("/control/scenarios/sample")).json()
        adapter = _adapter(transport)
        stored = await _connect(adapter, control, scenario)
        assert stored is not None
        await control.patch(
            f"/control/scenarios/{scenario['id']}/accounts/{scenario['account_ids'][0]}", json={"error": "ASPSP_PSU_ACTION_REQUIRED"}
        )
        waiting = await adapter.discover(stored, currency_exponents=_EXPONENTS)
        await control.post(f"/control/scenarios/{scenario['id']}/sessions/expire")
        expired = await adapter.discover(stored, currency_exponents=_EXPONENTS)

    assert waiting.request_error is not None
    assert waiting.request_error.kind is ProviderErrorKind.CREDENTIAL_REJECTED
    assert expired.request_error is not None
    assert expired.request_error.kind is ProviderErrorKind.CREDENTIAL_REJECTED


async def test_releasing_a_credential_ends_the_fakes_session():
    """Giving back a credential closes the session the sign-in made"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://fake.test") as control:
        scenario = (await control.post("/control/scenarios/sample")).json()
        adapter = _adapter(transport)
        stored = await _connect(adapter, control, scenario)
        assert stored is not None

        await adapter.release_credential(stored)
        sessions = (await control.get(f"/control/scenarios/{scenario['id']}/sessions")).json()

    assert [session["status"] for session in sessions] == ["CLOSED"]
