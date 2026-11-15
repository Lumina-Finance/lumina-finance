"""The Pluggy adapter against the fake Pluggy

Guards that the fake the dev instance and the browser tests sync with speaks what the adapter reads,
so a browser test that fails points at the app and not at a fake the adapter can't understand
"""

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.services.bank_sync.providers.contract import ClaimRefused
from tests.fake_pluggy import app
from tests.services.bank_sync.providers.pluggy.stand_ins import pluggy_adapter


async def test_the_adapter_claims_discovers_and_fetches_the_fakes_sample_scenario():
    """The sample's keys claim, both accounts are found with their balances, the last 10 days import exactly, and the hold shows as pending"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://fake.test") as control:
        scenario = (await control.post("/control/scenarios/sample")).json()
    adapter = pluggy_adapter(transport)

    stored = await adapter.claim(
        {"client_id": scenario["client_id"], "client_secret": scenario["client_secret"], "item_ids": ", ".join(scenario["item_ids"])}
    )
    discovered = await adapter.discover(stored, currency_exponents={"BRL": 2, "USD": 2})
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    fetched = await adapter.fetch(
        stored,
        account_ids=[account.external_id for account in discovered.accounts],
        start=today - timedelta(days=10),
        end=today + timedelta(days=1),
        include_pending=True,
        timezone=UTC,
        currency_exponents={"BRL": 2, "USD": 2},
    )

    assert discovered.request_error is None
    assert [(account.name, account.balance, account.institution_name) for account in discovered.accounts] == [
        ("Conta Corrente", 421836, "Pluggy Bank"),
        ("Cartão Pluggy Gold", -161240, "Pluggy Bank"),
    ]
    assert len({account.login_key for account in discovered.accounts}) == 1
    assert fetched.request_error is None
    assert fetched.account_errors == {}
    assert fetched.login_errors == {}
    checking, card = fetched.accounts
    assert [(record.description, record.amount, record.pending) for record in checking.records] == [
        ("COMPRA DEBITO PADARIA SOL NASCENTE", -1575, False),
        ("SALARIO BRIGHTWORKS LTDA", 650000, False),
        ("COMPRA DEBITO POSTO NORTE", -17210, False),
    ]
    assert [(record.description, record.amount, record.pending) for record in card.records] == [
        ("LOJA ONLINE PARCELPOINT", -32995, False),
        ("CLOUDHOST SUBSCRIPTION", -20874, False),
        ("SUPERMERCADO FRESCOR", -6200, True),
    ]


@pytest.mark.parametrize(
    "keys",
    [
        {"client_id": "5b1c9a3e-77d2-4f0a-8c14-0e6d2a9b3f58", "client_secret": "unknown"},
        {"client_id": "not-a-uuid", "client_secret": "unknown"},
    ],
    ids=["unknown-pair-401", "client-id-not-a-uuid-400"],
)
async def test_the_adapter_reports_keys_the_fake_does_not_know_as_refused(keys):
    """The fake answers an unknown pair with Pluggy's 401 and a client ID that isn't a UUID with its 400, and either is a rejected key"""
    adapter = pluggy_adapter(httpx.ASGITransport(app=app))

    with pytest.raises(ClaimRefused) as refusal:
        await adapter.claim({**keys, "item_ids": "0b6f3c2e-91a4-4c7d-8e55-2d1a7f9b4c10"})

    assert str(refusal.value).startswith("Pluggy rejected these keys.")


async def test_the_adapter_names_an_item_the_fake_does_not_have():
    """The fake answers an item that isn't the application's with Pluggy's 404 ITEM_NOT_FOUND, and the claim names that item"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://fake.test") as control:
        scenario = (await control.post("/control/scenarios/sample")).json()
    unknown = "0b6f3c2e-91a4-4c7d-8e55-2d1a7f9b4c10"

    known = scenario["item_ids"][0]

    with pytest.raises(ClaimRefused) as refusal:
        await pluggy_adapter(transport).claim(
            {"client_id": scenario["client_id"], "client_secret": scenario["client_secret"], "item_ids": f"{known}, {unknown}"}
        )

    assert unknown in str(refusal.value)
    assert known not in str(refusal.value)


async def test_the_adapter_reads_every_transaction_of_an_account_the_fake_pages_by_opaque_cursor():
    """With a page of two, the fake's cursors hold only the account and a base64 position, and the adapter still reads every row"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://fake.test") as control:
        scenario = (await control.post("/control/scenarios/sample")).json()
        await control.patch(f"/control/scenarios/{scenario['id']}", json={"page_size": 2})
    adapter = pluggy_adapter(transport)
    stored = await adapter.claim(
        {"client_id": scenario["client_id"], "client_secret": scenario["client_secret"], "item_ids": scenario["item_ids"][0]}
    )
    discovered = await adapter.discover(stored, currency_exponents={"BRL": 2, "USD": 2})
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)

    fetched = await adapter.fetch(
        stored,
        account_ids=[account.external_id for account in discovered.accounts],
        start=today - timedelta(days=40),
        end=today + timedelta(days=1),
        include_pending=True,
        timezone=UTC,
        currency_exponents={"BRL": 2, "USD": 2},
    )

    assert fetched.possibly_cut_off is False
    assert [len(account.records) for account in fetched.accounts] == [8, 6]


async def test_the_adapter_sees_a_login_error_and_a_revoked_secret_the_fake_sets_up():
    """The two controls the browser tests use reach the adapter as a reconnect for the item and as rejected keys"""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://fake.test") as control:
        scenario = (await control.post("/control/scenarios/sample")).json()
        adapter = pluggy_adapter(transport)
        stored = await adapter.claim(
            {"client_id": scenario["client_id"], "client_secret": scenario["client_secret"], "item_ids": scenario["item_ids"][0]}
        )
        await control.patch(
            f"/control/scenarios/{scenario['id']}/items/{scenario['item_ids'][0]}",
            json={"status": "LOGIN_ERROR", "execution_status": "INVALID_CREDENTIALS"},
        )
        waiting = await adapter.discover(stored, currency_exponents={"BRL": 2})
        await control.delete(f"/control/scenarios/{scenario['id']}/secret")
        revoked = await adapter.discover(stored, currency_exponents={"BRL": 2})

    assert set(waiting.login_errors) == set(scenario["item_ids"])
    assert revoked.request_error is not None
    assert revoked.request_error.kind.name == "CREDENTIAL_REJECTED"
