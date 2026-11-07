"""Connecting Lunch Flow through the app's routes

Guards the whole path from the Connect dialogue's data to a saved connection: the providers list
carries everything the form shows, a key Lunch Flow accepts is saved encrypted and nothing else
of it is kept, and a key it rejects saves nothing. The key is a secret that must never reach a
response or a log
"""

import logging

import httpx
import pytest
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
    assert lunchflow == {
        "id": "lunchflow",
        "name": "Lunch Flow",
        "site": "Lunch Flow",
        "description": "One API key reaches every bank you connect in Lunch Flow.",
        "in_beta": True,
        "credential_fields": [{"key": "api_key", "label": "API key", "placeholder": "Paste the key", "max_length": 512}],
        "connect_steps": [
            "Open Lunch Flow and connect your banks there.",
            "Add an API destination and copy its key.",
            "Paste it here. Lumina Finance uses it to read your accounts and never sees your bank login.",
        ],
        "connects_from": "settings",
        "offered": True,
        "advertises_history": False,
        "institution_limit": None,
        "institutions_in_use": [],
    }


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
    assert body["request_budget"] == {"limit": 100, "used": 2, "available_again_at": None, "held_by_provider": False}
    [connection] = await _stored_connections()
    assert connection.owner_id == user_id
    assert decrypt(connection.credential_encrypted) == API_KEY
    for text in (response.text, listed.text, caplog.text, connection.credential_encrypted):
        assert API_KEY not in text


@pytest.mark.parametrize("status", [401, 403])
async def test_claim_with_a_rejected_key_says_to_create_a_new_one_and_saves_nothing(client, monkeypatch, status):
    """Lunch Flow turning the key away is the user's to fix, so it is a refusal on the field with the way to make another"""
    api = _serve_lunchflow(monkeypatch)
    api.serve("/accounts", '{"error": "Unauthorized", "message": "Invalid API key"}', status)
    headers, _ = await _sign_up(client)

    refused = await _claim(client, headers, API_KEY)

    assert refused.status_code == 422, refused.text
    assert (
        refused.json()["detail"] == "Lunch Flow rejected this API key. Please create a new key in your Lunch Flow API destination and try again"
    )
    assert await _stored_connections() == []


async def test_claim_when_lunch_flow_cannot_be_reached_saves_nothing_and_leaves_the_key_usable(client, monkeypatch):
    """A busy Lunch Flow is not the key's fault, so the same key works once it recovers"""
    api = _serve_lunchflow(monkeypatch)
    api.serve("/accounts", '{"error": "Unavailable", "message": "Try later"}', 503)
    headers, _ = await _sign_up(client)

    refused = await _claim(client, headers, API_KEY)
    api.serve("/accounts", accounts_body(account(11)))
    retried = await _claim(client, headers, API_KEY)

    assert refused.status_code == 502, refused.text
    assert refused.json()["detail"] == "There was no answer from Lunch Flow. Please try again in a few minutes"
    assert retried.status_code == 201, retried.text
    assert len(await _stored_connections()) == 1
