"""Reconnecting a connection whose credential SimpleFIN rejected, with a new setup token

A setup token claims once, so the new credential has to be kept whatever happens after the claim.
The linked accounts must come back as the listing finds them: one whose bank account is unchanged
resumes from where it stopped, and one listed under a new id waits for the user rather than syncing
into the wrong ledger. Neither may still show the failure from before the reconnect, since its new
credential has answered it
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import func, select, update

from app.encryption import decrypt
from app.models.account import Account
from app.models.bank_connection import (
    BankAccountLink,
    BankConnection,
    BankLinkState,
    BankProviderRequest,
)
from app.models.bank_sync_job import BankSyncJob
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition
from app.schemas.bank_sync import ReconnectBankConnectionRequest
from app.services.bank_sync import availability
from app.services.cache_state.updates import mark_user_cache_changed
from tests.conftest import TestSession
from tests.fake_simplefin_bridge import FakeBridgeTransport
from tests.routes.support.bank_sync_helpers import (
    _build_bank_transaction,
    _build_user,
    _changed_at,
    _commit_bank_connection,
    _link,
    _new_account,
    _sign_up,
)
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.routes.support.mailbox import mailbox
from tests.services.bank_sync.fake_provider import use_adapter
from tests.services.bank_sync.providers.simplefin.stand_ins import AccountsTimeOut, FakeBridgeScenario, PausedBridge, simplefin_adapter
from tests.services.bank_sync.support import _jobs

_WORKING = "This connection is working, so it needs no reconnection"
_ALREADY_USED = "This setup token has already been used. Please create a new one in SimpleFIN Bridge"
_NOT_FOUND = "Bank connection not found"
_SIGNIN_SINCE = datetime(2026, 9, 30, tzinfo=UTC)

# Why each link's last attempt failed, as SimpleFIN rejecting the credential leaves it
_REJECTED_REASON = "SimpleFIN Bridge rejected the stored access credential"


async def _rejected_with_two_links(client, scenario: FakeBridgeScenario) -> tuple[dict, str, str, str]:
    """Connect Harbour Bank, link Everyday to its chequing and Savings to its savings, and have SimpleFIN reject the credential

    The rejection came 10 days ago, and only a scheduled sync is queued since

    Returns:
        The auth headers and the ids of Everyday, Savings and the connection
    """
    headers, _ = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday", currency="USD")
    savings_id = await _new_account(client, headers, "Savings", currency="USD")
    connection_id = await _claim_harbour(client, headers, scenario)
    assert (await _link(client, headers, everyday_id, connection_id, "ACT-chequing")).status_code == 201
    assert (await _link(client, headers, savings_id, connection_id, "ACT-savings")).status_code == 201
    await _reject(scenario, connection_id)
    return headers, everyday_id, savings_id, connection_id


async def _claim_harbour(client, headers, scenario: FakeBridgeScenario) -> str:
    """Connect Harbour Bank's three bank accounts through the route and return the connection's id"""
    await scenario.add_harbour_accounts()
    claimed = await client.post(
        "/bank-sync/connections", json={"provider": "simplefin", "credentials": {"setup_token": scenario.setup_token}}, headers=headers
    )
    assert claimed.status_code == 201, claimed.text
    return claimed.json()["id"]


async def _reject(scenario: FakeBridgeScenario, connection_id: str) -> None:
    """Have SimpleFIN reject the connection's credential 10 days ago, with only scheduled syncs queued since"""
    await scenario.change("POST", "/revoke")
    rejected_at = datetime.now(UTC) - timedelta(days=10)
    async with TestSession() as session:
        await session.execute(
            update(BankConnection).where(BankConnection.id == uuid.UUID(connection_id)).values(credential_rejected_at=rejected_at)
        )
        await session.execute(update(BankSyncJob).values(kind="scheduled"))
        await session.commit()


async def _reconnect(client, headers, connection_id: str, setup_token: str) -> httpx.Response:
    """Reconnect a connection with a setup token through the route"""
    return await client.post(
        f"/bank-sync/connections/{connection_id}/reconnect", json={"credentials": {"setup_token": setup_token}}, headers=headers
    )


async def _stored_connection(connection_id: str) -> BankConnection | None:
    """Return the stored connection, or None once it is gone"""
    async with TestSession() as session:
        return await session.get(BankConnection, uuid.UUID(connection_id))


