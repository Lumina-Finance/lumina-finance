"""Finishing a bank sign-in from the bank's return

The state in the return finds the user's sign-in once, so a replayed, expired, unknown or another
user's return claims nothing. The bank's code is exchanged only after every check, the connection is
saved through the steps a pasted claim or reconnection uses, and an access the app could not keep is
given back to the provider
"""

import asyncio
import time
from datetime import UTC, datetime

import pytest

from app.encryption import decrypt
from app.services.bank_sync import availability, release
from app.services.bank_sync.availability import PROVIDER_GONE_DETAIL
from app.services.bank_sync.providers.contract import ClaimRefused, ProviderUnreachable
from tests.routes.support.authorization_helpers import (
    CODE,
    OLD_ACCESS,
    STORED_ACCESS,
    _commit_rejected_connection,
    _expire_authorizations,
    _finish,
    _sign_up_other_user,
    _started_state,
    _stored_authorizations,
)
from tests.routes.support.bank_sync_helpers import _link, _new_account, _sign_up, _stored_connections, _update_connection
from tests.services.bank_sync.authorizing_provider import APPLICATION_KEY, AUTHORIZING_PROVIDER
from tests.services.bank_sync.fake_provider import _returned, remove_provider, use_adapter


async def test_finish_saves_the_connection_with_the_access_the_code_yields_and_lists_its_accounts(client, authorizing_provider):
    """A new connection keeps its nickname, stores the access encrypted and lists the bank accounts, and the sign-in is spent"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    authorizing_provider.outcomes = [_returned("ACT-1")]
    state = await _started_state(client, headers, authorizing_provider, nickname="Joint", return_account_id=account_id)

    finished = await _finish(client, headers, state)

    assert finished.status_code == 200, finished.text
    body = finished.json()
    assert (body["outcome"], body["return_account_id"], body["reconnection"]) == ("connected", account_id, None)
    assert (body["connection"]["provider"], body["connection"]["nickname"]) == (AUTHORIZING_PROVIDER, "Joint")
    assert [account["external_id"] for account in body["connection"]["accounts"]] == ["ACT-1"]
    assert authorizing_provider.authorized == [({APPLICATION_KEY: "application-key-1"}, CODE)]
    [stored] = await _stored_connections()
    assert (stored.owner_id, stored.provider, stored.server_host) == (user_id, AUTHORIZING_PROVIDER, "fake-bank.example")
    assert decrypt(stored.credential_encrypted) == STORED_ACCESS
    assert await _stored_authorizations() == []


async def test_finish_again_with_the_same_return_claims_nothing(client, authorizing_provider):
    """A return link used twice, such as by a reload, finds the sign-in spent and never asks the provider for the code again"""
    headers, _ = await _sign_up(client)
    authorizing_provider.outcomes = [_returned("ACT-1")]
    state = await _started_state(client, headers, authorizing_provider)
    assert (await _finish(client, headers, state)).status_code == 200

    replayed = await _finish(client, headers, state)

    assert replayed.status_code == 404, replayed.text
    assert replayed.json()["detail"] == "This bank sign-in has ended. Please connect again"
    assert len(authorizing_provider.authorized) == 1
    assert len(await _stored_connections()) == 1


async def test_finish_with_an_unknown_state_claims_nothing(client, authorizing_provider):
    """A return the app never started, such as a link someone else crafted, adds nothing and asks the provider nothing"""
    headers, _ = await _sign_up(client)
    await _started_state(client, headers, authorizing_provider)

    refused = await _finish(client, headers, "not-the-state")

    assert refused.status_code == 404, refused.text
    assert refused.json()["detail"] == "This bank sign-in has ended. Please connect again"
    assert authorizing_provider.authorized == []
    assert len(await _stored_authorizations()) == 1


async def test_finish_by_another_user_claims_nothing_and_leaves_the_sign_in_for_its_owner(client, authorizing_provider):
    """A return carried to a different signed-in user finds nothing, and the user who started it can still finish"""
    headers, _ = await _sign_up(client)
    authorizing_provider.outcomes = [_returned("ACT-1")]
    state = await _started_state(client, headers, authorizing_provider)
    other_headers, _ = await _sign_up_other_user(client)

    swapped = await _finish(client, other_headers, state)

    assert swapped.status_code == 404, swapped.text
    assert authorizing_provider.authorized == []
    assert len(await _stored_authorizations()) == 1
    assert (await _finish(client, headers, state)).status_code == 200


async def test_finish_after_the_sign_in_expired_claims_nothing(client, authorizing_provider):
    """A return arriving more than 30 minutes after the start is refused before the provider is asked"""
    headers, _ = await _sign_up(client)
    state = await _started_state(client, headers, authorizing_provider)
    await _expire_authorizations()

    refused = await _finish(client, headers, state)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "This bank sign-in took too long. Please connect again"
    assert authorizing_provider.authorized == []
    assert await _stored_connections() == []
    assert await _stored_authorizations() == []


async def test_finish_after_the_sign_in_expired_with_the_banks_error_still_says_it_took_too_long(client, authorizing_provider):
    """An expired sign-in is the first thing the user is told, whatever the bank sent back"""
    headers, _ = await _sign_up(client)
    state = await _started_state(client, headers, authorizing_provider)
    await _expire_authorizations()

    refused = await _finish(client, headers, state, error="access_denied")

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "This bank sign-in took too long. Please connect again"


async def test_two_returns_at_once_spend_the_sign_in_once(client, authorizing_provider):
    """A page that mounts twice or a double click sends the return together, and only one claims the code"""
    headers, _ = await _sign_up(client)
    authorizing_provider.outcomes = [_returned("ACT-1")]
    state = await _started_state(client, headers, authorizing_provider)

    answers = await asyncio.gather(_finish(client, headers, state), _finish(client, headers, state))

    assert sorted(answer.status_code for answer in answers) == [200, 404]
    assert len(authorizing_provider.authorized) == 1
    assert len(await _stored_connections()) == 1


async def test_finish_after_a_second_start_claims_nothing_for_the_first(client, authorizing_provider):
    """Only the newest sign-in can return, so the first one's state finds nothing"""
    headers, _ = await _sign_up(client)
    first = await _started_state(client, headers, authorizing_provider)
    second = await _started_state(client, headers, authorizing_provider)

    refused = await _finish(client, headers, first)

    assert refused.status_code == 404, refused.text
    assert authorizing_provider.authorized == []
    authorizing_provider.outcomes = [_returned("ACT-1")]
    assert (await _finish(client, headers, second)).status_code == 200


