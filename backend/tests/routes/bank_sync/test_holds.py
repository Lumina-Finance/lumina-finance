"""Listing bank holds through the routes

These tests catch holds listed out of order or for an account the user doesn't own, a hold listed
without its provider or what the bank sent for its filing card, a group account's holds read, and
holds left behind once their account's link ends
"""

import uuid
from datetime import UTC, date, datetime

from app.models.account import Account
from app.models.bank_connection import BankConnection
from app.models.bank_hold import BankHold
from app.services.bank_sync.availability import provider_label
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _commit_listed_connection,
    _commit_other_users_account,
    _hold_descriptions,
    _link,
    _new_account,
    _new_group_account,
    _sign_up,
)


async def _commit_hold(
    account_id: str,
    description: str = "CARD CHECK",
    day: date = date(2026, 10, 4),
    *,
    note: str | None = None,
    merchant: str | None = None,
) -> uuid.UUID:
    """Commit a hold the bank reported for an account and return its id"""
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(account_id))
        hold = BankHold(
            owner_id=account.owner_id,
            account_id=account.id,
            provider="fake",
            external_account_id="ACT-1",
            external_transaction_hash=uuid.uuid4().hex + uuid.uuid4().hex,
            hold_date=day,
            description=description,
            note=note,
            merchant=merchant,
            observed_at=datetime(2026, 10, 4, 9, 0, tzinfo=UTC),
        )
        session.add(hold)
        await session.commit()
    return hold.id


async def test_holds_list_newest_first_for_every_account_or_the_one_asked_for(client):
    """Two holds of Everyday list newest first, and asking for Everyday alone lists the same two"""
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    older = await _commit_hold(account_id, "OLDER", date(2026, 10, 2))
    newer = await _commit_hold(account_id, "NEWER", date(2026, 10, 3))

    listed = await client.get("/bank-sync/holds", headers=headers)
    for_everyday = await client.get("/bank-sync/holds", params={"account_id": account_id}, headers=headers)

    assert [item["id"] for item in listed.json()] == [str(newer), str(older)]
    assert [item["id"] for item in for_everyday.json()] == [str(newer), str(older)]


async def test_a_listed_hold_carries_its_provider_and_everything_the_bank_sent(client):
    """A hold lists with its provider's id and name, the bank's date and text, its note and merchant, and when it arrived"""
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    hold_id = await _commit_hold(account_id, "CARD CHECK", note="Card verification", merchant="Shell")

    listed = await client.get("/bank-sync/holds", headers=headers)

    assert listed.status_code == 200
    assert listed.json() == [
        {
            "id": str(hold_id),
            "account_id": account_id,
            "provider": "fake",
            "provider_name": provider_label("fake", None),
            "date": "2026-10-04",
            "description": "CARD CHECK",
            "note": "Card verification",
            "merchant": "Shell",
            "observed_at": "2026-10-04T09:00:00Z",
        }
    ]


async def test_another_users_holds_are_not_listed(client):
    """The signed-in user sees none of another user's holds"""
    headers, _ = await _sign_up(client)
    theirs = await _commit_other_users_account()
    await _commit_hold(str(theirs.id))

    listed = await client.get("/bank-sync/holds", headers=headers)

    assert listed.status_code == 200
    assert listed.json() == []


async def _linked_with_holds(client) -> tuple[dict, str, str, BankConnection]:
    """Link Everyday to ACT-1 and Savings to ACT-2, each with a hold"""
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    savings_id = await _new_account(client, headers, "Savings")
    connection = await _commit_listed_connection(user_id, "ACT-1", "ACT-2", discovered_at=datetime.now(UTC))
    assert (await _link(client, headers, everyday_id, connection.id, "ACT-1")).status_code == 201
    assert (await _link(client, headers, savings_id, connection.id, "ACT-2")).status_code == 201
    await _commit_hold(everyday_id, "EVERYDAY")
    await _commit_hold(savings_id, "SAVINGS")
    return headers, everyday_id, savings_id, connection


async def test_unlinking_an_account_clears_its_holds_and_spares_other_accounts(client):
    """Holds of an unlinked account would never drop, as a sync no longer reaches it"""
    headers, everyday_id, _, _ = await _linked_with_holds(client)

    unlinked = await client.delete(f"/accounts/{everyday_id}/bank-link", headers=headers)

    assert unlinked.status_code == 200, unlinked.text
    assert await _hold_descriptions() == ["SAVINGS"]


async def test_disconnecting_clears_the_holds_of_every_account_on_the_connection(client):
    """Disconnect unlinks both accounts, so both lose their holds"""
    headers, _, _, connection = await _linked_with_holds(client)

    disconnected = await client.delete(f"/bank-sync/connections/{connection.id}", headers=headers)

    assert disconnected.status_code == 200, disconnected.text
    assert await _hold_descriptions() == []


async def test_a_group_accounts_holds_are_refused(client):
    """Holds are listed only for the user's own personal accounts"""
    headers, _ = await _sign_up(client)
    group_account_id = await _new_group_account(client, headers)

    listed = await client.get("/bank-sync/holds", params={"account_id": group_account_id}, headers=headers)

    assert listed.status_code == 403
