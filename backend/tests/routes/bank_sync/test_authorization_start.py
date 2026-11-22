"""Starting a bank sign-in, for a provider that connects by signing in at the bank

The engine checks what the user supplied as a pasted claim does, sends the bank the address to return
to from the browser's own origin, and keeps the sign-in until the user returns. A pasted provider's
connect request is unchanged, and a provider that signs in at the bank takes no pasted credential
"""

import asyncio
import hashlib
import json
from datetime import UTC, datetime, timedelta

import pytest

from app.allowance_hook import AllowanceKind
from app.encryption import decrypt
from app.services.bank_sync.providers.contract import REFUSED_FIELDS_HEADER, ClaimRefused, ProviderUnreachable
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check
from tests.routes.support.authorization_helpers import (
    APPLICATION_KEY_VALUE,
    RETURN_URL,
    _commit_rejected_connection,
    _start,
    _stored_authorizations,
)
from tests.routes.support.bank_sync_helpers import (
    _commit_other_users_account,
    _new_account,
    _new_group_account,
    _sign_up,
)
from tests.services.bank_sync.authorizing_provider import APPLICATION_KEY, AUTHORIZING_PROVIDER, AuthorizingProviderAdapter, StartCall
from tests.services.bank_sync.fake_provider import ACCESS_KEY, remove_provider, use_adapter


async def test_start_sends_the_bank_back_to_the_browsers_own_origin_and_keeps_only_the_states_hash(client, authorizing_provider):
    """The bank's address comes from the provider and the return address from the Origin header, and only the state's hash is kept"""
    headers, user_id = await _sign_up(client)

    started = await _start(client, headers, nickname="Joint")

    assert started.status_code == 201, started.text
    [call] = authorizing_provider.starts
    assert call == StartCall({APPLICATION_KEY: APPLICATION_KEY_VALUE}, RETURN_URL, call.state)
    assert started.json() == {"url": f"https://bank.example/sign-in?state={call.state}"}
    [stored] = await _stored_authorizations()
    assert (stored.owner_id, stored.provider, stored.connection_id, stored.nickname) == (user_id, AUTHORIZING_PROVIDER, None, "Joint")
    assert stored.state_hash == hashlib.sha256(call.state.encode()).hexdigest()
    assert json.loads(decrypt(stored.credentials_encrypted)) == {APPLICATION_KEY: APPLICATION_KEY_VALUE}
    assert APPLICATION_KEY_VALUE not in stored.credentials_encrypted
    assert call.state not in {stored.state_hash, stored.credentials_encrypted}
    assert timedelta(minutes=29) < stored.expires_at - datetime.now(UTC) <= timedelta(minutes=30)


async def test_start_from_a_local_http_origin_returns_there(client, authorizing_provider):
    """A development server's port and plain http are the address the bank is told to return to"""
    headers, _ = await _sign_up(client)

    started = await _start(client, headers, origin="http://localhost:3000")

    assert started.status_code == 201, started.text
    assert authorizing_provider.starts[0].redirect_url == "http://localhost:3000/settings/bank-authorization"


@pytest.mark.parametrize(
    "origin",
    [None, "", "null", "ftp://app.example.com", "https://app.example.com/path", "https://user@app.example.com", "https://app.example.com?x=1"],
    ids=["missing", "blank", "opaque", "not-http", "has-a-path", "has-a-login", "has-a-query"],
)
async def test_start_without_a_web_origin_is_refused_before_the_provider_is_asked(client, authorizing_provider, origin):
    """A missing or malformed origin leaves the bank no address to return to, so nothing is asked or stored"""
    headers, _ = await _sign_up(client)

    refused = await _start(client, headers, origin=origin)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == (
        "Your browser didn't share the address of this page, so the bank can't send you back to it. Please reload the page and try again"
    )
    assert authorizing_provider.starts == []
    assert await _stored_authorizations() == []


@pytest.mark.parametrize(
    ("credentials", "detail"),
    [
        ({}, "Please paste the application key from Sign-in Bank Developer Portal"),
        ({APPLICATION_KEY: "   "}, "Please paste the application key from Sign-in Bank Developer Portal"),
        (
            {APPLICATION_KEY: "k" * 513},
            "That application key is too long. Please copy only the application key from Sign-in Bank Developer Portal and try again",
        ),
    ],
    ids=["missing", "blank", "too-long"],
)
async def test_start_refuses_a_field_missing_blank_or_too_long_before_the_provider_is_asked(client, authorizing_provider, credentials, detail):
    """The fields are checked as a pasted claim checks them, naming the field and never repeating what was sent"""
    headers, _ = await _sign_up(client)

    refused = await _start(client, headers, credentials=credentials)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == detail
    assert authorizing_provider.starts == []
    assert await _stored_authorizations() == []


