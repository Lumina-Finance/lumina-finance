"""Connecting Pluggy through the app's routes

Guards the whole path from the Connect dialogue's data to a saved connection: the providers list
carries everything the form shows, keys and items Pluggy accepts are saved encrypted and nothing else
of them is kept, and ones it rejects save nothing. The client secret must never reach a response or a log
"""

import json
import logging

import httpx
from sqlalchemy import select

from app.encryption import decrypt
from app.models.bank_connection import BankConnection
from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.support import _create_account
from tests.routes.support.bank_sync_helpers import _sign_up
from tests.services.bank_sync.fake_provider import use_adapter
from tests.services.bank_sync.providers.pluggy.stand_ins import (
    API_KEY,
    CLIENT_ID,
    CLIENT_SECRET,
    ITEM_ID,
    PluggyApi,
    account,
    item,
    pluggy_adapter,
)


async def _claim(client, headers, *, client_id: str = CLIENT_ID, client_secret: str = CLIENT_SECRET, item_ids: str = ITEM_ID) -> httpx.Response:
    """Claim an application's keys and items through the route"""
    return await client.post(
        "/bank-sync/connections",
        json={
            "provider": "pluggy",
            "credentials": {"client_id": client_id, "client_secret": client_secret, "item_ids": item_ids},
            "nickname": None,
        },
        headers=headers,
    )


async def _stored_connections() -> list[BankConnection]:
    """Return every stored connection"""
    async with TestSession() as session:
        return list(await session.scalars(select(BankConnection)))


def _serve_pluggy(monkeypatch) -> PluggyApi:
    """Install Pluggy, enabled and offered, over a stand-in holding a checking account and a credit card"""
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account("acc-chk"), account("acc-card", kind="CREDIT", name="Cartão Aurora", balance="80.00"))
    )
    use_adapter(monkeypatch, pluggy_adapter(api.transport))
    return api


async def test_providers_list_offers_pluggy_with_its_three_fields_and_steps(client, monkeypatch):
    """The Connect dialogue draws Pluggy's three fields, steps and length caps from this list alone"""
    _serve_pluggy(monkeypatch)
    headers, _ = await _sign_up(client)

    response = await client.get("/bank-sync/providers", headers=headers)

    assert response.status_code == 200, response.text
    [pluggy] = [provider for provider in response.json()["providers"] if provider["id"] == "pluggy"]
    assert pluggy == {
        "id": "pluggy",
        "name": "Pluggy",
        "site": "pluggy.ai",
        "description": "One Pluggy application reaches all your Brazilian banks.",
        "in_beta": True,
        "authorizes_at_bank": False,
        "credential_fields": [
            {
                "key": "client_id",
                "label": "Client ID",
                "placeholder": "Paste the client ID",
                "max_length": 128,
                "file_extension": None,
                "masked": True,
            },
            {
                "key": "client_secret",
                "label": "Client secret",
                "placeholder": "Paste the client secret",
                "max_length": 128,
                "file_extension": None,
                "masked": True,
            },
            {
                "key": "item_ids",
                "label": "Item IDs",
                "placeholder": "Paste the item IDs, separated by commas",
                "max_length": 1024,
                "file_extension": None,
                "masked": True,
            },
        ],
        "connect_steps": [
            "Sign in at dashboard.pluggy.ai, create an application and copy its client ID and client secret.",
            "Connect your banks at meu.pluggy.ai.",
            "Copy each bank's item ID from your application at dashboard.pluggy.ai.",
            "Paste them here. Lumina Finance uses them to read your accounts and never sees your bank login.",
        ],
        "connects_from": "settings",
        "offered": True,
        "advertises_history": False,
        "institution_limit": None,
        "institutions_in_use": [],
    }


