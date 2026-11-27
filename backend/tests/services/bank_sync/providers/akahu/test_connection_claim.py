"""Connecting Akahu through the app's routes

Guards the whole path from the Connect dialogue's data to a saved connection: the providers list
carries everything the form shows, tokens Akahu accepts are saved encrypted and nothing else of them
is kept, and tokens it rejects save nothing. The tokens are secrets that must never reach a response
or a log
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
from tests.services.bank_sync.providers.akahu.stand_ins import (
    APP_ID_TOKEN,
    USER_ACCESS_TOKEN,
    AkahuApi,
    account,
    accounts_body,
    akahu_adapter,
)


async def _claim(client, headers, *, app_id_token: str = APP_ID_TOKEN, user_access_token: str = USER_ACCESS_TOKEN) -> httpx.Response:
    """Claim a pair of tokens through the route"""
    return await client.post(
        "/bank-sync/connections",
        json={"provider": "akahu", "credentials": {"app_id_token": app_id_token, "user_access_token": user_access_token}, "nickname": None},
        headers=headers,
    )


async def _stored_connections() -> list[BankConnection]:
    """Return every stored connection"""
    async with TestSession() as session:
        return list(await session.scalars(select(BankConnection)))


def _serve_akahu(monkeypatch) -> AkahuApi:
    """Install Akahu, enabled and offered, over a stand-in holding a chequing account and a savings account"""
    api = AkahuApi().serve_me().serve("/accounts", accounts_body(account("acc_chq"), account("acc_sav", name="Online Savings", currency="USD")))
    use_adapter(monkeypatch, akahu_adapter(api.transport))
    return api


async def test_providers_list_offers_akahu_with_its_two_token_fields_and_steps(client, monkeypatch):
    """The Connect dialogue draws Akahu's two fields, steps and length caps from this list alone"""
    _serve_akahu(monkeypatch)
    headers, _ = await _sign_up(client)

    response = await client.get("/bank-sync/providers", headers=headers)

    assert response.status_code == 200, response.text
    [akahu] = [provider for provider in response.json()["providers"] if provider["id"] == "akahu"]
    assert akahu == {
        "id": "akahu",
        "name": "Akahu",
        "site": "my.akahu.nz",
        "description": "Lumina Finance reads the accounts you connect to your Akahu personal app.",
        "in_beta": True,
        "authorizes_at_bank": False,
        "credential_fields": [
            {
                "key": "app_id_token",
                "label": "App ID token",
                "placeholder": "Paste the token",
                "max_length": 512,
                "file_extension": None,
                "masked": True,
            },
            {
                "key": "user_access_token",
                "label": "User access token",
                "placeholder": "Paste the token",
                "max_length": 512,
                "file_extension": None,
                "masked": True,
            },
        ],
        "connect_steps": [
            "Sign in at my.akahu.nz, open Developers and create a personal app.",
            "Connect your bank accounts in the app, then copy its app ID token and user access token.",
            "Paste them here. Lumina Finance uses them to read your accounts and never sees your bank login.",
        ],
        "connects_from": "settings",
        "offered": True,
        "advertises_history": False,
        "institution_limit": None,
        "institutions_in_use": [],
    }


async def test_claim_saves_the_connection_encrypted_and_lists_its_bank_accounts(client, monkeypatch, caplog):
    """Both tokens are stored encrypted and alone, each bank account says which of the user's accounts could take it, and no secret is shown"""
    _serve_akahu(monkeypatch)
    headers, user_id = await _sign_up(client)
    async with TestSession() as session:
        session.add(Currency(id="NZD", name="New Zealand Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()
    everyday = await _create_account(client, headers, name="Everyday", currency="NZD")
    assert everyday.status_code == 201, everyday.text
    caplog.set_level(logging.DEBUG)

    response = await _claim(client, headers)
    listed = await client.get("/bank-sync/connections", headers=headers)

    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["provider"], body["provider_name"], body["provider_site"], body["server_label"]) == (
        "akahu",
        "Akahu",
        "my.akahu.nz",
        "api.akahu.io",
    )
    assert [(found["external_id"], found["name"], found["institution_name"], found["currency"]) for found in body["accounts"]] == [
        ("acc_chq", "Everyday Chequing", "Harbour Bank", "NZD"),
        ("acc_sav", "Online Savings", "Harbour Bank", "USD"),
    ]
    assert body["accounts"][0]["eligible_account_ids"] == [everyday.json()["id"]]
    assert body["request_budget"] == {"limit": 24, "used": 2, "available_again_at": None, "held_by_provider": False}
    [connection] = await _stored_connections()
    assert connection.owner_id == user_id
    assert json.loads(decrypt(connection.credential_encrypted)) == {"app_id_token": APP_ID_TOKEN, "user_access_token": USER_ACCESS_TOKEN}
    for secret in (APP_ID_TOKEN, USER_ACCESS_TOKEN):
        for text in (response.text, listed.text, caplog.text, connection.credential_encrypted):
            assert secret not in text


async def test_claim_with_rejected_tokens_says_to_check_both_and_saves_nothing(client, monkeypatch):
    """Akahu turning the pair away is the user's to fix, so it is a refusal with where to look"""
    api = _serve_akahu(monkeypatch)
    api.serve("/me", '{"success": false, "message": "Invalid token"}', 401)
    headers, _ = await _sign_up(client)

    refused = await _claim(client, headers)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == (
        "Akahu rejected these tokens. Please check both the app ID token and the user access token in your Akahu personal app and try again"
    )
    assert await _stored_connections() == []


async def test_claim_with_a_blank_token_names_the_field_and_the_site(client, monkeypatch):
    """A field left empty is refused by the engine before Akahu is asked, in words that name the token and where to copy it"""
    api = _serve_akahu(monkeypatch)
    headers, _ = await _sign_up(client)

    refused = await _claim(client, headers, app_id_token="  ")

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Please paste the app ID token from my.akahu.nz"
    assert api.requests == []


async def test_claim_when_akahu_cannot_be_reached_saves_nothing_and_leaves_the_tokens_usable(client, monkeypatch):
    """A busy Akahu is not the tokens' fault, so the same pair works once it recovers"""
    api = _serve_akahu(monkeypatch)
    api.serve("/me", '{"success": false, "message": "Try later"}', 503)
    headers, _ = await _sign_up(client)

    refused = await _claim(client, headers)
    api.serve_me()
    retried = await _claim(client, headers)

    assert refused.status_code == 502, refused.text
    assert refused.json()["detail"] == "Lumina Finance couldn't reach Akahu. Please try again in a few minutes"
    assert retried.status_code == 201, retried.text
    assert len(await _stored_connections()) == 1
