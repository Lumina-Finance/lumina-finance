"""Connecting Lunch Flow through the app's routes

Guards the whole path from the Connect dialogue's data to a saved connection: the providers list
carries everything the form shows, a key Lunch Flow accepts is saved encrypted and nothing else
of it is kept. The key is a secret that must never reach a response or a log. What a key Lunch Flow
refuses or can't answer for is told is tested once, at the adapter in `test_claim.py`
"""

import logging

import httpx
from sqlalchemy import select

from app.encryption import decrypt
from app.models.bank_connection import BankConnection
from tests.conftest import TestSession
from tests.routes.support import _create_account
from tests.routes.support.bank_sync_helpers import _sign_up
from tests.services.bank_sync.fake_provider import use_adapter
from tests.services.bank_sync.providers.lunchflow.stand_ins import API_KEY, LunchFlowApi, account, accounts_body, lunchflow_adapter


async def _claim(client, headers, api_key: str, nickname: str | None = None) -> httpx.Response:
    """Claim an API key through the route"""
    return await client.post(
        "/bank-sync/connections",
        json={"provider": "lunchflow", "credentials": {"api_key": api_key}, "nickname": nickname},
        headers=headers,
    )


async def _stored_connections() -> list[BankConnection]:
    """Return every stored connection"""
    async with TestSession() as session:
        return list(await session.scalars(select(BankConnection)))


def _serve_lunchflow(monkeypatch) -> LunchFlowApi:
    """Install Lunch Flow, enabled and offered, over a stand-in holding a chequing account and a savings account"""
    chequing = account(11)
    savings = account(12, name="Online Savings", currency="USD")
    api = LunchFlowApi().serve("/accounts", accounts_body(chequing, savings)).serve_account(chequing).serve_account(savings)
    use_adapter(monkeypatch, lunchflow_adapter(api.transport))
    return api


async def test_providers_list_offers_lunch_flow_with_its_api_key_steps(client, monkeypatch):
    """The Connect dialogue draws Lunch Flow's field, steps and length cap from this list alone"""
    _serve_lunchflow(monkeypatch)
    headers, _ = await _sign_up(client)

    response = await client.get("/bank-sync/providers", headers=headers)

    assert response.status_code == 200, response.text
    [lunchflow] = [provider for provider in response.json()["providers"] if provider["id"] == "lunchflow"]
    assert (lunchflow["name"], lunchflow["connects_from"], lunchflow["offered"], lunchflow["authorizes_at_bank"]) == (
        "Lunch Flow",
        "settings",
        True,
        False,
    )

    # The dialogue draws the form from the field's structure and the limit the claim itself enforces
    [field] = lunchflow["credential_fields"]
    assert set(field) == {"key", "label", "placeholder", "max_length", "file_extension", "masked"}
    assert (field["key"], field["max_length"], field["file_extension"], field["masked"]) == ("api_key", 512, None, True)
    assert all(isinstance(field[name], str) and field[name] for name in ("label", "placeholder"))
    assert lunchflow["connect_steps"]
    assert all(isinstance(step, str) and step for step in lunchflow["connect_steps"])


async def test_claim_saves_the_connection_encrypted_and_lists_its_bank_accounts(client, monkeypatch, caplog):
    """The key is stored encrypted and alone, each bank account says which of the user's accounts could take it, and no secret is shown"""
    _serve_lunchflow(monkeypatch)
    headers, user_id = await _sign_up(client)
    everyday = await _create_account(client, headers, name="Everyday", currency="CAD")
    assert everyday.status_code == 201, everyday.text
    caplog.set_level(logging.DEBUG)

    response = await _claim(client, headers, API_KEY, nickname="Joint")
    listed = await client.get("/bank-sync/connections", headers=headers)

    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["provider"], body["provider_name"], body["provider_site"], body["server_label"]) == (
        "lunchflow",
        "Lunch Flow",
        "Lunch Flow",
        "www.lunchflow.app",
    )
    assert [(found["external_id"], found["name"], found["institution_name"], found["currency"]) for found in body["accounts"]] == [
        ("11", "Everyday Chequing", "Harbour Bank", "CAD"),
        ("12", "Online Savings", "Harbour Bank", "USD"),
    ]
    assert body["accounts"][0]["eligible_account_ids"] == [everyday.json()["id"]]
    assert body["request_budget"] == {"limit": 24, "used": 2, "available_again_at": None, "held_by_provider": False}
    [connection] = await _stored_connections()
    assert connection.owner_id == user_id
    assert decrypt(connection.credential_encrypted) == API_KEY
    for text in (response.text, listed.text, caplog.text, connection.credential_encrypted):
        assert API_KEY not in text


async def test_claim_with_a_bank_needing_reconnection_in_lunch_flow_saves_and_lists_the_rest(client, monkeypatch):
    """An account whose bank needs reconnecting is left out rather than stored without a currency

    Lunch Flow's live account list sends no currency, and only an active account's balance gives one
    """
    chequing = account(11, connection_id=7, currency=None)
    expired = account(12, connection_id=9, name="Old Savings", currency=None, status="EXPIRED")
    api = LunchFlowApi().serve("/accounts", accounts_body(chequing, expired)).serve_account(chequing)
    use_adapter(monkeypatch, lunchflow_adapter(api.transport))
    headers, _ = await _sign_up(client)

    response = await _claim(client, headers, API_KEY)

    assert response.status_code == 201, response.text
    assert [(found["external_id"], found["currency"]) for found in response.json()["accounts"]] == [("11", "CAD")]
    assert len(await _stored_connections()) == 1