async def test_finish_with_the_banks_error_adds_nothing_and_says_where_to_return(client, authorizing_provider):
    """A bank that refused access, such as when the user declined, claims no code, adds no connection and spends the sign-in"""
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    state = await _started_state(client, headers, authorizing_provider, return_account_id=account_id)

    cancelled = await _finish(client, headers, state, error="access_denied")

    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json() == {"outcome": "cancelled", "return_account_id": account_id, "connection": None, "reconnection": None}
    assert authorizing_provider.authorized == []
    assert await _stored_connections() == []
    assert await _stored_authorizations() == []


async def test_finish_with_both_a_code_and_the_banks_error_believes_the_error_and_claims_nothing(client, authorizing_provider):
    """A return carrying an error as well as a code is a refusal, so the code is never exchanged and nothing is added"""
    headers, _ = await _sign_up(client)
    state = await _started_state(client, headers, authorizing_provider)

    cancelled = await _finish(client, headers, state, code=CODE, error="access_denied")

    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["outcome"] == "cancelled"
    assert authorizing_provider.authorized == []
    assert await _stored_connections() == []


async def test_finish_with_neither_a_code_nor_an_error_is_refused_and_keeps_the_sign_in(client, authorizing_provider):
    """A return carrying nothing is not the bank's, so the sign-in stays for the real one"""
    headers, _ = await _sign_up(client)
    state = await _started_state(client, headers, authorizing_provider)

    refused = await client.post("/bank-sync/authorizations/finish", json={"state": state}, headers=headers)

    assert refused.status_code == 422, refused.text
    assert len(await _stored_authorizations()) == 1