async def _links() -> dict[str, tuple]:
    """Return each link's bank account, state, import kind, checkpoint and bank sign-in time, by account id"""
    async with TestSession() as session:
        rows = await session.execute(
            select(
                BankAccountLink.account_id,
                BankAccountLink.external_account_id,
                BankAccountLink.state,
                BankAccountLink.import_kind,
                BankAccountLink.checkpoint,
                BankAccountLink.signin_needed_since,
            )
        )
        return {str(account_id): tuple(values) for account_id, *values in rows}


async def _request_purposes() -> list[str]:
    """Return the purpose of every request counted against the budget, sorted"""
    async with TestSession() as session:
        return sorted(await session.scalars(select(BankProviderRequest.purpose)))


async def _wait_on_signin(account_id: str) -> None:
    """Commit that an account's link is also waiting on a bank sign-in at Harbour Bank"""
    async with TestSession() as session:
        await session.execute(
            update(BankAccountLink).where(BankAccountLink.account_id == uuid.UUID(account_id)).values(signin_needed_since=_SIGNIN_SINCE)
        )
        await session.commit()


async def test_reconnect_with_both_bank_accounts_unchanged_resumes_both_and_clears_reconnect_needed(client, scenario: FakeBridgeScenario):
    """Everyday and Savings were stopped for 10 days: a new token brings both back, catching up from where each stopped

    Everyday was also paused for review. Its catch-up is an import. It runs to today whatever the
    pause, and the pause stays for when the import ends
    """
    headers, everyday_id, savings_id, connection_id = await _rejected_with_two_links(client, scenario)
    async with TestSession() as session:
        await session.execute(update(BankAccountLink).values(importing=False))
        await session.execute(update(BankAccountLink).where(BankAccountLink.account_id == uuid.UUID(everyday_id)).values(paused=True))
        await session.commit()
    before = await _links()
    old_credential = decrypt((await _stored_connection(connection_id)).credential_encrypted)

    response = await _reconnect(client, headers, connection_id, await scenario.new_setup_token())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["resumed_account_ids"] == sorted([everyday_id, savings_id])
    assert body["choose_again_account_ids"] == []
    assert body["accounts_pending"] is False
    assert (body["connection"]["id"], body["connection"]["status"], body["connection"]["discovery_pending"]) == (connection_id, "active", False)
    assert [(account["external_id"], account["linked_account_id"]) for account in body["connection"]["accounts"]] == [
        ("ACT-chequing", everyday_id),
        ("ACT-savings", savings_id),
        ("ACT-visa", None),
    ]
    connection = await _stored_connection(connection_id)
    assert connection.credential_rejected_at is None
    assert decrypt(connection.credential_encrypted) != old_credential
    assert await _links() == {
        account_id: (external_id, "active", "reconnect", checkpoint, None) for account_id, (external_id, _, _, checkpoint, _) in before.items()
    }
    async with TestSession() as session:
        rows = await session.execute(select(BankAccountLink.account_id, BankAccountLink.importing, BankAccountLink.paused))
        assert {str(account_id): (importing, paused) for account_id, importing, paused in rows} == {
            everyday_id: (True, True),
            savings_id: (True, False),
        }
    assert await _jobs() == [("initial", False, "queued")]
    assert await _request_purposes() == ["discovery", "discovery"]


async def test_reconnect_with_a_bank_account_listed_under_a_new_id_waits_for_it_to_be_chosen_again(client, scenario: FakeBridgeScenario):
    """Everyday's bank account comes back under a new id: Everyday waits to choose it, its sign-in and 4 waiting items aside

    The user is in the app choosing, so nothing is emailed after signing up
    """
    headers, everyday_id, savings_id, connection_id = await _rejected_with_two_links(client, scenario)
    emails_after_sign_up = len(mailbox.sent)
    await _wait_on_signin(everyday_id)
    async with TestSession() as session:
        everyday = await session.get_one(Account, uuid.UUID(everyday_id))
        session.add_all([_build_bank_transaction(everyday, f"TRN-{number}", external_account_id="ACT-chequing") for number in range(4)])
        await session.commit()
    await scenario.change("PATCH", "/accounts/ACT-chequing", {"id": "ACT-chequing-2"})

    response = await _reconnect(client, headers, connection_id, await scenario.new_setup_token())

    assert response.status_code == 200, response.text
    assert (response.json()["resumed_account_ids"], response.json()["choose_again_account_ids"]) == ([savings_id], [everyday_id])
    links = await _links()
    assert links[everyday_id][:3] == ("ACT-chequing", "choose_account", "initial")
    assert links[everyday_id][4] is None
    assert links[savings_id][1:3] == ("active", "reconnect")
    async with TestSession() as session:
        waiting = await session.scalar(
            select(func.count())
            .select_from(BankTransaction)
            .where(
                BankTransaction.disposition == BankTransactionDisposition.AWAITING_REVIEW, BankTransaction.account_id == uuid.UUID(everyday_id)
            )
        )
    assert waiting == 4
    assert await _jobs() == [("initial", False, "queued")]
    assert len(mailbox.sent) == emails_after_sign_up


