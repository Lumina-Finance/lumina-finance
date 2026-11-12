"""Unlinking an account and disconnecting a connection

Either stops syncing without losing history: pending bank transactions go, since nothing can refresh
them, and ledger transactions, their bank source and the items waiting for review stay. Unlinking
keeps the connection, disconnecting deletes it with its credential. Both have to hold while a sync
or a link is mid-flight on the same rows, or pending items reappear or a link outlives its connection
"""

import asyncio
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select, update

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState
from app.models.bank_pending_transaction import BankPendingTransaction
from app.models.bank_sync_job import BankSyncJob
from app.models.bank_transaction import BankTransaction
from app.models.transaction import Transaction
from app.services.bank_sync import availability
from app.services.bank_sync.pending import replace_pending_transactions
from app.services.bank_sync.transaction_hash import hash_bank_transaction_id
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    BANK_ACCOUNT_ID,
    _build_account,
    _build_bank_link,
    _build_bank_transaction,
    _build_category,
    _build_ledger_transaction,
    _build_pending_transaction,
    _build_user,
    _changed_at,
    _commit_listed_connection,
    _link,
    _new_account,
    _sign_up,
)
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.services.bank_sync.fake_provider import FAKE_PROVIDER

_NOT_LINKED = "This account is not linked to a bank"

# The kept bank transactions' keyed hashes, in the order they are read back
_KEPT_HASHES = sorted(hash_bank_transaction_id(FAKE_PROVIDER, BANK_ACCOUNT_ID, bank_id) for bank_id in ("TRN-ACCEPTED", "TRN-WAITING"))


async def _two_linked(client) -> tuple[dict, uuid.UUID, str, str, BankConnection]:
    """Link Everyday to ACT-1 and Savings to ACT-2 on a connection listing four bank accounts"""
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    savings_id = await _new_account(client, headers, "Savings")
    connection = await _commit_listed_connection(user_id, "ACT-1", "ACT-2", "ACT-3", "ACT-4", discovered_at=datetime.now(UTC))
    assert (await _link(client, headers, everyday_id, connection.id, "ACT-1")).status_code == 201
    assert (await _link(client, headers, savings_id, connection.id, "ACT-2")).status_code == 201
    return headers, user_id, everyday_id, savings_id, connection


async def _add_bank_history(account_id: str, *pending_ids: str) -> None:
    """Commit pending items, a bank-imported ledger transaction and a bank item waiting for review on an account"""
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(account_id))
        category = _build_category(account.owner_id)
        category.name = f"Coffee for {account.name}"
        session.add(category)
        await session.flush()
        transaction = _build_ledger_transaction(account, category.id)
        session.add(transaction)
        await session.flush()
        session.add_all(
            [
                _build_bank_transaction(account, "TRN-ACCEPTED", transaction=transaction),
                _build_bank_transaction(account, "TRN-WAITING"),
                *(_build_pending_transaction(account, pending_id) for pending_id in pending_ids),
            ]
        )
        await session.commit()


async def _pending_ids(account_id: str) -> list[str]:
    """Return the bank ids of an account's pending items"""
    async with TestSession() as session:
        rows = await session.scalars(
            select(BankPendingTransaction.description)
            .where(BankPendingTransaction.account_id == uuid.UUID(account_id))
            .order_by(BankPendingTransaction.description)
        )
        return list(rows)


async def _kept_history(account_id: str) -> tuple[int, list[str]]:
    """Return how many ledger transactions an account has, and the keyed hashes of its bank transactions' ids, in order"""
    async with TestSession() as session:
        ledger = await session.scalar(select(func.count()).select_from(Transaction).where(Transaction.account_id == uuid.UUID(account_id)))
        bank = await session.scalars(
            select(BankTransaction.external_transaction_hash)
            .where(BankTransaction.account_id == uuid.UUID(account_id))
            .order_by(BankTransaction.external_transaction_hash)
        )
        return ledger, list(bank)


async def _links_by_account() -> dict[uuid.UUID, tuple]:
    """Return each account's latest link's state, connection and whether it records when it was unlinked"""
    async with TestSession() as session:
        rows = await session.execute(
            select(BankAccountLink.account_id, BankAccountLink.state, BankAccountLink.connection_id, BankAccountLink.unlinked_at).order_by(
                BankAccountLink.linked_at
            )
        )
        return {account_id: (state, connection_id, unlinked_at is not None) for account_id, state, connection_id, unlinked_at in rows}


async def _unlinked_at(account_id: str) -> datetime | None:
    """Return when the account's only link was unlinked"""
    async with TestSession() as session:
        return await session.scalar(select(BankAccountLink.unlinked_at).where(BankAccountLink.account_id == uuid.UUID(account_id)))