async def test_finish_with_the_provider_withdrawn_midway_claims_nothing_for_a_new_connection(client, authorizing_provider, monkeypatch):
    """A provider withdrawn from new connections while the user was at the bank takes no new connection, and the code stays unspent"""
    headers, _ = await _sign_up(client)
    state = await _started_state(client, headers, authorizing_provider)
    use_adapter(monkeypatch, authorizing_provider, offered=False)

    refused = await _finish(client, headers, state)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Sign-in Bank is not offered for new connections. Existing connections carry on as before"
    assert authorizing_provider.authorized == []
    assert await _stored_connections() == []


@pytest.mark.parametrize("gone", ["turned-off", "removed"])
async def test_finish_with_the_provider_turned_off_or_deleted_midway_claims_nothing(client, authorizing_provider, monkeypatch, gone):
    """A provider that is turned off or has had its folder deleted while the user was at the bank claims nothing"""
    headers, _ = await _sign_up(client)
    state = await _started_state(client, headers, authorizing_provider)
    if gone == "turned-off":
        use_adapter(monkeypatch, authorizing_provider, enabled=False)
    else:
        remove_provider(monkeypatch, AUTHORIZING_PROVIDER)

    refused = await _finish(client, headers, state)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Choose a bank provider this server supports"
    assert authorizing_provider.authorized == []


async def test_finish_by_a_user_who_may_no_longer_link_bank_accounts_claims_nothing(client, authorizing_provider, monkeypatch):
    """The bank-linking check is repeated on the return, not only on the start"""
    headers, _ = await _sign_up(client)
    state = await _started_state(client, headers, authorizing_provider)
    monkeypatch.setattr(availability, "may_link_bank_accounts", lambda _user_id: False)

    refused = await _finish(client, headers, state)

    assert refused.status_code == 403, refused.text
    assert authorizing_provider.authorized == []


async def test_finish_the_provider_refuses_the_code_saves_nothing_and_needs_a_new_start(client, authorizing_provider):
    """A code the provider refuses, such as one already used, says why and adds nothing, and the spent sign-in must start again"""
    headers, _ = await _sign_up(client)
    state = await _started_state(client, headers, authorizing_provider)
    authorizing_provider.codes[CODE] = ClaimRefused("Sign-in Bank didn't accept this sign-in. Please connect again")

    refused = await _finish(client, headers, state)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Sign-in Bank didn't accept this sign-in. Please connect again"
    assert await _stored_connections() == []
    assert (await _finish(client, headers, state)).status_code == 404


async def test_finish_the_provider_cannot_reach_says_the_sign_in_must_start_again(client, authorizing_provider):
    """The sign-in is spent when the provider fails to answer, so the message sends the user back to the bank rather than to retry"""
    headers, _ = await _sign_up(client)
    state = await _started_state(client, headers, authorizing_provider)
    authorizing_provider.codes[CODE] = ProviderUnreachable("Lumina Finance couldn't reach Sign-in Bank. Please try again in a few minutes")

    refused = await _finish(client, headers, state)

    assert refused.status_code == 502, refused.text
    assert refused.json()["detail"] == "Sign-in Bank couldn't confirm your bank sign-in. Please connect again"
    assert await _stored_connections() == []
    assert await _stored_authorizations() == []


async def test_finish_reconnects_a_rejected_connection_and_gives_back_the_access_it_replaces(client, authorizing_provider):
    """A rejected connection takes the new access in place, works again, resumes, and the old access is released once the new one is saved"""
    headers, user_id = await _sign_up(client)
    rejected = await _commit_rejected_connection(user_id)
    authorizing_provider.outcomes = [_returned("ACT-1")]
    state = await _started_state(client, headers, authorizing_provider, connection_id=str(rejected.id))

    finished = await _finish(client, headers, state)

    assert finished.status_code == 200, finished.text
    body = finished.json()
    assert (body["outcome"], body["connection"]) == ("reconnected", None)
    assert (body["reconnection"]["connection"]["id"], body["reconnection"]["connection"]["status"]) == (str(rejected.id), "active")
    [stored] = await _stored_connections()
    assert (decrypt(stored.credential_encrypted), stored.credential_rejected_at) == (STORED_ACCESS, None)
    assert authorizing_provider.released == [OLD_ACCESS]


