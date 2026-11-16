"""Enable Banking sign-in tests

Guards what the user is told when an application's key or a bank can't be used, what the sign-in sends
(a signed token naming the application, the bank as Enable Banking lists it, the engine's state and
address), that the private key never travels except as that signature, and what is stored once the bank
sends the user back
"""

import json
import re
from datetime import UTC, datetime, timedelta

import httpx
import jwt
import pytest

from app.services.bank_sync.providers.contract import ClaimRefused, ProviderUnreachable
from tests.routes.support.bank_sync_helpers import _sign_up
from tests.services.bank_sync.fake_provider import use_adapter
from tests.services.bank_sync.providers.enable_banking.stand_ins import (
    APPLICATION_ID,
    BANK,
    CODE,
    COUNTRY,
    CREDENTIAL,
    EXPONENTS,
    HOLDER,
    PRIVATE_KEY,
    REDIRECT_URL,
    SESSION_ID,
    STATE,
    SUPPLIED,
    EnableBankingApi,
    aspsps_body,
    balance,
    balances_body,
    enable_banking_adapter,
    error_response,
    session_account,
)
from tests.services.bank_sync.stand_ins import fail_with


async def test_providers_list_has_the_private_key_field_take_its_pem_file(client, monkeypatch):
    """The connect form masks the private key and takes the .pem file dropped onto it, and only that field"""
    use_adapter(monkeypatch, enable_banking_adapter(EnableBankingApi().transport))
    headers, _ = await _sign_up(client)

    response = await client.get("/bank-sync/providers", headers=headers)

    assert response.status_code == 200, response.text
    [enable_banking] = [provider for provider in response.json()["providers"] if provider["id"] == "enable_banking"]
    assert {field["key"]: field["file_extension"] for field in enable_banking["credential_fields"]} == {
        "application_id": None,
        "private_key": ".pem",
        "country": None,
        "bank": None,
    }


async def test_providers_masks_the_application_and_key_and_shows_the_country_and_bank_as_typed(client, monkeypatch):
    """The application ID and key are secrets, and the country and bank are plain details the user reads back"""
    use_adapter(monkeypatch, enable_banking_adapter(EnableBankingApi().transport))
    headers, _ = await _sign_up(client)

    response = await client.get("/bank-sync/providers", headers=headers)

    assert response.status_code == 200, response.text
    [enable_banking] = [provider for provider in response.json()["providers"] if provider["id"] == "enable_banking"]
    assert {field["key"]: field["masked"] for field in enable_banking["credential_fields"]} == {
        "application_id": True,
        "private_key": True,
        "country": False,
        "bank": False,
    }


async def _start(api: EnableBankingApi, supplied=SUPPLIED) -> str:
    """Start a sign-in against the stand-in API"""
    return await enable_banking_adapter(api.transport).start_authorization(supplied, redirect_url=REDIRECT_URL, state=STATE)


async def test_start_signs_in_at_the_listed_bank_with_the_engines_state_and_address():
    """The bank is found by name in its country, and Enable Banking gets the state, the address and the consent the bank allows"""
    api = EnableBankingApi().serve_session()

    url = await _start(api)

    assert url == "https://bank.example/sign-in?x=1"
    assert api.paths() == ["GET /aspsps", "POST /auth"]
    assert api.requests[0].url.params["country"] == "FI"
    sent = json.loads(api.requests[1].content)
    assert sent["aspsp"] == {"name": BANK, "country": "FI"}
    assert (sent["state"], sent["redirect_url"], sent["psu_type"]) == (STATE, REDIRECT_URL, "personal")
    valid_until = datetime.fromisoformat(sent["access"]["valid_until"])
    assert timedelta(days=89) < valid_until - datetime.now(UTC) <= timedelta(days=90)


@pytest.mark.parametrize(("seconds", "days"), [(30 * 86400, 30), (None, 90), (0, 90)], ids=["30 days", "none named", "zero"])
async def test_start_asks_for_the_consent_the_bank_allows_or_90_days_when_it_names_none(seconds, days):
    """A bank allowing less than 90 days would refuse a longer consent, and one naming no length is asked for 90 days"""
    api = EnableBankingApi().serve_session().serve("GET", "/aspsps", aspsps_body((BANK, COUNTRY, seconds)))

    await _start(api)

    valid_until = datetime.fromisoformat(json.loads(api.requests[1].content)["access"]["valid_until"])
    assert timedelta(days=days - 1) < valid_until - datetime.now(UTC) <= timedelta(days=days)