async def test_start_refuses_a_nickname_over_64_characters_before_the_provider_is_asked(client, authorizing_provider):
    """A nickname too long for a connection is refused now, not after the user has signed in at the bank"""
    headers, _ = await _sign_up(client)

    refused = await _start(client, headers, nickname="n" * 65)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Keep the nickname to 64 characters or fewer"
    assert authorizing_provider.starts == []


async def test_start_through_a_provider_that_takes_a_pasted_credential_is_refused(client):
    """A provider whose user pastes a credential has no bank to send the user to"""
    headers, _ = await _sign_up(client)

    refused = await _start(client, headers, provider="fake", credentials={ACCESS_KEY: "anything"})

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Fake Bank connects by pasting a credential, not by signing in at your bank"
    assert await _stored_authorizations() == []


async def test_a_pasted_credential_for_a_provider_that_signs_in_at_the_bank_is_refused_before_anything_is_claimed(client, authorizing_provider):
    """A provider that signs in at the bank takes no pasted claim or reconnection, whatever the form sends"""
    headers, user_id = await _sign_up(client)
    rejected = await _commit_rejected_connection(user_id)
    credentials = {APPLICATION_KEY: APPLICATION_KEY_VALUE}

    claim = await client.post("/bank-sync/connections", json={"provider": AUTHORIZING_PROVIDER, "credentials": credentials}, headers=headers)
    reconnect = await client.post(f"/bank-sync/connections/{rejected.id}/reconnect", json={"credentials": credentials}, headers=headers)

    expected = "Sign-in Bank connects by signing in at your bank, not by pasting a credential"
    assert [(claim.status_code, claim.json()["detail"]), (reconnect.status_code, reconnect.json()["detail"])] == [
        (422, expected),
        (422, expected),
    ]
    assert authorizing_provider.claims == []


async def test_start_with_the_provider_withdrawn_refuses_a_new_connection_but_not_a_reconnection(client, authorizing_provider, monkeypatch):
    """Withdrawing a provider refuses new connections only, and its existing connections can still be reconnected"""
    use_adapter(monkeypatch, authorizing_provider, offered=False)
    headers, user_id = await _sign_up(client)
    rejected = await _commit_rejected_connection(user_id)

    refused = await _start(client, headers)
    reconnecting = await _start(client, headers, connection_id=str(rejected.id))

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Sign-in Bank is not offered for new connections. Existing connections carry on as before"
    assert reconnecting.status_code == 201, reconnecting.text


@pytest.mark.parametrize("gone", ["turned-off", "removed"])
async def test_start_with_a_provider_this_server_lacks_is_refused(client, authorizing_provider, monkeypatch, gone):
    """A provider that is turned off or has had its folder deleted has no bank sign-in to start"""
    if gone == "turned-off":
        use_adapter(monkeypatch, authorizing_provider, enabled=False)
    else:
        remove_provider(monkeypatch, AUTHORIZING_PROVIDER)
    headers, _ = await _sign_up(client)

    refused = await _start(client, headers)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Choose a bank provider this server supports"
    assert await _stored_authorizations() == []


async def test_start_by_a_user_who_may_not_link_bank_accounts_is_refused(client, authorizing_provider):
    """The check's refusal of bank sync is enforced on the start, not only in the interface"""
    install_check(refused={AllowanceKind.BANK_SYNC})
    headers, _ = await _sign_up(client)

    refused = await _start(client, headers)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == ALLOWANCE_REASON
    assert authorizing_provider.starts == []


async def test_start_the_provider_refuses_is_refused_with_its_reason_and_keeps_nothing(client, authorizing_provider):
    """A provider that can't start the sign-in, such as for keys it rejects, says why, and the user's earlier sign-in is kept"""
    headers, _ = await _sign_up(client)
    assert (await _start(client, headers)).status_code == 201
    [earlier] = await _stored_authorizations()
    authorizing_provider.start_error = ClaimRefused("Sign-in Bank rejected these keys")

    refused = await _start(client, headers)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Sign-in Bank rejected these keys"
    assert REFUSED_FIELDS_HEADER not in refused.headers
    assert [stored.id for stored in await _stored_authorizations()] == [earlier.id]


async def test_start_the_provider_refuses_for_some_fields_names_them(client, authorizing_provider):
    """A refusal about some of the fields names them, so the connect form marks only those"""
    headers, _ = await _sign_up(client)
    authorizing_provider.start_error = ClaimRefused("Sign-in Bank doesn't list that bank", fields=("country", APPLICATION_KEY))

    refused = await _start(client, headers)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Sign-in Bank doesn't list that bank"
    assert refused.headers[REFUSED_FIELDS_HEADER] == f"country,{APPLICATION_KEY}"


async def test_start_the_provider_cannot_reach_is_a_bad_gateway_and_keeps_nothing(client, authorizing_provider):
    """A provider that doesn't answer fails the start, so the user can try again"""
    headers, _ = await _sign_up(client)
    authorizing_provider.start_error = ProviderUnreachable("Lumina Finance couldn't reach Sign-in Bank. Please try again in a few minutes")

    refused = await _start(client, headers)

    assert refused.status_code == 502, refused.text
    assert refused.json()["detail"] == "Lumina Finance couldn't reach Sign-in Bank. Please try again in a few minutes"
    assert await _stored_authorizations() == []