@pytest.mark.parametrize(("shared_again", "resumes"), [("ACT-1", True), ("ACT-2", False)], ids=["same bank account", "another"])
async def test_finish_reconnect_resumes_a_linked_account_the_bank_shares_again(client, authorizing_provider, shared_again, resumes):
    """A linked account whose bank account the new sign-in shares again resumes, and one it no longer shares waits to be chosen again"""
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    authorizing_provider.outcomes = [_returned("ACT-1")]
    connected = await _finish(client, headers, await _started_state(client, headers, authorizing_provider))
    connection_id = connected.json()["connection"]["id"]
    assert (await _link(client, headers, account_id, connection_id, "ACT-1")).status_code == 201
    [stored] = await _stored_connections()
    await _update_connection(stored, credential_rejected_at=datetime.now(UTC))
    authorizing_provider.outcomes = [_returned(shared_again)]
    state = await _started_state(client, headers, authorizing_provider, connection_id=connection_id)

    finished = await _finish(client, headers, state)

    assert finished.status_code == 200, finished.text
    reconnection = finished.json()["reconnection"]
    assert reconnection["connection"]["id"] == connection_id
    assert (reconnection["resumed_account_ids"], reconnection["choose_again_account_ids"]) == (
        ([account_id], []) if resumes else ([], [account_id])
    )


async def test_finish_reconnect_after_the_provider_folder_was_deleted_claims_nothing(client, authorizing_provider, monkeypatch):
    """A provider whose folder was deleted while the user was at the bank can't take the new access, so the code stays unspent"""
    headers, user_id = await _sign_up(client)
    rejected = await _commit_rejected_connection(user_id)
    state = await _started_state(client, headers, authorizing_provider, connection_id=str(rejected.id))
    remove_provider(monkeypatch, AUTHORIZING_PROVIDER)

    refused = await _finish(client, headers, state)

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == PROVIDER_GONE_DETAIL
    assert authorizing_provider.authorized == []
    [stored] = await _stored_connections()
    assert decrypt(stored.credential_encrypted) == OLD_ACCESS


async def test_finish_reconnect_whose_save_fails_keeps_the_old_access_and_the_rejection(client, authorizing_provider, monkeypatch):
    """A save that fails leaves the connection as it was, still rejected, and gives the new access back"""
    headers, user_id = await _sign_up(client)
    rejected = await _commit_rejected_connection(user_id)
    state = await _started_state(client, headers, authorizing_provider, connection_id=str(rejected.id))

    def fail_to_say_the_host(credential: str) -> str:
        raise RuntimeError("the host could not be read")

    monkeypatch.setattr(authorizing_provider, "server_host", fail_to_say_the_host)

    with pytest.raises(RuntimeError, match="the host could not be read"):
        await _finish(client, headers, state)

    [stored] = await _stored_connections()
    assert decrypt(stored.credential_encrypted) == OLD_ACCESS
    assert stored.credential_rejected_at is not None
    assert authorizing_provider.released == [STORED_ACCESS]


async def test_finish_reconnect_of_a_provider_withdrawn_from_new_connections_still_works(client, authorizing_provider, monkeypatch):
    """Withdrawing a provider refuses new connections only, so a return that reconnects an existing one is saved"""
    headers, user_id = await _sign_up(client)
    rejected = await _commit_rejected_connection(user_id)
    authorizing_provider.outcomes = [_returned("ACT-1")]
    state = await _started_state(client, headers, authorizing_provider, connection_id=str(rejected.id))
    use_adapter(monkeypatch, authorizing_provider, offered=False)

    finished = await _finish(client, headers, state)

    assert finished.status_code == 200, finished.text
    assert finished.json()["outcome"] == "reconnected"


async def test_finish_reconnecting_a_connection_that_works_again_claims_nothing(client, authorizing_provider):
    """A connection another tab reconnected while the user was at the bank needs no new access, and the code stays unspent"""
    headers, user_id = await _sign_up(client)
    rejected = await _commit_rejected_connection(user_id)
    state = await _started_state(client, headers, authorizing_provider, connection_id=str(rejected.id))
    await _update_connection(rejected, credential_rejected_at=None)

    refused = await _finish(client, headers, state)

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == "This connection is working, so it needs no reconnection"
    assert authorizing_provider.authorized == []
    assert authorizing_provider.released == []


