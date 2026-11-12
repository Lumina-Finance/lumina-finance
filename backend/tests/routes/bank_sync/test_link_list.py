"""Listing the user's bank links with their status. The app keeps that status current while it's open

Every live link on the user's own personal accounts is listed, a link waiting for its bank account to
be chosen again included, so each screen reads the same status the account's page does
"""

import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.models.account import Account
from app.models.bank_connection import BankLinkState
from app.services.bank_sync import account_link
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _build_bank_link,
    _commit_link,
    _commit_listed_connection,
    _commit_other_users_account,
    _new_account,
    _new_group_account,
    _sign_up,
)
from tests.routes.support.query_helpers import _get_with_selects

# Noon on October 5 in Toronto, the zone _sign_up stores
_NOW = datetime(2026, 10, 5, 12, 0, tzinfo=ZoneInfo("America/Toronto"))


@pytest.fixture(autouse=True)
def _pinned_now(pin_clock):
    """Pin the time the link routes read"""
    pin_clock(_NOW, account_link)


async def _list_links(client, headers):
    """List the user's links through the route"""
    return await client.get("/bank-sync/links", headers=headers)


async def test_bank_links_list_each_live_link_oldest_first_with_its_status(client):
    """Everyday imports, Savings waits for its bank account to be chosen again, and Old is unlinked so isn't listed"""
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    savings_id = await _new_account(client, headers, "Savings")
    old_id = await _new_account(client, headers, "Old")
    connection = await _commit_listed_connection(user_id, "ACT-1", "ACT-2", "ACT-3", discovered_at=_NOW)
    await _commit_link(savings_id, connection, "ACT-2", state=BankLinkState.CHOOSE_ACCOUNT, linked_at=_NOW - timedelta(days=2))
    await _commit_link(everyday_id, connection, "ACT-1", linked_at=_NOW - timedelta(days=3))
    await _commit_link(old_id, connection, "ACT-3", state=BankLinkState.UNLINKED, unlinked_at=_NOW - timedelta(days=1))

    response = await _list_links(client, headers)

    assert response.status_code == 200, response.text
    listed = [(link["account_id"], link["state"], link["import"] is not None, link["sync"]["state"]) for link in response.json()]
    assert listed == [(everyday_id, "active", True, "importing"), (savings_id, "choose_account", False, "choose_account")]


async def test_bank_links_leave_out_a_group_accounts_link(client):
    """A link on a group account the user administers isn't one of their own personal accounts' links"""
    headers, user_id = await _sign_up(client)
    group_account_id = await _new_group_account(client, headers)
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    async with TestSession() as session:
        link = _build_bank_link(await session.get_one(Account, uuid.UUID(group_account_id)), connection)
        link.owner_id = user_id
        session.add(link)
        await session.commit()

    response = await _list_links(client, headers)

    assert response.status_code == 200, response.text
    assert response.json() == []


async def test_bank_links_leave_out_another_users_links(client):
    """Another user's link never shows in the user's list"""
    headers, _ = await _sign_up(client)
    theirs = await _commit_other_users_account()
    await _commit_link(theirs.id, await _commit_listed_connection(theirs.owner_id, discovered_at=_NOW))

    response = await _list_links(client, headers)

    assert response.status_code == 200, response.text
    assert response.json() == []


async def test_bank_links_read_a_fixed_number_of_statements_however_many_links_import(client):
    """The app polls the list every few seconds while an import runs, so more links on more connections cost no more reads"""
    headers, user_id = await _sign_up(client)
    account_ids = [await _new_account(client, headers, name) for name in ("Everyday", "Savings", "Visa")]
    bank_account_ids = ["ACT-1", "ACT-2", "ACT-3"]
    first = await _commit_listed_connection(user_id, bank_account_ids[0], discovered_at=_NOW)
    await _commit_link(account_ids[0], first, bank_account_ids[0])
    one_listed, one_selects = await _get_with_selects(client, "/bank-sync/links", headers)
    for account_id, bank_account_id in zip(account_ids[1:], bank_account_ids[1:], strict=True):
        await _commit_link(account_id, await _commit_listed_connection(user_id, bank_account_id, discovered_at=_NOW), bank_account_id)

    three_listed, three_selects = await _get_with_selects(client, "/bank-sync/links", headers)

    assert [link["sync"]["state"] for link in one_listed] == ["importing"]
    assert [link["sync"]["state"] for link in three_listed] == ["importing"] * 3
    assert len(three_selects) == len(one_selects)
