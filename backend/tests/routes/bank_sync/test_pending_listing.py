"""Listing the pending bank transactions shown beside the transaction list

The strip reads these for the accounts the list shows, newest first, each with when the bank
reported it, so an account that hasn't synced since doesn't pass off old holds as current. Only the
user's own personal accounts have pending items, and another user's never show
"""

import uuid
from datetime import UTC, date, datetime

from app.models.account import Account
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _build_pending_transaction,
    _commit_other_users_account,
    _new_account,
    _new_group_account,
    _sign_up,
)

_GROUP_DETAIL = "Pending bank transactions aren't listed for accounts shared with a group"


async def _commit_pending(account_id: str | uuid.UUID, **values) -> uuid.UUID:
    """Commit a pending item the bank reports for an account, with any of its values replaced

    Returns:
        The item's id
    """
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(str(account_id)))
        item = _build_pending_transaction(account)
        for field, value in values.items():
            setattr(item, field, value)
        session.add(item)
        await session.commit()
    return item.id


async def _pending(client, headers, **params) -> list[dict]:
    """Return the pending items, read through the route"""
    listed = await client.get("/bank-sync/pending", params=params, headers=headers)
    assert listed.status_code == 200, listed.text
    return listed.json()


async def _listed_ids(client, headers, **params) -> list[str]:
    """Return the ids of the pending items listed, in the order listed"""
    return [item["id"] for item in await _pending(client, headers, **params)]


async def test_pending_list_shows_every_item_newest_first_with_when_the_bank_reported_it(client):
    """Everyday's fuel hold and Uber trip from this morning's sync, and an older USD hold cents can't hold from a sync three days earlier"""
    headers, _ = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    usd_id = await _new_account(client, headers, "US Chequing", currency="USD")
    this_morning = datetime(2026, 10, 4, 9, 0, tzinfo=UTC)
    three_days_earlier = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)
    uber = await _commit_pending(everyday_id, transaction_date=date(2026, 10, 3), amount=-1800, description="UBER TRIP")
    fuel = await _commit_pending(everyday_id)
    amazon = await _commit_pending(
        usd_id,
        transaction_date=date(2026, 9, 30),
        amount=None,
        raw_amount="-12.345",
        description="AMZN MKTP US",
        observed_at=three_days_earlier,
    )

    listed = await _pending(client, headers)

    assert [datetime.fromisoformat(item.pop("observed_at")) for item in listed] == [this_morning, this_morning, three_days_earlier]
    assert listed == [
        {
            "id": str(fuel),
            "account_id": everyday_id,
            "date": "2026-10-04",
            "amount": -2500,
            "raw_amount": None,
            "description": "HOLD HARBOUR FUEL",
        },
        {"id": str(uber), "account_id": everyday_id, "date": "2026-10-03", "amount": -1800, "raw_amount": None, "description": "UBER TRIP"},
        {"id": str(amazon), "account_id": usd_id, "date": "2026-09-30", "amount": None, "raw_amount": "-12.345", "description": "AMZN MKTP US"},
    ]


async def test_pending_list_for_some_accounts_lists_only_theirs(client):
    """Everyday's own page lists its hold alone, and a list filtered to Everyday and Savings their holds without Travel's"""
    headers, _ = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    savings_id = await _new_account(client, headers, "Savings")
    travel_id = await _new_account(client, headers, "Travel")
    everyday_item = await _commit_pending(everyday_id, transaction_date=date(2026, 10, 4))
    savings_item = await _commit_pending(savings_id, transaction_date=date(2026, 10, 3))
    await _commit_pending(travel_id)

    assert await _listed_ids(client, headers, account_id=everyday_id) == [str(everyday_item)]
    assert await _listed_ids(client, headers, account_id=[everyday_id, savings_id]) == [str(everyday_item), str(savings_item)]


async def test_pending_list_refuses_accounts_that_arent_the_users_own_and_never_shows_their_items(client):
    """Another user's hold and a group account's, even one recorded as the admin's own, are in no list, and asking for either is refused"""
    headers, user_id = await _sign_up(client)
    theirs = await _commit_other_users_account()
    await _commit_pending(theirs.id)
    joint_id = await _new_group_account(client, headers)
    await _commit_pending(joint_id, owner_id=user_id)

    every_account = await _pending(client, headers)
    their_account = await client.get("/bank-sync/pending", params={"account_id": str(theirs.id)}, headers=headers)
    group_account = await client.get("/bank-sync/pending", params={"account_id": joint_id}, headers=headers)

    assert every_account == [], "no list shows the other user's or the group account's holds"
    assert their_account.status_code == 404, their_account.text
    assert their_account.json()["detail"] == "Account not found"
    assert group_account.status_code == 403, group_account.text
    assert group_account.json()["detail"] == _GROUP_DETAIL