@pytest.mark.parametrize("url", ["javascript:alert(1)", "data:text/html,hi", "bank.example/sign-in"])
async def test_start_with_a_bank_address_that_is_not_a_web_page_keeps_nothing(client, authorizing_provider, monkeypatch, url):
    """The browser is sent straight to the address, so one that would run in the app or go nowhere is never handed to it"""
    headers, _ = await _sign_up(client)

    async def give_the_address(supplied, *, redirect_url: str, state: str) -> str:
        return url

    monkeypatch.setattr(authorizing_provider, "start_authorization", give_the_address)

    refused = await _start(client, headers)

    assert refused.status_code == 502, refused.text
    assert refused.json()["detail"] == "Sign-in Bank gave a bank address Lumina Finance can't open. Please try again in a few minutes"
    assert await _stored_authorizations() == []


async def test_a_second_start_replaces_the_first(client, authorizing_provider):
    """One sign-in is in flight for a user, so starting again leaves only the newer one"""
    headers, _ = await _sign_up(client)

    await _start(client, headers)
    await _start(client, headers)

    [stored] = await _stored_authorizations()
    assert stored.state_hash == hashlib.sha256(authorizing_provider.starts[1].state.encode()).hexdigest()


async def test_two_starts_at_once_leave_one_sign_in(client, authorizing_provider):
    """Starts that overlap can't both find nothing to replace, since each would then keep its own sign-in"""
    headers, _ = await _sign_up(client)

    answers = await asyncio.gather(*(_start(client, headers) for _ in range(4)))

    assert [answer.status_code for answer in answers] == [201] * 4
    assert len(await _stored_authorizations()) == 1


async def test_start_keeps_the_account_whose_link_flow_asked_and_refuses_one_that_is_not_the_users_own(client, authorizing_provider):
    """The return goes back to the user's own account, and another user's or a group's account is refused"""
    headers, _ = await _sign_up(client)
    own_id = await _new_account(client, headers, "Everyday")
    theirs = await _commit_other_users_account()
    group_id = await _new_group_account(client, headers)

    others = await _start(client, headers, return_account_id=str(theirs.id))
    shared = await _start(client, headers, return_account_id=group_id)
    own = await _start(client, headers, return_account_id=own_id)

    assert (others.status_code, others.json()["detail"]) == (404, "Account not found")
    assert (shared.status_code, shared.json()["detail"]) == (403, "Accounts shared with a group can't be linked to a bank yet")
    assert own.status_code == 201, own.text
    assert [str(stored.return_account_id) for stored in await _stored_authorizations()] == [own_id]


async def test_start_to_reconnect_keeps_the_connection_and_refuses_one_that_is_not_the_users_or_still_works(client, authorizing_provider):
    """Only a rejected connection of the user's own takes a new sign-in, and it keeps its nickname"""
    headers, user_id = await _sign_up(client)
    rejected = await _commit_rejected_connection(user_id)
    working = await _commit_rejected_connection(user_id, rejected=False)
    other = await _commit_other_users_account()
    theirs = await _commit_rejected_connection(other.owner_id)

    reconnecting = await _start(client, headers, connection_id=str(rejected.id))
    still_working = await _start(client, headers, connection_id=str(working.id))
    not_theirs = await _start(client, headers, connection_id=str(theirs.id))
    renamed = await _start(client, headers, connection_id=str(rejected.id), nickname="Another name")

    assert reconnecting.status_code == 201, reconnecting.text
    assert [stored.connection_id for stored in await _stored_authorizations()] == [rejected.id]
    assert (still_working.status_code, still_working.json()["detail"]) == (409, "This connection is working, so it needs no reconnection")
    assert (not_theirs.status_code, not_theirs.json()["detail"]) == (404, "Bank connection not found")
    assert (renamed.status_code, renamed.json()["detail"]) == (422, "A reconnected connection keeps its nickname, so please leave this blank")
    assert len(authorizing_provider.starts) == 1


class _OtherSignInProvider(AuthorizingProviderAdapter):
    """A second provider that signs in at the bank"""

    provider_id = "other_signin"
    provider_name = "Other Bank"


async def test_start_to_reconnect_a_connection_of_another_provider_is_refused(client, authorizing_provider, monkeypatch):
    """A reconnection runs through the connection's own provider, so naming another one is refused"""
    other = _OtherSignInProvider()
    use_adapter(monkeypatch, other)
    headers, user_id = await _sign_up(client)
    rejected = await _commit_rejected_connection(user_id)

    refused = await _start(client, headers, provider="other_signin", connection_id=str(rejected.id))

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "That connection belongs to Sign-in Bank, not Other Bank. Please reconnect it with Sign-in Bank"
    assert other.starts == []