async def test_finish_reconnecting_a_connection_disconnected_midway_claims_nothing(client, authorizing_provider):
    """Disconnecting the connection ends its sign-in, so the return finds nothing and the access it held is released"""
    headers, user_id = await _sign_up(client)
    rejected = await _commit_rejected_connection(user_id)
    state = await _started_state(client, headers, authorizing_provider, connection_id=str(rejected.id))
    assert (await client.delete(f"/bank-sync/connections/{rejected.id}", headers=headers)).status_code == 200

    refused = await _finish(client, headers, state)

    assert refused.status_code == 404, refused.text
    assert authorizing_provider.authorized == []
    assert authorizing_provider.released == [OLD_ACCESS]


async def test_finish_that_fails_after_the_claim_gives_the_new_access_back(client, authorizing_provider):
    """A connection disconnected while the provider answers leaves the claimed access with no home, so it is released"""
    headers, user_id = await _sign_up(client)
    rejected = await _commit_rejected_connection(user_id)
    state = await _started_state(client, headers, authorizing_provider, connection_id=str(rejected.id))

    async def disconnect_meanwhile() -> None:
        assert (await client.delete(f"/bank-sync/connections/{rejected.id}", headers=headers)).status_code == 200

    authorizing_provider.while_claiming = disconnect_meanwhile

    refused = await _finish(client, headers, state)

    assert refused.status_code == 404, refused.text
    assert refused.json()["detail"] == "Bank connection not found"
    assert len(authorizing_provider.authorized) == 1
    assert authorizing_provider.released == [OLD_ACCESS, STORED_ACCESS]
    assert await _stored_connections() == []


async def test_finish_that_fails_after_the_claim_for_a_new_connection_gives_the_access_back(client, authorizing_provider, monkeypatch):
    """When keeping the claimed access fails, the provider is told to end it before the failure is raised"""
    headers, _ = await _sign_up(client)
    state = await _started_state(client, headers, authorizing_provider)

    def fail_to_say_the_host(credential: str) -> str:
        raise RuntimeError("the host could not be read")

    monkeypatch.setattr(authorizing_provider, "server_host", fail_to_say_the_host)

    with pytest.raises(RuntimeError, match="the host could not be read"):
        await _finish(client, headers, state)

    assert authorizing_provider.released == [STORED_ACCESS]
    assert await _stored_connections() == []


async def test_disconnect_gives_the_access_back_and_a_failing_release_does_not_stop_it(client, authorizing_provider):
    """Disconnecting releases the access the provider holds, and a provider that fails to take it back leaves the connection disconnected"""
    headers, user_id = await _sign_up(client)
    connected = await _commit_rejected_connection(user_id, rejected=False)
    authorizing_provider.release_error = RuntimeError("the provider is down")

    disconnected = await client.delete(f"/bank-sync/connections/{connected.id}", headers=headers)

    assert disconnected.status_code == 200, disconnected.text
    assert authorizing_provider.released == [OLD_ACCESS]
    assert await _stored_connections() == []


async def test_disconnect_does_not_wait_for_a_provider_that_is_slow_to_take_the_access_back(client, authorizing_provider, monkeypatch):
    """The connection is already gone when the release starts, so a slow provider is given a moment and then left to end it itself"""
    headers, user_id = await _sign_up(client)
    connected = await _commit_rejected_connection(user_id, rejected=False)
    monkeypatch.setattr(release, "RELEASE_TIMEOUT_SECONDS", 0.05)
    authorizing_provider.release_delay = 3.0

    started = time.monotonic()
    disconnected = await client.delete(f"/bank-sync/connections/{connected.id}", headers=headers)

    assert disconnected.status_code == 200, disconnected.text
    assert time.monotonic() - started < 2.0
    assert await _stored_connections() == []


async def test_disconnect_after_the_provider_folder_was_deleted_still_disconnects(client, authorizing_provider, monkeypatch):
    """With no adapter to give the access back to, the connection is still removed"""
    headers, user_id = await _sign_up(client)
    connected = await _commit_rejected_connection(user_id, rejected=False)
    remove_provider(monkeypatch, AUTHORIZING_PROVIDER)

    disconnected = await client.delete(f"/bank-sync/connections/{connected.id}", headers=headers)

    assert disconnected.status_code == 200, disconnected.text
    assert authorizing_provider.released == []
    assert await _stored_connections() == []