async def _unlink(client, headers, account_id: str) -> None:
    """Unlink an account through the route"""
    unlinked = await client.delete(f"/accounts/{account_id}/bank-link", headers=headers)
    assert unlinked.status_code == 200, unlinked.text


async def test_unlink_ends_one_link_clears_its_pending_and_keeps_its_history(client):
    """Unlinking Everyday clears its 3 pending items and keeps its ledger and waiting items, while Savings keeps syncing"""
    headers, _, everyday_id, savings_id, connection = await _two_linked(client)
    await _add_bank_history(everyday_id, "HOLD-1", "HOLD-2", "HOLD-3")
    await _add_bank_history(savings_id, "HOLD-S")
    before = await _changed_at(client, headers)

    unlinked = await client.delete(f"/accounts/{everyday_id}/bank-link", headers=headers)

    assert unlinked.status_code == 200, unlinked.text
    assert unlinked.json() == {"unlinked_account_ids": [everyday_id]}
    assert await _links_by_account() == {
        uuid.UUID(everyday_id): ("unlinked", connection.id, True),
        uuid.UUID(savings_id): ("active", connection.id, False),
    }
    assert (await _pending_ids(everyday_id), await _pending_ids(savings_id)) == ([], ["HOLD-S"])
    assert await _kept_history(everyday_id) == (1, _KEPT_HASHES)
    listed = await client.get("/bank-sync/connections", headers=headers)
    assert listed.status_code == 200, listed.text
    assert [account["linked_account_id"] for account in listed.json()[0]["accounts"]] == [None, savings_id, None, None]
    assert await _changed_at(client, headers) != before


async def test_unlink_of_the_last_account_keeps_the_connection_ready_to_link_again(client):
    """With Everyday and Savings both unlinked the connection stays, 0 of 4 linked, and Everyday links again as a relink"""
    headers, _, everyday_id, savings_id, connection = await _two_linked(client)

    for account_id in (everyday_id, savings_id):
        unlinked = await client.delete(f"/accounts/{account_id}/bank-link", headers=headers)
        assert unlinked.status_code == 200, unlinked.text
    listed = await client.get("/bank-sync/connections", headers=headers)
    relinked = await _link(client, headers, everyday_id, connection.id, "ACT-1")

    assert listed.status_code == 200, listed.text
    assert [account["linked_account_id"] for account in listed.json()[0]["accounts"]] == [None, None, None, None]
    assert relinked.status_code == 201, relinked.text
    async with TestSession() as session:
        kinds = await session.scalars(
            select(BankAccountLink.import_kind).where(BankAccountLink.account_id == uuid.UUID(everyday_id)).order_by(BankAccountLink.linked_at)
        )
        assert list(kinds) == ["initial", "relink"]


async def test_unlink_of_an_institutions_last_bank_account_stops_it_counting_toward_the_limit(client, monkeypatch):
    """Harbour Bank counts while Everyday is linked there, and stops counting once it is unlinked"""
    monkeypatch.setattr(availability, "get_institution_limit", lambda _user_id, _provider: 1)
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=datetime.now(UTC))
    assert (await _link(client, headers, everyday_id, connection.id)).status_code == 201

    linked = await client.get("/bank-sync/providers", headers=headers)
    assert (await client.delete(f"/accounts/{everyday_id}/bank-link", headers=headers)).status_code == 200
    unlinked = await client.get("/bank-sync/providers", headers=headers)

    assert linked.status_code == 200, linked.text
    assert linked.json()["providers"][0]["institutions_in_use"] == ["Harbour Bank"]
    assert unlinked.status_code == 200, unlinked.text
    assert unlinked.json()["providers"][0]["institutions_in_use"] == []


async def test_disconnect_unlinks_every_account_and_deletes_the_connection(client):
    """Disconnecting unlinks Everyday and Savings, deletes the stored access and its jobs, and keeps both ledgers"""
    headers, _, everyday_id, savings_id, connection = await _two_linked(client)
    await _add_bank_history(everyday_id, "HOLD-1")
    await _add_bank_history(savings_id, "HOLD-S")
    before = await _changed_at(client, headers)

    disconnected = await client.delete(f"/bank-sync/connections/{connection.id}", headers=headers)

    assert disconnected.status_code == 200, disconnected.text
    assert sorted(disconnected.json()["unlinked_account_ids"]) == sorted([everyday_id, savings_id])
    assert await _links_by_account() == {
        uuid.UUID(everyday_id): ("unlinked", None, True),
        uuid.UUID(savings_id): ("unlinked", None, True),
    }
    assert (await _pending_ids(everyday_id), await _pending_ids(savings_id)) == ([], [])
    assert await _kept_history(everyday_id) == (1, _KEPT_HASHES)
    async with TestSession() as session:
        assert await session.get(BankConnection, connection.id) is None
        assert list(await session.scalars(select(BankSyncJob.id))) == []
    listed = await client.get("/bank-sync/connections", headers=headers)
    assert listed.status_code == 200, listed.text
    assert listed.json() == []
    assert await _changed_at(client, headers) != before


