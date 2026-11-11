"""Claiming a SimpleFIN setup token as a new connection

A setup token claims once, so a refusal that saves a connection, or an unreachable Bridge read as a
used token, costs the user a new token. The token, its claim URL and the Access URL are secrets that
must never reach a response, a log or the database in the clear
"""

import asyncio
import base64
import logging
import uuid

import httpx
import pytest
from sqlalchemy import select

from app.encryption import decrypt
from app.models.bank_connection import BankProviderRequest
from app.models.bank_sync_job import BankSyncJob
from tests.conftest import TestSession
from tests.routes.support import _create_account
from tests.routes.support.bank_sync_helpers import _changed_at, _sign_up, _stored_connections
from tests.services.bank_sync.fake_provider import use_adapter
from tests.services.bank_sync.providers.simplefin.stand_ins import AccountsTimeOut, FakeBridgeScenario, PausedBridge, simplefin_adapter

_ALREADY_USED = "This setup token has already been used. Please create a new one in SimpleFIN Bridge"
_TOO_LONG = "That setup token is too long. Please copy only the setup token from SimpleFIN Bridge and try again"
_UNREACHABLE = "SimpleFIN Bridge couldn't be reached. Please try again in a few minutes"


async def _claim(client, headers, setup_token: str, nickname: str | None = None) -> httpx.Response:
    """Claim a setup token through the route"""
    return await client.post(
        "/bank-sync/connections",
        json={"provider": "simplefin", "credentials": {"setup_token": setup_token}, "nickname": nickname},
        headers=headers,
    )


async def test_claim_with_a_fresh_token_saves_the_connection_and_lists_its_bank_accounts(client, scenario: FakeBridgeScenario):
    """Joint is saved, discovery finds 3 bank accounts, and each says which of the user's accounts could take it"""
    headers, user_id = await _sign_up(client)
    everyday = await _create_account(client, headers, name="Everyday", currency="USD")
    assert everyday.status_code == 201, everyday.text
    everyday_id = everyday.json()["id"]
    await scenario.add_harbour_accounts()

    response = await _claim(client, headers, scenario.setup_token, nickname="  Joint  ")

    assert response.status_code == 201, response.text
    body = response.json()
    stored = await _stored_connections()
    assert [connection.id for connection in stored] == [uuid.UUID(body["id"])]
    assert body == {
        "id": body["id"],
        "provider": "simplefin",
        "provider_name": "SimpleFIN",
        "provider_site": "SimpleFIN Bridge",
        "provider_available": True,
        "nickname": "Joint",
        "server_label": "beta-bridge.simplefin.org",
        "created_at": body["created_at"],
        "status": "active",
        "accounts": [
            {
                "external_id": external_id,
                "name": name,
                "institution_name": institution,
                "currency": "USD",
                "custom_currency": False,
                "linked_account_id": None,
                "eligible_account_ids": [everyday_id],
                "signin_needed": False,
            }
            for external_id, name, institution in [
                ("ACT-chequing", "Everyday Chequing", "Harbour Bank"),
                ("ACT-savings", "Online Savings", "Harbour Bank"),
                ("ACT-visa", "Rewards Visa", "Harbourline Card Services"),
            ]
        ],
        "choose_again_links": [],
        "discovery_pending": False,
        "request_budget": {"limit": 20, "used": 1, "available_again_at": None, "held_by_provider": False},
    }
    assert stored[0].owner_id == user_id
    async with TestSession() as session:
        purposes = (await session.scalars(select(BankProviderRequest.purpose).order_by(BankProviderRequest.purpose))).all()
    assert purposes == ["discovery"]


async def test_claim_stores_the_access_url_encrypted_and_never_shows_a_secret(client, scenario: FakeBridgeScenario, caplog):
    """Neither the setup token, its claim URL nor the Access URL appears in a response or a log, even at DEBUG"""
    headers, _ = await _sign_up(client)
    await scenario.add_harbour_accounts()
    claim_url = base64.b64decode(scenario.setup_token).decode()
    caplog.set_level(logging.DEBUG)

    claimed = await _claim(client, headers, scenario.setup_token)
    reused = await _claim(client, headers, scenario.setup_token)
    listed = await client.get("/bank-sync/connections", headers=headers)

    assert claimed.status_code == 201, claimed.text
    assert reused.status_code == 422, reused.text
    assert listed.status_code == 200, listed.text
    [connection] = await _stored_connections()
    access_url = decrypt(connection.credential_encrypted)
    assert access_url.startswith("https://") and "@beta-bridge.simplefin.org/" in access_url
    assert access_url not in connection.credential_encrypted
    secrets = [scenario.setup_token, claim_url, access_url, access_url.split("@")[0]]
    for secret in secrets:
        for text in (claimed.text, reused.text, listed.text, caplog.text):
            assert secret not in text