async def test_reconnect_leaves_no_link_showing_the_failure_from_before_it(client, scenario: FakeBridgeScenario):
    """Everyday and Savings last failed on the rejected credential: once reconnected, neither shows it

    Everyday's bank account comes back under a new id, so it waits to be chosen again, and Savings resumes
    """
    headers, everyday_id, savings_id, connection_id = await _rejected_with_two_links(client, scenario)
    async with TestSession() as session:
        await session.execute(
            update(BankAccountLink).values(last_attempt_at=datetime.now(UTC) - timedelta(days=10), last_failure_reason=_REJECTED_REASON)
        )
        await session.commit()
    await scenario.change("PATCH", "/accounts/ACT-chequing", {"id": "ACT-chequing-2"})

    response = await _reconnect(client, headers, connection_id, await scenario.new_setup_token())

    assert response.status_code == 200, response.text
    assert (response.json()["resumed_account_ids"], response.json()["choose_again_account_ids"]) == ([savings_id], [everyday_id])
    for account_id in (everyday_id, savings_id):
        read = await client.get(f"/accounts/{account_id}/bank-link", headers=headers)
        assert read.status_code == 200, read.text
        assert read.json()["link"]["sync"]["last_failure"] is None


async def test_reconnect_leaves_a_link_unlinked_before_as_it_was(client, scenario: FakeBridgeScenario):
    """Everyday was unlinked while the connection waited, so only Savings resumes and Everyday isn't offered to choose again"""
    headers, everyday_id, savings_id, connection_id = await _rejected_with_two_links(client, scenario)
    unlinked = await client.delete(f"/accounts/{everyday_id}/bank-link", headers=headers)
    assert unlinked.status_code == 200, unlinked.text

    response = await _reconnect(client, headers, connection_id, await scenario.new_setup_token())

    assert response.status_code == 200, response.text
    assert (response.json()["resumed_account_ids"], response.json()["choose_again_account_ids"]) == ([savings_id], [])
    assert (await _links())[everyday_id][1:3] == ("unlinked", "initial")


async def test_reconnect_with_nothing_linked_whose_listing_fails_queues_a_sync_to_list_the_bank_accounts(
    client, scenario: FakeBridgeScenario, monkeypatch
):
    """No account is linked through the connection, but its bank accounts still have to be listed, so the next sync lists them"""
    headers, _ = await _sign_up(client)
    connection_id = await _claim_harbour(client, headers, scenario)
    await _reject(scenario, connection_id)
    use_adapter(monkeypatch, simplefin_adapter(AccountsTimeOut()))

    response = await _reconnect(client, headers, connection_id, await scenario.new_setup_token())

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["resumed_account_ids"], body["choose_again_account_ids"], body["accounts_pending"]) == ([], [], True)
    assert await _jobs() == [("initial", True, "queued")]


async def test_reconnect_whose_request_budget_is_spent_keeps_the_new_credential_and_lists_the_bank_accounts_later(
    client, scenario: FakeBridgeScenario
):
    """The claim spends the token whatever the budget says, so it is kept, while the listing waits for a request to free up"""
    headers, _everyday_id, _savings_id, connection_id = await _rejected_with_two_links(client, scenario)
    async with TestSession() as session:
        await session.execute(
            update(BankConnection)
            .where(BankConnection.id == uuid.UUID(connection_id))
            .values(request_budget_spent_until=datetime.now(UTC) + timedelta(hours=1))
        )
        await session.commit()
    before = await _request_purposes()

    response = await _reconnect(client, headers, connection_id, await scenario.new_setup_token())

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["resumed_account_ids"], body["choose_again_account_ids"], body["accounts_pending"]) == ([], [], True)
    assert (await _stored_connection(connection_id)).credential_rejected_at is None
    assert await _request_purposes() == before
    assert await _jobs() == [("initial", True, "queued")]