async def test_disconnect_with_no_account_linked_unlinks_none(client):
    """A connection nothing is linked through is deleted and reports no unlinked account"""
    headers, user_id = await _sign_up(client)
    connection = await _commit_listed_connection(user_id)

    disconnected = await client.delete(f"/bank-sync/connections/{connection.id}", headers=headers)

    assert disconnected.status_code == 200, disconnected.text
    assert disconnected.json() == {"unlinked_account_ids": []}
    async with TestSession() as session:
        assert await session.get(BankConnection, connection.id) is None


async def test_unlink_of_an_account_already_unlinked_is_not_found(client):
    """Everyday's link ended at the first unlink, so a second finds nothing to end and Everyday keeps when it was unlinked"""
    headers, _, everyday_id, _, _ = await _two_linked(client)
    await _unlink(client, headers, everyday_id)
    ended_at = await _unlinked_at(everyday_id)

    again = await client.delete(f"/accounts/{everyday_id}/bank-link", headers=headers)

    assert again.status_code == 404, again.text
    assert again.json()["detail"] == _NOT_LINKED
    assert await _unlinked_at(everyday_id) == ended_at


async def test_disconnect_leaves_a_link_unlinked_before_as_it_was(client):
    """Everyday was unlinked before its connection was disconnected, so only Savings is reported and Everyday keeps when it was unlinked"""
    headers, _, everyday_id, savings_id, connection = await _two_linked(client)
    await _unlink(client, headers, everyday_id)
    ended_at = await _unlinked_at(everyday_id)

    disconnected = await client.delete(f"/bank-sync/connections/{connection.id}", headers=headers)

    assert disconnected.status_code == 200, disconnected.text
    assert disconnected.json() == {"unlinked_account_ids": [savings_id]}
    assert await _unlinked_at(everyday_id) == ended_at


async def test_disconnect_unlinks_a_link_waiting_for_its_bank_account_to_be_chosen_again(client):
    """Everyday waits in Choose bank account and Savings was unlinked before: the disconnect unlinks Everyday and reports it alone"""
    headers, _, everyday_id, savings_id, connection = await _two_linked(client)
    await _unlink(client, headers, savings_id)
    async with TestSession() as session:
        await session.execute(
            update(BankAccountLink).where(BankAccountLink.account_id == uuid.UUID(everyday_id)).values(state=BankLinkState.CHOOSE_ACCOUNT)
        )
        await session.commit()

    disconnected = await client.delete(f"/bank-sync/connections/{connection.id}", headers=headers)

    assert disconnected.status_code == 200, disconnected.text
    assert disconnected.json() == {"unlinked_account_ids": [everyday_id]}
    assert await _links_by_account() == {
        uuid.UUID(everyday_id): ("unlinked", None, True),
        uuid.UUID(savings_id): ("unlinked", None, True),
    }


async def test_unlink_and_disconnect_of_another_users_account_or_connection_are_not_found(client):
    """Another user's linked account and connection are neither changed nor revealed, and an unlinked account says so"""
    headers, _ = await _sign_up(client)
    unlinked_id = await _new_account(client, headers, "Everyday")
    async with TestSession() as session:
        other = _build_user("other@example.com")
        session.add(other)
        await session.flush()
        their_account = _build_account(other.id, name="Theirs")
        session.add(their_account)
        await session.commit()
    theirs = await _commit_listed_connection(other.id)
    async with TestSession() as session:
        session.add(_build_bank_link(their_account, theirs))
        await session.commit()

    their_unlink = await client.delete(f"/accounts/{their_account.id}/bank-link", headers=headers)
    their_disconnect = await client.delete(f"/bank-sync/connections/{theirs.id}", headers=headers)
    not_linked = await client.delete(f"/accounts/{unlinked_id}/bank-link", headers=headers)

    assert their_unlink.status_code == 404, their_unlink.text
    assert their_unlink.json()["detail"] == "Account not found"
    assert their_disconnect.status_code == 404, their_disconnect.text
    assert their_disconnect.json()["detail"] == "Bank connection not found"
    assert not_linked.status_code == 404, not_linked.text
    assert not_linked.json()["detail"] == _NOT_LINKED
    assert await _links_by_account() == {their_account.id: ("active", theirs.id, False)}


