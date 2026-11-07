"""Listing and dismissing bank holds through the routes

These tests catch a hold listed for an account the user doesn't own, a dismissed hold still listed,
a group account's holds read, and a dismissal reaching another user's hold
"""

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import select

from app.models.account import Account
from app.models.bank_connection import BankConnection
from app.models.bank_hold import BankHold
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _commit_listed_connection,
    _commit_other_users_account,
    _link,
    _new_account,
    _new_group_account,
    _sign_up,
)


async def _commit_hold(account_id: str, description: str = "CARD CHECK", day: date = date(2026, 10, 4)) -> uuid.UUID:
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
            observed_at=datetime(2026, 10, 4, 9, 0, tzinfo=UTC),
        )
        session.add(hold)
        await session.commit()
    return hold.id


async def test_holds_list_newest_first_and_a_dismissed_one_leaves_the_list(client):
    """Two holds list newest first, and dismissing the newer one leaves only the older"""
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    older = await _commit_hold(account_id, "OLDER", date(2026, 10, 2))
    newer = await _commit_hold(account_id, "NEWER", date(2026, 10, 3))

    listed = await client.get("/bank-sync/holds", headers=headers)
    dismissed = await client.post(f"/bank-sync/holds/{newer}/dismiss", headers=headers)
    after = await client.get("/bank-sync/holds", params={"account_id": account_id}, headers=headers)

    assert [item["id"] for item in listed.json()] == [str(newer), str(older)]
    assert dismissed.status_code == 204
    assert [item["id"] for item in after.json()] == [str(older)]


async def test_another_users_holds_are_not_listed_or_dismissable(client):
    """The signed-in user sees none of another user's holds and gets a 404 dismissing one"""
    headers, _ = await _sign_up(client)
    theirs = await _commit_other_users_account()
    hold = await _commit_hold(str(theirs.id))

    listed = await client.get("/bank-sync/holds", headers=headers)
    dismissed = await client.post(f"/bank-sync/holds/{hold}/dismiss", headers=headers)

    assert listed.json() == []
    assert dismissed.status_code == 404


async def _hold_descriptions() -> list[str]:
    """Return the description of every stored hold, dismissed or not"""
    async with TestSession() as session:
        return sorted((await session.scalars(select(BankHold.description))).all())


async def _linked_with_holds(client) -> tuple[dict, str, str, BankConnection]:
    """Link Everyday to ACT-1 and Savings to ACT-2, each with a hold, one of Everyday's already dismissed"""
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    savings_id = await _new_account(client, headers, "Savings")
    connection = await _commit_listed_connection(user_id, "ACT-1", "ACT-2", discovered_at=datetime.now(UTC))
    assert (await _link(client, headers, everyday_id, connection.id, "ACT-1")).status_code == 201
    assert (await _link(client, headers, savings_id, connection.id, "ACT-2")).status_code == 201
    dismissed = await _commit_hold(everyday_id, "EVERYDAY DISMISSED")
    await _commit_hold(everyday_id, "EVERYDAY")
    await _commit_hold(savings_id, "SAVINGS")
    assert (await client.post(f"/bank-sync/holds/{dismissed}/dismiss", headers=headers)).status_code == 204
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