async def test_reconnect_with_nothing_linked_whose_listing_works_queues_nothing(client, scenario: FakeBridgeScenario):
    """No account is linked through the connection and its bank accounts are listed, so there is nothing for a sync to do"""
    headers, _ = await _sign_up(client)
    connection_id = await _claim_harbour(client, headers, scenario)
    await _reject(scenario, connection_id)

    response = await _reconnect(client, headers, connection_id, await scenario.new_setup_token())

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["resumed_account_ids"], body["choose_again_account_ids"], body["accounts_pending"]) == ([], [], False)
    assert await _jobs() == []


async def test_reconnect_keeps_a_bank_sign_in_the_bank_still_needs(client, scenario: FakeBridgeScenario):
    """Savings was also waiting on a Harbour Bank sign-in and the Bridge still reports it, so it shows again once Reconnect needed clears"""
    headers, _, savings_id, connection_id = await _rejected_with_two_links(client, scenario)
    await _wait_on_signin(savings_id)
    await scenario.change("POST", "/errors", {"code": "con.auth", "msg": "Harbour Bank needs you to sign in again.", "conn_id": "CON-harbour"})

    response = await _reconnect(client, headers, connection_id, await scenario.new_setup_token())

    assert response.status_code == 200, response.text
    assert savings_id in response.json()["resumed_account_ids"]
    assert response.json()["connection"]["status"] == "active"
    _, state, import_kind, _, signin_needed_since = (await _links())[savings_id]
    assert (state, import_kind, signin_needed_since) == ("active", "reconnect", _SIGNIN_SINCE)


async def test_reconnect_of_a_working_connection_is_refused_before_the_token_is_spent(client, scenario: FakeBridgeScenario):
    """A token pasted for a connection that still works is refused, and still claims a connection afterwards"""
    headers, _ = await _sign_up(client)
    claimed = await client.post(
        "/bank-sync/connections", json={"provider": "simplefin", "credentials": {"setup_token": scenario.setup_token}}, headers=headers
    )
    assert claimed.status_code == 201, claimed.text
    token = await scenario.new_setup_token()

    refused = await _reconnect(client, headers, claimed.json()["id"], token)

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == _WORKING
    assert await _request_purposes() == ["discovery"]
    reused = await client.post("/bank-sync/connections", json={"provider": "simplefin", "credentials": {"setup_token": token}}, headers=headers)
    assert reused.status_code == 201, reused.text


async def test_reconnect_with_a_used_token_is_refused_and_leaves_the_connection_rejected(client, scenario: FakeBridgeScenario):
    """The token that made the connection was spent then, so pasting it again changes nothing"""
    headers, _, _, connection_id = await _rejected_with_two_links(client, scenario)
    credential = (await _stored_connection(connection_id)).credential_encrypted

    refused = await _reconnect(client, headers, connection_id, scenario.setup_token)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == _ALREADY_USED
    connection = await _stored_connection(connection_id)
    assert connection.credential_rejected_at is not None
    assert connection.credential_encrypted == credential


async def test_reconnect_whose_listing_fails_keeps_the_new_credential_and_leaves_the_accounts_to_the_next_sync(
    client, scenario: FakeBridgeScenario, monkeypatch
):
    """The token is spent, so the credential is kept and Reconnect needed clears, and the next sync lists the bank accounts first"""
    headers, everyday_id, savings_id, connection_id = await _rejected_with_two_links(client, scenario)
    use_adapter(monkeypatch, simplefin_adapter(AccountsTimeOut()))

    response = await _reconnect(client, headers, connection_id, await scenario.new_setup_token())

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["resumed_account_ids"], body["choose_again_account_ids"], body["accounts_pending"]) == ([], [], True)
    assert (body["connection"]["status"], body["connection"]["discovery_pending"]) == ("active", True)
    assert (await _stored_connection(connection_id)).credential_rejected_at is None
    links = await _links()
    assert [links[account_id][1:3] for account_id in (everyday_id, savings_id)] == [("active", "reconnect")] * 2
    assert await _jobs() == [("initial", True, "queued")]