async def test_claim_saves_the_connection_encrypted_and_lists_its_bank_accounts(client, monkeypatch, caplog):
    """All three entries are stored encrypted and alone, each bank account says which of the user's accounts could take it, no secret shows"""
    _serve_pluggy(monkeypatch)
    headers, user_id = await _sign_up(client)
    async with TestSession() as session:
        session.add(Currency(id="BRL", name="Brazilian Real", symbol="R$", minor_unit_exponent=2))
        await session.commit()
    everyday = await _create_account(client, headers, name="Everyday", currency="BRL")
    assert everyday.status_code == 201, everyday.text
    caplog.set_level(logging.DEBUG)

    response = await _claim(client, headers)
    listed = await client.get("/bank-sync/connections", headers=headers)

    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["provider"], body["provider_name"], body["provider_site"], body["server_label"]) == (
        "pluggy",
        "Pluggy",
        "pluggy.ai",
        "api.pluggy.ai",
    )
    assert [(found["external_id"], found["name"], found["institution_name"], found["currency"]) for found in body["accounts"]] == [
        ("acc-card", "Cartão Aurora", "Banco Aurora", "BRL"),
        ("acc-chk", "Conta Corrente", "Banco Aurora", "BRL"),
    ]
    assert body["accounts"][0]["eligible_account_ids"] == [everyday.json()["id"]]
    assert body["request_budget"] == {"limit": 100, "used": 2, "available_again_at": None, "held_by_provider": False}
    [connection] = await _stored_connections()
    assert connection.owner_id == user_id
    assert json.loads(decrypt(connection.credential_encrypted)) == {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "item_ids": [ITEM_ID],
    }
    for secret in (CLIENT_SECRET, API_KEY):
        for text in (response.text, listed.text, caplog.text, connection.credential_encrypted):
            assert secret not in text


async def test_claim_with_rejected_keys_says_to_check_both_and_saves_nothing(client, monkeypatch):
    """Pluggy turning the pair away is the user's to fix, so it is a refusal with where to look"""
    api = _serve_pluggy(monkeypatch)
    api.serve("/auth", '{"message": "Invalid credentials"}', 401)
    headers, _ = await _sign_up(client)

    refused = await _claim(client, headers)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == (
        "Pluggy rejected these keys. Please check the client ID and client secret of your Pluggy application and try again"
    )
    assert await _stored_connections() == []


async def test_claim_with_an_item_that_is_not_an_item_id_names_it_and_saves_nothing(client, monkeypatch):
    """An item ID mistyped in the form is refused by name before Pluggy is asked"""
    api = _serve_pluggy(monkeypatch)
    headers, _ = await _sign_up(client)

    refused = await _claim(client, headers, item_ids=f"{ITEM_ID}, not-an-item")

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == (
        '"not-an-item" doesn\'t look like a Pluggy item ID. '
        "Please copy each whole item ID from your application at dashboard.pluggy.ai and try again"
    )
    assert api.requests == []
    assert await _stored_connections() == []


async def test_claim_with_a_blank_field_names_the_field_and_the_site(client, monkeypatch):
    """A field left empty is refused by the engine before Pluggy is asked, in words that name the field and where to copy it"""
    api = _serve_pluggy(monkeypatch)
    headers, _ = await _sign_up(client)

    refused = await _claim(client, headers, item_ids="  ")

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Please paste the item IDs from pluggy.ai"
    assert api.requests == []


async def test_claim_when_pluggy_cannot_be_reached_saves_nothing_and_leaves_the_entry_usable(client, monkeypatch):
    """A busy Pluggy is not the keys' fault, so the same entry works once it recovers"""
    api = _serve_pluggy(monkeypatch)
    api.serve("/auth", '{"message": "Try later"}', 503)
    headers, _ = await _sign_up(client)

    refused = await _claim(client, headers)
    api.serve_sign_in()
    retried = await _claim(client, headers)

    assert refused.status_code == 502, refused.text
    assert refused.json()["detail"] == "Lumina Finance couldn't reach Pluggy. Please try again in a few minutes"
    assert retried.status_code == 201, retried.text
    assert len(await _stored_connections()) == 1