async def test_start_caps_the_consent_at_six_months():
    """A bank that allows a longer consent is asked for 180 days"""
    api = EnableBankingApi().serve_session().serve("GET", "/aspsps", aspsps_body((BANK, COUNTRY, 365 * 86400)))

    await _start(api)

    valid_until = datetime.fromisoformat(json.loads(api.requests[1].content)["access"]["valid_until"])
    assert timedelta(days=179) < valid_until - datetime.now(UTC) <= timedelta(days=180)


async def test_start_proves_the_application_with_a_token_and_never_sends_the_key():
    """Every request carries a token the application's key signed, naming the application, and the key itself goes nowhere"""
    api = EnableBankingApi().serve_session()

    await _start(api)

    for request in api.requests:
        token = request.headers["authorization"].removeprefix("Bearer ")
        assert jwt.get_unverified_header(token) == {"alg": "RS256", "typ": "JWT", "kid": APPLICATION_ID}
        assert request.headers["host"] == "api.enablebanking.com"
        assert "PRIVATE KEY" not in str(request.url) + request.content.decode()
    assert PRIVATE_KEY.splitlines()[1] not in "".join(str(request.headers) for request in api.requests)


@pytest.mark.parametrize(
    "layout",
    [
        lambda pem: pem,
        lambda pem: pem.replace("\n", " "),
        lambda pem: pem.replace("\n", ""),
        lambda pem: f"\n  {pem}\n\n",
    ],
    ids=["as_downloaded", "joined_by_spaces", "run_together", "padded"],
)
async def test_start_takes_the_key_however_its_lines_were_pasted(layout):
    """A single-line paste drops the newlines, so the key is rebuilt from its body"""
    api = EnableBankingApi().serve_session()

    await _start(api, {**SUPPLIED, "private_key": layout(PRIVATE_KEY)})

    assert api.paths() == ["GET /aspsps", "POST /auth"]


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"application_id": "not-a-uuid"}, "That doesn't look like an Enable Banking application ID."),
        ({"private_key": "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"}, "That doesn't look like the private key"),
        ({"private_key": "just words"}, "That doesn't look like the private key"),
        ({"country": "Finland"}, "Please give the bank's country as its two-letter code"),
        ({"bank": "  "}, "Please give the bank's name exactly as Enable Banking lists it"),
    ],
)
async def test_start_refuses_a_field_that_cannot_be_what_it_names_before_sending_anything(changes, message):
    """The user is told which field to fix, the refusal names only that field, and nothing reaches Enable Banking"""
    api = EnableBankingApi().serve_session()

    with pytest.raises(ClaimRefused, match=re.escape(message)) as refusal:
        await _start(api, {**SUPPLIED, **changes})

    assert refusal.value.fields == tuple(changes)
    assert api.requests == []


async def test_start_with_a_bank_enable_banking_does_not_list_names_the_bank_and_country():
    """A name that matches no bank of that country is refused with what was searched for"""
    api = EnableBankingApi().serve_session()

    with pytest.raises(ClaimRefused) as refusal:
        await _start(api, {**SUPPLIED, "bank": "Nowhere Bank"})

    assert str(refusal.value) == 'We couldn\'t find "Nowhere Bank" in FI on Enable Banking. Please check the name and country'
    assert refusal.value.fields == ("country", "bank")
    assert api.paths() == ["GET /aspsps"]


@pytest.mark.parametrize("status", [401, 403])
async def test_start_with_an_application_enable_banking_rejects_says_to_check_the_id_and_key(status):
    """A signature the application doesn't accept is the user's to fix, in the application ID and private key"""
    api = EnableBankingApi().serve_session().serve("GET", "/aspsps", error_response("UNAUTHORIZED_ACCESS", status))

    with pytest.raises(ClaimRefused, match=r"rejected this application\. Please check the application ID and private key") as refusal:
        await _start(api)

    assert refusal.value.fields == ("application_id", "private_key")


