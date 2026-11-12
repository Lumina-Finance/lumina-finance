"""Reading each account's review backlog

The review block reads how many new items wait on each account it shows, and whether that account's
sync is paused or warned for them, so it can say so above the items. Like the review list, only the
user's own personal accounts have a backlog
"""

import uuid
from datetime import UTC, datetime

import pytest

from app.models.account import Account
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _build_bank_link,
    _commit_listed_connection,
    _commit_other_users_account,
    _commit_paused_link,
    _commit_review_item,
    _commit_waiting_items,
    _new_account,
    _new_group_account,
    _sign_up,
)

_NOW = datetime(2026, 10, 4, 9, 30, tzinfo=UTC)

# Why a group account's backlog is refused, the review list's own
_NOT_OWN_DETAIL = "Bank items aren't listed for accounts shared with a group"


async def _commit_synced_link(account_id: str) -> None:
    """Commit 85 new items waiting on the account, linked to ACT-2 on a connection of its own, its import ended and its sync running"""
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(account_id))
    connection = await _commit_listed_connection(account.owner_id, "ACT-2")
    link = _build_bank_link(account, connection, "ACT-2", importing=False)
    async with TestSession() as session:
        session.add(link)
        await session.commit()
    await _commit_waiting_items(link, 85)


def _backlog(account_id: str, waiting: int, *, paused: bool = False, warning: bool = False) -> dict:
    """Return an account's backlog as the route sends it"""
    return {"account_id": account_id, "waiting_new_count": waiting, "paused": paused, "review_warning": warning}


async def test_backlogs_show_each_accounts_waiting_items_pause_and_warning(client):
    """Everyday is paused with 105 waiting, Savings warned with 85, and Travel, never linked, shows neither with 1"""
    headers, _ = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    savings_id = await _new_account(client, headers, "Savings")
    travel_id = await _new_account(client, headers, "Travel")
    await _commit_waiting_items(await _commit_paused_link(everyday_id, _NOW), 105)
    await _commit_synced_link(savings_id)
    await _commit_review_item(travel_id)

    response = await client.get("/bank-review/backlogs", params={"account_id": [savings_id, everyday_id, travel_id]}, headers=headers)

    assert response.status_code == 200, response.text
    assert response.json() == [
        _backlog(savings_id, 85, warning=True),
        _backlog(everyday_id, 105, paused=True),
        _backlog(travel_id, 1),
    ]


async def test_backlogs_for_every_account_leave_out_group_and_other_users_accounts(client):
    """Without accounts named, Everyday and Savings each have a backlog, and neither the Joint group account nor another user's does

    Joint's item is recorded as its admin's own, so only the group scope leaves it out
    """
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    savings_id = await _new_account(client, headers, "Savings")
    await _commit_review_item(everyday_id)
    await _commit_review_item(await _new_group_account(client, headers), owner_id=user_id)
    await _commit_review_item((await _commit_other_users_account()).id)

    response = await client.get("/bank-review/backlogs", headers=headers)

    assert response.status_code == 200, response.text
    assert sorted(response.json(), key=lambda backlog: backlog["account_id"]) == sorted(
        [_backlog(everyday_id, 1), _backlog(savings_id, 0)], key=lambda backlog: backlog["account_id"]
    )


@pytest.mark.parametrize(
    ("second", "status_code", "detail"),
    [("group", 403, _NOT_OWN_DETAIL), ("theirs", 404, "Account not found")],
)
async def test_backlogs_refuse_accounts_that_arent_the_users_own(client, second, status_code, detail):
    """Everyday named with the Joint group account is refused, even for its admin, and with another user's account is not found"""
    headers, _ = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    second_id = await _new_group_account(client, headers) if second == "group" else str((await _commit_other_users_account()).id)

    response = await client.get("/bank-review/backlogs", params={"account_id": [everyday_id, second_id]}, headers=headers)

    assert response.status_code == status_code, response.text
    assert response.json()["detail"] == detail