async def test_claim_whose_discovery_fails_keeps_the_connection_and_queues_discovery(client, scenario: FakeBridgeScenario, monkeypatch):
    """The token is spent, so the connection is saved, and its bank accounts appear once a job discovers them"""
    use_adapter(monkeypatch, simplefin_adapter(AccountsTimeOut()))
    headers, _ = await _sign_up(client)
    await scenario.add_harbour_accounts()

    response = await _claim(client, headers, scenario.setup_token, nickname="Joint")
    listed = await client.get("/bank-sync/connections", headers=headers)

    assert response.status_code == 201, response.text
    assert response.json()["accounts"] == []
    assert response.json()["discovery_pending"] is True
    assert response.json()["request_budget"] == {"limit": 20, "used": 1, "available_again_at": None, "held_by_provider": False}
    assert listed.status_code == 200, listed.text
    assert [(connection["nickname"], connection["discovery_pending"]) for connection in listed.json()] == [("Joint", True)]
    async with TestSession() as session:
        jobs = (await session.execute(select(BankSyncJob.connection_id, BankSyncJob.kind, BankSyncJob.discover, BankSyncJob.status))).all()
    assert [tuple(job) for job in jobs] == [(uuid.UUID(response.json()["id"]), "retry", True, "queued")]


async def test_claim_marks_the_cache_changed_again_once_it_has_stored_the_bank_accounts(client, scenario: FakeBridgeScenario, monkeypatch):
    """The connection is committed before SimpleFIN lists its bank accounts, so storing them marks the cache again"""
    headers, _ = await _sign_up(client)
    await scenario.add_harbour_accounts()
    before = await _changed_at(client, headers)
    paused = PausedBridge("/accounts")
    use_adapter(monkeypatch, simplefin_adapter(paused))

    async with asyncio.timeout(10):
        claiming = asyncio.create_task(_claim(client, headers, scenario.setup_token))
        await paused.reached.wait()
        while_listing = await _changed_at(client, headers)
        paused.release.set()
        response = await claiming

    assert response.status_code == 201, response.text
    assert while_listing != before
    assert await _changed_at(client, headers) != while_listing


async def test_claim_with_a_used_token_is_refused_and_saves_nothing_more(client, scenario: FakeBridgeScenario):
    """The same token pasted again is refused as already used"""
    headers, _ = await _sign_up(client)
    first = await _claim(client, headers, scenario.setup_token)
    assert first.status_code == 201, first.text

    again = await _claim(client, headers, scenario.setup_token)

    assert again.status_code == 422, again.text
    assert again.json()["detail"] == _ALREADY_USED
    assert len(await _stored_connections()) == 1


async def test_claim_when_the_bridge_answers_with_an_error_page_saves_nothing_and_leaves_the_token_usable(client, scenario: FakeBridgeScenario):
    """An error page, even a 403 one, reads as the Bridge being unreachable, and the same token works once it recovers"""
    headers, _ = await _sign_up(client)
    await scenario.change("PUT", "/fault", {"kind": "html_error"})

    refused = await _claim(client, headers, scenario.setup_token)

    assert refused.status_code == 502, refused.text
    assert refused.json()["detail"] == _UNREACHABLE
    assert await _stored_connections() == []

    await scenario.change("DELETE", "/fault")
    retried = await _claim(client, headers, scenario.setup_token)
    assert retried.status_code == 201, retried.text


@pytest.mark.parametrize(
    ("setup_token", "detail"),
    [
        ("   ", "Please paste the setup token from SimpleFIN Bridge"),
        (
            "not a setup token",
            "That doesn't look like a SimpleFIN setup token. Please copy the whole token from SimpleFIN Bridge and try again",
        ),
        (
            base64.b64encode(b"https://bridge.evil.example/simplefin/claim/abc").decode(),
            "This setup token points to bridge.evil.example. This Lumina Finance server isn't set up to contact bridge.evil.example",
        ),
    ],
    ids=["blank", "malformed", "origin-not-allowed"],
)
async def test_claim_with_a_token_that_cant_be_claimed_says_why(client, setup_token, detail):
    """A blank or malformed token, or one pointing outside the allowlist, is refused before anything is sent"""
    headers, _ = await _sign_up(client)

    refused = await _claim(client, headers, setup_token)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == detail
    assert await _stored_connections() == []


@pytest.mark.parametrize(("encoded_length", "too_long"), [(2048, False), (2052, True)], ids=["at-the-cap", "over-the-cap"])
async def test_claim_with_a_token_over_the_length_cap_is_refused_before_anything_is_sent(
    client, scenario: FakeBridgeScenario, encoded_length, too_long
):
    """A token of 2,052 characters that decodes to a claim URL is refused with a sentence, one of 2,048 is not, and a real token still claims"""
    headers, _ = await _sign_up(client)
    prefix = b"https://beta-bridge.simplefin.org/simplefin/claim/"
    token = base64.b64encode(prefix + b"a" * (encoded_length // 4 * 3 - len(prefix))).decode()
    assert len(token) == encoded_length

    refused = await _claim(client, headers, token)
    claimed = await _claim(client, headers, scenario.setup_token)

    assert (refused.json().get("detail") == _TOO_LONG) is too_long, refused.text
    assert claimed.status_code == 201, claimed.text


async def test_providers_list_offers_simplefin_with_its_setup_token_steps(client):
    """The Connect dialogue shows SimpleFIN's own field label, steps and length cap, all sent by the server"""
    headers, _ = await _sign_up(client)

    response = await client.get("/bank-sync/providers", headers=headers)

    assert response.status_code == 200, response.text
    [simplefin] = [provider for provider in response.json()["providers"] if provider["id"] == "simplefin"]
    assert simplefin["site"] == "SimpleFIN Bridge"
    assert simplefin["credential_fields"] == [
        {"key": "setup_token", "label": "Setup token", "placeholder": "Paste the token", "max_length": 2048}
    ]
    assert simplefin["connect_steps"][0] == "Open SimpleFIN Bridge and connect your banks there."