async def test_start_the_bank_refuses_says_to_check_the_bank_and_country():
    """A sign-in Enable Banking won't start at the chosen bank points the user at the bank's name and country"""
    api = EnableBankingApi().serve_session().serve("POST", "/auth", error_response("WRONG_ASPSP_PROVIDED", 400))

    with pytest.raises(ClaimRefused, match=r"couldn't start a sign-in at that bank\. Please check the bank's name and country") as refusal:
        await _start(api)

    assert refusal.value.fields == ("country", "bank")


async def test_start_with_a_redirect_address_the_application_has_not_registered_names_it():
    """The user is told which address to add to the application"""
    api = EnableBankingApi().serve_session().serve("POST", "/auth", error_response("REDIRECT_URI_NOT_ALLOWED", 422))

    with pytest.raises(ClaimRefused) as refusal:
        await _start(api)

    assert REDIRECT_URL in str(refusal.value)
    assert "redirect URLs" in str(refusal.value)


@pytest.mark.parametrize(
    "answer",
    [error_response("ASPSP_ERROR", 500), fail_with(httpx.ConnectError), fail_with(httpx.ReadTimeout), "not json"],
    ids=["server_error", "connection_failed", "timed_out", "unreadable"],
)
async def test_start_with_enable_banking_out_of_reach_leaves_the_entry_to_be_tried_again(answer):
    """An outage, or an answer that can't be read, is not the user's mistake"""
    api = EnableBankingApi().serve_session().serve("GET", "/aspsps", answer)

    with pytest.raises(ProviderUnreachable, match="couldn't reach Enable Banking"):
        await _start(api)


async def test_claim_authorized_stores_the_key_the_session_and_the_accounts_it_shares():
    """The code is exchanged once, and what is stored is enough to read the accounts and to end the session"""
    api = EnableBankingApi().serve_session(session_account("uid-1", "hash-1"), session_account("uid-2", "hash-2", details="Visa"))

    stored = json.loads(await enable_banking_adapter(api.transport).claim_authorized(SUPPLIED, code=CODE))

    assert json.loads(api.requests[0].content) == {"code": CODE}
    assert (stored["application_id"], stored["session_id"], stored["bank"], stored["country"]) == (
        APPLICATION_ID,
        SESSION_ID,
        BANK,
        COUNTRY,
    )
    assert stored["private_key"].startswith("-----BEGIN PRIVATE KEY-----\n")
    assert [(account["uid"], account["identification_hash"], account["details"]) for account in stored["accounts"]] == [
        ("uid-1", "hash-1", "Everyday"),
        ("uid-2", "hash-2", "Visa"),
    ]
    assert "FI2112345600000785" not in json.dumps(stored)
    assert HOLDER not in json.dumps(stored)


async def test_a_second_sign_in_gives_a_bank_account_its_id_again_though_enable_banking_gives_it_a_new_uid():
    """Enable Banking gives an account a new uid in every session, so a reconnect finds a linked account again by its identification hash"""
    read = []
    for uid in ("uid-1", "uid-7"):
        api = EnableBankingApi().serve_session(session_account(uid, "hash-1"))
        api.serve("GET", f"/accounts/{uid}/balances", balances_body(balance("CLBD", "1.00")))
        adapter = enable_banking_adapter(api.transport)
        discovered = await adapter.discover(await adapter.claim_authorized(SUPPLIED, code=CODE), currency_exponents=EXPONENTS)
        read.append(([account.external_id for account in discovered.accounts], api.paths()[-1]))

    assert read == [(["hash-1"], "GET /accounts/uid-1/balances"), (["hash-1"], "GET /accounts/uid-7/balances")]


async def test_claim_authorized_leaves_out_an_account_the_session_gives_no_uid():
    """Enable Banking gives no uid to an account it knows can't be read, such as a closed one, so only the readable ones are kept"""
    api = EnableBankingApi().serve_session(session_account(None, "hash-closed"), session_account("uid-1", "hash-1"))

    stored = json.loads(await enable_banking_adapter(api.transport).claim_authorized(SUPPLIED, code=CODE))

    assert [account["identification_hash"] for account in stored["accounts"]] == ["hash-1"]