async def test_reconnect_marks_the_cache_changed_again_once_it_has_stored_the_listing(client, scenario: FakeBridgeScenario, monkeypatch):
    """The new credential is committed before SimpleFIN lists the bank accounts, so the listing and the resumed links mark the cache again"""
    headers, _, _, connection_id = await _rejected_with_two_links(client, scenario)
    before = await _changed_at(client, headers)
    paused = PausedBridge("/accounts")
    use_adapter(monkeypatch, simplefin_adapter(paused))

    async with asyncio.timeout(10):
        reconnecting = asyncio.create_task(_reconnect(client, headers, connection_id, await scenario.new_setup_token()))
        await paused.reached.wait()
        while_listing = await _changed_at(client, headers)
        paused.release.set()
        response = await reconnecting

    assert response.status_code == 200, response.text
    assert while_listing != before
    assert await _changed_at(client, headers) != while_listing


async def test_reconnect_through_a_provider_withdrawn_from_new_connections_still_reconnects(client, scenario: FakeBridgeScenario, monkeypatch):
    """Withdrawing SimpleFIN stops new connections only, so a rejected one can still be restored"""
    headers, _, _, connection_id = await _rejected_with_two_links(client, scenario)
    use_adapter(monkeypatch, simplefin_adapter(FakeBridgeTransport()), offered=False)

    response = await _reconnect(client, headers, connection_id, await scenario.new_setup_token())

    assert response.status_code == 200, response.text


async def test_reconnect_by_a_user_who_may_not_link_bank_accounts_is_refused(client, scenario: FakeBridgeScenario, monkeypatch):
    """The bank-linking check is enforced on the reconnect, as on the claim, and the connection stays rejected"""
    headers, _, _, connection_id = await _rejected_with_two_links(client, scenario)
    monkeypatch.setattr(availability, "may_link_bank_accounts", lambda _user_id: False)

    refused = await _reconnect(client, headers, connection_id, await scenario.new_setup_token())

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Bank sync isn't available for your account"
    assert (await _stored_connection(connection_id)).credential_rejected_at is not None


async def test_reconnect_through_a_disabled_provider_is_refused(client, scenario: FakeBridgeScenario, monkeypatch):
    """A deployment that disabled SimpleFIN has no provider to claim the token with, so the connection stays rejected"""
    headers, _, _, connection_id = await _rejected_with_two_links(client, scenario)
    use_adapter(monkeypatch, simplefin_adapter(FakeBridgeTransport()), enabled=False)

    refused = await _reconnect(client, headers, connection_id, await scenario.new_setup_token())

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Choose a bank provider this server supports"
    assert (await _stored_connection(connection_id)).credential_rejected_at is not None


async def test_reconnect_of_another_users_or_a_missing_connection_is_not_found(client, scenario: FakeBridgeScenario):
    """Another user's rejected connection is not found, as an unknown id is, and stays rejected"""
    headers, _ = await _sign_up(client)
    async with TestSession() as session:
        other = _build_user("other@example.com")
        session.add(other)
        await session.commit()
    theirs = await _commit_bank_connection(other.id, created_at=datetime.now(UTC) - timedelta(days=30), rejected=True)

    for target in (str(theirs.id), str(uuid.uuid4())):
        refused = await _reconnect(client, headers, target, await scenario.new_setup_token())
        assert refused.status_code == 404, refused.text
        assert refused.json()["detail"] == _NOT_FOUND
    assert (await _stored_connection(str(theirs.id))).credential_rejected_at is not None


async def test_reconnect_refused_by_validation_never_repeats_the_setup_token(client, scenario: FakeBridgeScenario):
    """A token sent in a list is refused without the refusal or the printed request repeating it"""
    headers, _, _, connection_id = await _rejected_with_two_links(client, scenario)
    token = await scenario.new_setup_token()

    refused = await client.post(
        f"/bank-sync/connections/{connection_id}/reconnect", json={"credentials": {"setup_token": [token]}}, headers=headers
    )

    assert refused.status_code == 422, refused.text
    assert [(error["loc"], error["type"]) for error in refused.json()["detail"]] == [(["body", "credentials"], "dict_type")]
    assert token not in refused.text
    assert token not in repr(ReconnectBankConnectionRequest(credentials={"setup_token": token}))