async def test_unlink_waits_for_a_sync_finishing_on_the_account_and_clears_what_it_wrote(client):
    """A sync that locked Everyday's link and wrote a pending item finishes first, and the unlink then clears that item"""
    headers, _, everyday_id, _, _ = await _two_linked(client)

    async with TestSession() as finishing:
        await finishing.execute(select(BankAccountLink.id).where(BankAccountLink.account_id == uuid.UUID(everyday_id)).with_for_update())
        account = await finishing.get_one(Account, uuid.UUID(everyday_id))
        await replace_pending_transactions(finishing, account.id, [_build_pending_transaction(account, "HOLD-NEW")])
        finishing_pid = await finishing.scalar(select(func.pg_backend_pid()))
        unlinking = asyncio.create_task(client.delete(f"/accounts/{everyday_id}/bank-link", headers=headers))
        await _wait_until_waiting_on(finishing_pid, unlinking)
        await finishing.commit()
    unlinked = await asyncio.wait_for(unlinking, 10)

    assert unlinked.status_code == 200, unlinked.text
    assert await _pending_ids(everyday_id) == []


async def test_disconnect_waits_for_a_sync_finishing_on_its_job_and_clears_what_it_wrote(client):
    """A sync holding its job finishes before the disconnect, and the disconnect's unlink then clears the pending item the sync wrote"""
    headers, _, everyday_id, savings_id, connection = await _two_linked(client)

    async with TestSession() as finishing:
        await finishing.execute(select(BankSyncJob.id).where(BankSyncJob.connection_id == connection.id).with_for_update())
        finishing_pid = await finishing.scalar(select(func.pg_backend_pid()))
        disconnecting = asyncio.create_task(client.delete(f"/bank-sync/connections/{connection.id}", headers=headers))
        await _wait_until_waiting_on(finishing_pid, disconnecting)

        # The finishing step locks the links after its job. The disconnect must not hold them yet
        await finishing.execute(select(BankAccountLink.id).where(BankAccountLink.connection_id == connection.id).with_for_update())
        account = await finishing.get_one(Account, uuid.UUID(everyday_id))
        await replace_pending_transactions(finishing, account.id, [_build_pending_transaction(account, "HOLD-NEW")])
        await finishing.commit()
    disconnected = await asyncio.wait_for(disconnecting, 10)

    assert disconnected.status_code == 200, disconnected.text
    assert sorted(disconnected.json()["unlinked_account_ids"]) == sorted([everyday_id, savings_id])
    assert await _pending_ids(everyday_id) == []


async def test_disconnect_waits_for_a_link_being_made_through_it_and_unlinks_it_too(client):
    """A link of Everyday that holds the connection commits first, and the disconnect then unlinks it with the rest"""
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id)

    async with TestSession() as linking:
        await linking.execute(select(BankConnection.id).where(BankConnection.id == connection.id).with_for_update(read=True, key_share=True))
        linking.add(_build_bank_link(await linking.get_one(Account, uuid.UUID(everyday_id)), connection))
        await linking.flush()
        linking_pid = await linking.scalar(select(func.pg_backend_pid()))
        disconnecting = asyncio.create_task(client.delete(f"/bank-sync/connections/{connection.id}", headers=headers))
        await _wait_until_waiting_on(linking_pid, disconnecting)
        await linking.commit()
    disconnected = await asyncio.wait_for(disconnecting, 10)

    assert disconnected.status_code == 200, disconnected.text
    assert disconnected.json() == {"unlinked_account_ids": [everyday_id]}
    assert await _links_by_account() == {uuid.UUID(everyday_id): ("unlinked", None, True)}


async def test_link_waits_for_a_disconnect_in_progress_and_finds_the_connection_gone(client):
    """A link sent while the connection is being disconnected waits, then reads the connection as gone"""
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id)

    async with TestSession() as disconnecting:
        doomed = await disconnecting.scalar(select(BankConnection).where(BankConnection.id == connection.id).with_for_update())
        disconnecting_pid = await disconnecting.scalar(select(func.pg_backend_pid()))
        linking = asyncio.create_task(_link(client, headers, everyday_id, connection.id))
        await _wait_until_waiting_on(disconnecting_pid, linking)
        await disconnecting.delete(doomed)
        await disconnecting.commit()
    refused = await asyncio.wait_for(linking, 10)

    assert refused.status_code == 404, refused.text
    assert refused.json()["detail"] == "Bank connection not found"
    assert await _links_by_account() == {}