async def test_claim_authorized_when_no_account_has_a_uid_ends_the_session_and_says_none_were_shared():
    """A session whose accounts can all not be read holds nothing to sync, as a session sharing none does"""
    api = EnableBankingApi().serve_session(session_account(None, "hash-closed")).serve("DELETE", f"/sessions/{SESSION_ID}", "{}")

    with pytest.raises(ClaimRefused, match="shared no accounts"):
        await enable_banking_adapter(api.transport).claim_authorized(SUPPLIED, code=CODE)

    assert api.paths() == ["POST /sessions", f"DELETE /sessions/{SESSION_ID}"]


@pytest.mark.parametrize("code", ["EXPIRED_AUTHORIZATION_CODE", "WRONG_AUTHORIZATION_CODE", "ALREADY_AUTHORIZED"])
async def test_claim_authorized_with_a_code_that_cannot_be_used_says_to_connect_again(code):
    """A spent or expired code is refused with the way forward"""
    api = EnableBankingApi().serve("POST", "/sessions", error_response(code, 422))

    with pytest.raises(ClaimRefused, match=r"expired or was already used\. Please connect again"):
        await enable_banking_adapter(api.transport).claim_authorized(SUPPLIED, code=CODE)


async def test_claim_authorized_when_the_bank_needs_the_user_again_says_to_connect_again_not_to_check_the_bank():
    """The bank asking for more from the user is no mistake in the bank's name or country, so the way forward is a new sign-in"""
    api = EnableBankingApi().serve("POST", "/sessions", error_response("ASPSP_PSU_ACTION_REQUIRED", 422))

    with pytest.raises(ClaimRefused) as refused:
        await enable_banking_adapter(api.transport).claim_authorized(SUPPLIED, code=CODE)

    assert "Please connect again" in str(refused.value)
    assert "name and country" not in str(refused.value)


async def test_claim_authorized_when_the_bank_shares_no_accounts_ends_the_session_it_made_and_says_to_link_them():
    """A session nothing is stored for would stay open at Enable Banking, so it is ended before the refusal

    An application in restricted mode reaches only the accounts linked on it, so the refusal says to link them there
    """
    api = EnableBankingApi().serve_session().serve("DELETE", f"/sessions/{SESSION_ID}", "{}")

    with pytest.raises(ClaimRefused) as refused:
        await enable_banking_adapter(api.transport).claim_authorized(SUPPLIED, code=CODE)

    assert str(refused.value) == (
        "Your bank shared no accounts. Please link the accounts you want on your Enable Banking application, "
        "then connect again and share them at your bank"
    )
    assert api.paths() == ["POST /sessions", f"DELETE /sessions/{SESSION_ID}"]


async def test_claim_authorized_when_the_bank_shares_no_accounts_and_ending_the_session_fails_still_says_so():
    """The user is told what happened to their sign-in, not that something broke, and the failed release is only logged"""
    api = EnableBankingApi().serve_session().serve("DELETE", f"/sessions/{SESSION_ID}", error_response("ASPSP_ERROR", 500))

    with pytest.raises(ClaimRefused, match="Your bank shared no accounts"):
        await enable_banking_adapter(api.transport).claim_authorized(SUPPLIED, code=CODE)


async def test_claim_authorized_with_enable_banking_out_of_reach_leaves_the_entry_to_be_tried_again():
    """The code may not have been spent, but the engine has, so this says to try again from the start"""
    api = EnableBankingApi().serve("POST", "/sessions", error_response("ASPSP_ERROR", 500))

    with pytest.raises(ProviderUnreachable):
        await enable_banking_adapter(api.transport).claim_authorized(SUPPLIED, code=CODE)


async def test_release_ends_the_session_and_treats_one_already_gone_as_done():
    """Giving back a credential asks Enable Banking to delete its session, and a session that is gone is what was wanted"""
    api = EnableBankingApi().serve("DELETE", f"/sessions/{SESSION_ID}", "{}")
    await enable_banking_adapter(api.transport).release_credential(CREDENTIAL)
    assert api.paths() == [f"DELETE /sessions/{SESSION_ID}"]

    gone = EnableBankingApi().serve("DELETE", f"/sessions/{SESSION_ID}", error_response("SESSION_DOES_NOT_EXIST", 404))
    await enable_banking_adapter(gone.transport).release_credential(CREDENTIAL)