async def test_reconnect_sent_while_another_is_claiming_keeps_the_first_credential_stored(client, scenario: FakeBridgeScenario, monkeypatch):
    """Two reconnects at once: the one whose claim answers last finds the connection working and is refused"""
    headers, _, _, connection_id = await _rejected_with_two_links(client, scenario)
    paused = PausedBridge("/claim/")
    use_adapter(monkeypatch, simplefin_adapter(paused))
    slow_token, fast_token = await scenario.new_setup_token(), await scenario.new_setup_token()

    async with asyncio.timeout(10):
        slow = asyncio.create_task(_reconnect(client, headers, connection_id, slow_token))
        await paused.reached.wait()
        fast = await _reconnect(client, headers, connection_id, fast_token)
        stored = (await _stored_connection(connection_id)).credential_encrypted
        paused.release.set()
        refused = await slow

    assert fast.status_code == 200, fast.text
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == _WORKING
    assert (await _stored_connection(connection_id)).credential_encrypted == stored


@pytest.mark.parametrize("everyday_listed_as", ["ACT-chequing", "ACT-chequing-2"], ids=["unchanged", "under-a-new-id"])
async def test_reconnect_storing_its_listing_while_an_account_is_unlinked_waits_and_resumes_the_others(
    client, scenario: FakeBridgeScenario, monkeypatch, everyday_listed_as
):
    """Everyday is unlinked as the listing comes back, so the reconnect waits for the unlink and resumes Savings alone

    An unlink locks its link and then the cache row, so the reconnect has to lock the links before
    the cache row, and read Everyday's link again rather than move a link already unlinked
    """
    headers, everyday_id, savings_id, connection_id = await _rejected_with_two_links(client, scenario)
    if everyday_listed_as != "ACT-chequing":
        await scenario.change("PATCH", "/accounts/ACT-chequing", {"id": everyday_listed_as})
    paused = PausedBridge("/accounts")
    use_adapter(monkeypatch, simplefin_adapter(paused))

    async with asyncio.timeout(10):
        reconnecting = asyncio.create_task(_reconnect(client, headers, connection_id, await scenario.new_setup_token()))
        await paused.reached.wait()
        async with TestSession() as unlinking:
            link = await unlinking.scalar(select(BankAccountLink).where(BankAccountLink.account_id == uuid.UUID(everyday_id)).with_for_update())
            link.state = BankLinkState.UNLINKED
            link.unlinked_at = datetime.now(UTC)
            await unlinking.flush()
            unlinking_pid = await unlinking.scalar(select(func.pg_backend_pid()))
            paused.release.set()
            await _wait_until_waiting_on(unlinking_pid, reconnecting)
            await mark_user_cache_changed(unlinking, link.owner_id)
            await unlinking.commit()
        response = await reconnecting

    assert response.status_code == 200, response.text
    assert (response.json()["resumed_account_ids"], response.json()["choose_again_account_ids"]) == ([savings_id], [])
    assert (await _links())[everyday_id][1] == "unlinked"


@pytest.mark.parametrize("marker", ["/claim/", "/accounts"], ids=["during-the-claim", "during-the-listing"])
async def test_reconnect_of_a_connection_disconnected_meanwhile_is_not_found(client, scenario: FakeBridgeScenario, monkeypatch, marker):
    """Disconnected while SimpleFIN answered the reconnect, the connection stays gone and the reconnect says so"""
    headers, everyday_id, savings_id, connection_id = await _rejected_with_two_links(client, scenario)
    paused = PausedBridge(marker)
    use_adapter(monkeypatch, simplefin_adapter(paused))

    async with asyncio.timeout(10):
        reconnecting = asyncio.create_task(_reconnect(client, headers, connection_id, await scenario.new_setup_token()))
        await paused.reached.wait()
        disconnected = await client.delete(f"/bank-sync/connections/{connection_id}", headers=headers)
        paused.release.set()
        refused = await reconnecting

    assert disconnected.status_code == 200, disconnected.text
    assert refused.status_code == 404, refused.text
    assert refused.json()["detail"] == _NOT_FOUND
    assert await _stored_connection(connection_id) is None
    assert {account_id: values[1] for account_id, values in (await _links()).items()} == {everyday_id: "unlinked", savings_id: "unlinked"}
