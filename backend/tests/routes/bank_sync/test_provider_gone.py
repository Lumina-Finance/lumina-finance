"""A connection whose provider's folder was deleted from the server

Deleting a provider's folder has to leave the app working: its connections, links and imported
transactions stay readable under the provider name the connection stored, while nothing is sent, scheduled or
claimed through them, and every request that would reach the provider says why it can't
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.models.bank_sync_job import BankSyncJob
from app.services.bank_sync import account_link, import_range, links
from app.services.bank_sync.availability import PROVIDER_GONE_DETAIL
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _commit_link,
    _commit_listed_connection,
    _commit_review_item,
    _new_account,
    _sign_up,
    _update_connection,
)

# A provider id no folder on this server carries, as a connection made before its folder was deleted stores it
_GONE = "lunar_bank"

# The provider's name as the connection stored it while the provider was installed
_GONE_NAME = "Lunar Bank"

# Noon on October 5 in Toronto, the zone _sign_up stores
_NOW = datetime(2026, 10, 5, 12, 0, tzinfo=ZoneInfo("America/Toronto"))

# A link whose import ended, which last synced this morning
_SYNCED = {"importing": False, "last_success_at": _NOW - timedelta(hours=5), "last_attempt_at": _NOW - timedelta(hours=5)}


@pytest.fixture(autouse=True)
def _pinned_now(pin_clock):
    """Pin the time the link, import range and account link routes read"""
    pin_clock(_NOW, links, import_range, account_link)


async def _everyday_on_a_gone_provider(client, **values):
    """Sign up with Everyday linked through a connection whose provider is no longer installed

    Returns:
        The user's headers, Everyday's id and the connection
    """
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW, provider=_GONE, provider_name=_GONE_NAME)
    await _commit_link(account_id, connection, **(_SYNCED | values))
    return headers, account_id, connection


async def _queued_jobs() -> list:
    """Return every job queued, read as the table owner"""
    async with TestSession() as session:
        return (await session.scalars(select(BankSyncJob.id))).all()


async def test_connection_list_shows_the_connection_under_its_stored_name_with_nothing_to_link_or_spend(client):
    """The connection keeps its bank accounts, names its provider by the name it stored, offers no account to link and has no request limit"""
    headers, account_id, connection = await _everyday_on_a_gone_provider(client)
    await _new_account(client, headers, "Savings")

    response = await client.get("/bank-sync/connections", headers=headers)

    assert response.status_code == 200, response.text
    [listed] = response.json()
    assert (listed["id"], listed["provider"], listed["provider_name"], listed["provider_site"], listed["provider_available"]) == (
        str(connection.id),
        _GONE,
        _GONE_NAME,
        _GONE,
        False,
    )
    assert [(account["linked_account_id"], account["eligible_account_ids"]) for account in listed["accounts"]] == [(account_id, [])]
    assert listed["request_budget"] == {"limit": None, "used": 0, "available_again_at": None, "held_by_provider": False}


async def test_account_page_reads_the_link_and_its_waiting_items(client):
    """Everyday's page still shows its link and what waits for review, naming the provider by the name its connection stored"""
    headers, account_id, _ = await _everyday_on_a_gone_provider(client)
    await _commit_review_item(account_id)

    response = await client.get(f"/accounts/{account_id}/bank-link", headers=headers)

    assert response.status_code == 200, response.text
    link = response.json()["link"]
    assert (link["provider"], link["provider_name"], link["provider_available"], link["import"]) == (_GONE, _GONE_NAME, False, None)
    assert link["sync"]["waiting_new_count"] == 1


async def test_links_and_review_list_read_as_before(client):
    """The links list and the review list answer, so Settings and the review page keep working"""
    headers, account_id, _ = await _everyday_on_a_gone_provider(client)
    await _commit_review_item(account_id, provider=_GONE)

    listed = await client.get("/bank-sync/links", headers=headers)
    review = await client.get("/bank-review/items", headers=headers)

    assert listed.status_code == 200, listed.text
    assert [(link["provider"], link["provider_name"], link["provider_available"]) for link in listed.json()] == [(_GONE, _GONE_NAME, False)]
    assert review.status_code == 200, review.text
    assert [item["provider_name"] for item in review.json()["items"]] == [_GONE]


async def test_sync_now_is_refused_saying_the_provider_is_gone_and_queues_nothing(client):
    """Pressing Sync now on Everyday explains that the provider is no longer on the server"""
    headers, account_id, _ = await _everyday_on_a_gone_provider(client)

    refused = await client.post(f"/accounts/{account_id}/bank-link/sync", headers=headers)

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == PROVIDER_GONE_DETAIL
    assert await _queued_jobs() == []


async def test_reconnecting_is_refused_saying_the_provider_is_gone(client):
    """A rejected connection on a provider no longer installed can't be reconnected, and nothing is claimed"""
    headers, _, connection = await _everyday_on_a_gone_provider(client)
    await _update_connection(connection, credential_rejected_at=_NOW)

    refused = await client.post(
        f"/bank-sync/connections/{connection.id}/reconnect", json={"credentials": {"access_key": "anything"}}, headers=headers
    )

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == PROVIDER_GONE_DETAIL


async def test_action_needed_reads_a_rejected_connection_by_its_stored_id(client):
    """A connection rejected before the folder was deleted still reads as needing a reconnect on the account's page"""
    headers, account_id, connection = await _everyday_on_a_gone_provider(client)
    await _update_connection(connection, credential_rejected_at=_NOW)

    response = await client.get(f"/accounts/{account_id}/bank-link", headers=headers)

    assert response.status_code == 200, response.text
    assert response.json()["link"]["sync"]["state"] == "reconnect_needed"


async def test_disconnecting_still_works(client):
    """The user can remove the connection, keeping what it imported"""
    headers, _, connection = await _everyday_on_a_gone_provider(client)

    response = await client.delete(f"/bank-sync/connections/{connection.id}", headers=headers)

    assert response.status_code == 200, response.text
