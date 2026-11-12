"""Listing bank connections

Settings shows each connection from this list, so its status, bank accounts, eligible accounts, bank
sign-ins, links to choose again and request budget have to read true, and another user's connection
must never show. The app polls it while a discovery is pending, so it runs a fixed number of queries
however many connections there are
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import update

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState, BankProviderRequest
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind, BankSyncJobStatus
from app.services.bank_sync import availability
from tests.conftest import TestSession
from tests.routes.support import _create_account
from tests.routes.support.bank_sync_helpers import (
    _build_bank_link,
    _build_external_account,
    _build_user,
    _commit_bank_connection,
    _sign_up,
)
from tests.routes.support.query_helpers import _get_with_selects

_BUDGET_FREE = {"limit": 20, "used": 0, "available_again_at": None, "held_by_provider": False}


async def _create_usd_account(client, headers, name: str) -> uuid.UUID:
    """Create a USD account through the route and return its id"""
    created = await _create_account(client, headers, name=name, currency="USD")
    assert created.status_code == 201, created.text
    return uuid.UUID(created.json()["id"])


async def test_connections_list_describes_each_connection_and_its_bank_accounts(client):
    """Bank accounts say which account they feed or could feed, a rejected connection keeps its list, and the budget shows"""
    headers, user_id = await _sign_up(client)
    everyday_id = await _create_usd_account(client, headers, "Everyday")
    savings_id = await _create_usd_account(client, headers, "Savings")

    now = datetime.now(UTC)
    harbour = await _commit_bank_connection(user_id, created_at=now - timedelta(days=2), nickname="Joint")
    rejected = await _commit_bank_connection(user_id, created_at=now - timedelta(days=1), rejected=True)
    async with TestSession() as session:
        chequing = _build_external_account(harbour, "ACT-chequing")
        chequing.currency = "USD"
        visa = _build_external_account(harbour, "ACT-visa")
        visa.currency = "USD"
        visa.name = "Rewards Visa"
        miles = _build_external_account(harbour, "ACT-miles")
        miles.currency = "https://www.simplefin.org/currencies/miles"
        miles.name = "Flight Miles"
        gone = _build_external_account(harbour, "ACT-gone")
        gone.listed = False
        kept = _build_external_account(rejected, "ACT-kept")
        kept.currency = "USD"
        kept.name = "Kept Chequing"
        session.add_all([chequing, visa, miles, gone, kept])
        await session.flush()
        session.add(_build_bank_link(await session.get(Account, everyday_id), harbour, "ACT-chequing"))
        session.add_all(
            BankProviderRequest(owner_id=user_id, connection_id=harbour.id, purpose="sync", requested_at=now - timedelta(hours=hours))
            for hours in range(1, 21)
        )
        await session.commit()

    response = await client.get("/bank-sync/connections", headers=headers)

    assert response.status_code == 200, response.text
    body = response.json()
    assert [connection["id"] for connection in body] == [str(harbour.id), str(rejected.id)]
    first, second = body
    assert (first["nickname"], first["status"], first["server_label"], first["discovery_pending"]) == (
        "Joint",
        "active",
        "bridge.example",
        False,
    )
    # The oldest of the 20 requests was 20 hours ago, so one frees in 4 hours
    assert (first["request_budget"]["used"], first["request_budget"]["held_by_provider"]) == (20, False)
    assert datetime.fromisoformat(first["request_budget"]["available_again_at"]) == now + timedelta(hours=4)
    assert [
        (account["external_id"], account["custom_currency"], account["linked_account_id"], account["eligible_account_ids"])
        for account in first["accounts"]
    ] == [
        ("ACT-chequing", False, str(everyday_id), []),
        ("ACT-miles", True, None, []),
        ("ACT-visa", False, None, [str(savings_id)]),
    ]
    assert (second["nickname"], second["status"], second["request_budget"]) == (None, "credential_rejected", _BUDGET_FREE)
    assert [(account["external_id"], account["eligible_account_ids"]) for account in second["accounts"]] == [("ACT-kept", [str(savings_id)])]


async def test_connections_list_says_when_the_providers_quota_signal_holds_the_next_request(client):
    """Fake Bank said its quota was spent after 4 of the connection's 20 requests, so its limit, not the connection's own, holds the next one"""
    headers, user_id = await _sign_up(client)
    now = datetime.now(UTC)
    harbour = await _commit_bank_connection(user_id, created_at=now - timedelta(days=2))
    async with TestSession() as session:
        session.add_all(
            BankProviderRequest(owner_id=user_id, connection_id=harbour.id, purpose="sync", requested_at=now - timedelta(hours=hours))
            for hours in range(1, 5)
        )
        await session.execute(
            update(BankConnection).where(BankConnection.id == harbour.id).values(request_budget_spent_until=now + timedelta(hours=20))
        )
        await session.commit()

    response = await client.get("/bank-sync/connections", headers=headers)

    assert response.status_code == 200, response.text
    [listed] = response.json()
    assert (listed["request_budget"]["used"], listed["request_budget"]["held_by_provider"]) == (20, True)


@pytest.mark.parametrize(
    ("job_status", "pending"),
    [
        (BankSyncJobStatus.QUEUED, True),
        (BankSyncJobStatus.RUNNING, True),
        (BankSyncJobStatus.SUCCEEDED, False),
        (BankSyncJobStatus.FAILED, False),
    ],
    ids=["queued", "running", "succeeded", "failed"],
)
async def test_connections_list_shows_discovery_pending_until_its_job_finishes(client, job_status, pending):
    """A job asked to discover the bank accounts marks its connection as waiting only while it is queued or running"""
    headers, user_id = await _sign_up(client)
    now = datetime.now(UTC)
    connection = await _commit_bank_connection(user_id, created_at=now)
    async with TestSession() as session:
        job = BankSyncJob(owner_id=user_id, connection_id=connection.id, kind=BankSyncJobKind.RETRY, discover=True, status=job_status)
        if job_status is BankSyncJobStatus.RUNNING:
            job.lease_expires_at = now + timedelta(minutes=5)
        if job_status in (BankSyncJobStatus.SUCCEEDED, BankSyncJobStatus.FAILED):
            job.finished_at = now
        session.add(job)
        await session.commit()

    response = await client.get("/bank-sync/connections", headers=headers)

    assert response.status_code == 200, response.text
    assert [(item["discovery_pending"], item["accounts"]) for item in response.json()] == [(pending, [])]


async def test_connections_list_shows_a_bank_account_linked_through_another_connection_until_unlinked(client):
    """Two connections reach the same bank account, so a link made through one shows on both, and unlinking frees it on both"""
    headers, user_id = await _sign_up(client)
    everyday_id = await _create_usd_account(client, headers, "Everyday")
    now = datetime.now(UTC)
    first = await _commit_bank_connection(user_id, created_at=now - timedelta(days=1))
    second = await _commit_bank_connection(user_id, created_at=now)
    async with TestSession() as session:
        for connection in (first, second):
            bank_account = _build_external_account(connection, "ACT-chequing")
            bank_account.currency = "USD"
            session.add(bank_account)
        await session.flush()
        link = _build_bank_link(await session.get(Account, everyday_id), first, "ACT-chequing")
        session.add(link)
        await session.commit()

    linked = await client.get("/bank-sync/connections", headers=headers)
    async with TestSession() as session:
        await session.execute(
            update(BankAccountLink).where(BankAccountLink.id == link.id).values(state=BankLinkState.UNLINKED, unlinked_at=now)
        )
        await session.commit()
    unlinked = await client.get("/bank-sync/connections", headers=headers)

    assert linked.status_code == 200, linked.text
    assert [
        [(account["linked_account_id"], account["eligible_account_ids"]) for account in connection["accounts"]] for connection in linked.json()
    ] == [[(str(everyday_id), [])], [(str(everyday_id), [])]]
    assert unlinked.status_code == 200, unlinked.text
    assert [
        [(account["linked_account_id"], account["eligible_account_ids"]) for account in connection["accounts"]]
        for connection in unlinked.json()
    ] == [[(None, [str(everyday_id)])], [(None, [str(everyday_id)])]]


async def test_connections_list_flags_a_bank_sign_in_and_a_link_to_choose_again_only_on_the_connection_they_go_through(client):
    """A sign-in shows on the bank account whose live link through the connection waits on one, never through a rejected connection"""
    headers, user_id = await _sign_up(client)
    everyday_id = await _create_usd_account(client, headers, "Everyday")
    savings_id = await _create_usd_account(client, headers, "Savings")
    travel_id = await _create_usd_account(client, headers, "Travel")
    joint_id = await _create_usd_account(client, headers, "Joint")
    cards_id = await _create_usd_account(client, headers, "Cards")

    now = datetime.now(UTC)
    harbour = await _commit_bank_connection(user_id, created_at=now - timedelta(days=3))
    second = await _commit_bank_connection(user_id, created_at=now - timedelta(days=2))
    rejected = await _commit_bank_connection(user_id, created_at=now - timedelta(days=1), rejected=True)
    async with TestSession() as session:
        listed = [
            (harbour, "ACT-chequing"),
            (harbour, "ACT-savings"),
            (harbour, "ACT-visa"),
            (second, "ACT-chequing"),
            (rejected, "ACT-joint"),
        ]
        for connection, external_id in listed:
            bank_account = _build_external_account(connection, external_id)
            bank_account.currency = "USD"
            session.add(bank_account)
        await session.flush()
        everyday, savings, travel, joint, cards = [
            await session.get(Account, account_id) for account_id in (everyday_id, savings_id, travel_id, joint_id, cards_id)
        ]
        choose_again = _build_bank_link(travel, harbour, "ACT-old-visa", state=BankLinkState.CHOOSE_ACCOUNT)
        choose_again.external_account_name = "Old Visa"
        # Added after the Visa's, but listed first by its bank account's name
        choose_again_later = _build_bank_link(cards, harbour, "ACT-old-mastercard", state=BankLinkState.CHOOSE_ACCOUNT)
        choose_again_later.external_account_name = "Old Mastercard"
        session.add_all(
            [
                # Everyday once followed the Visa, and its sign-in now belongs to the chequing account it follows
                _build_bank_link(everyday, harbour, "ACT-visa", state=BankLinkState.UNLINKED, unlinked_at=now - timedelta(days=5)),
                _build_bank_link(everyday, harbour, "ACT-chequing", signin_needed_since=now - timedelta(hours=2)),
                _build_bank_link(savings, harbour, "ACT-savings"),
                choose_again,
                choose_again_later,
                _build_bank_link(joint, rejected, "ACT-joint", signin_needed_since=now - timedelta(days=3)),
            ]
        )
        await session.commit()

    response = await client.get("/bank-sync/connections", headers=headers)

    assert response.status_code == 200, response.text
    assert [
        ([(account["external_id"], account["signin_needed"]) for account in connection["accounts"]], connection["choose_again_links"])
        for connection in response.json()
    ] == [
        (
            [("ACT-chequing", True), ("ACT-savings", False), ("ACT-visa", False)],
            [
                {"account_id": str(cards_id), "external_account_name": "Old Mastercard"},
                {"account_id": str(travel_id), "external_account_name": "Old Visa"},
            ],
        ),
        ([("ACT-chequing", False)], []),
        ([("ACT-joint", False)], []),
    ]


async def test_connections_list_offers_no_account_at_a_new_institution_once_the_institution_limit_is_reached(client, monkeypatch):
    """A reached limit leaves a bank account at a new institution offering no account

    With a limit of one institution and Harbour Bank linked, a free Harbour bank account still offers
    Everyday, and one at Lakeshore offers nothing. Settings shows that as over the limit
    """
    monkeypatch.setattr(availability, "get_institution_limit", lambda _user_id, _provider: 1)
    headers, user_id = await _sign_up(client)
    everyday_id = await _create_usd_account(client, headers, "Everyday")
    savings_id = await _create_usd_account(client, headers, "Savings")
    connection = await _commit_bank_connection(user_id, created_at=datetime.now(UTC))
    async with TestSession() as session:
        listed = [_build_external_account(connection, external_id) for external_id in ("ACT-chequing", "ACT-visa", "ACT-lake")]
        for bank_account in listed:
            bank_account.currency = "USD"
        listed[2].institution_key, listed[2].institution_name = "lakeshore", "Lakeshore Credit Union"
        session.add_all(listed)
        await session.flush()
        session.add(_build_bank_link(await session.get(Account, savings_id), connection, "ACT-chequing"))
        await session.commit()

    response = await client.get("/bank-sync/connections", headers=headers)

    assert response.status_code == 200, response.text
    assert [(account["external_id"], account["eligible_account_ids"]) for account in response.json()[0]["accounts"]] == [
        ("ACT-chequing", []),
        ("ACT-visa", [str(everyday_id)]),
        ("ACT-lake", []),
    ]


async def test_connections_list_leaves_out_another_users_connections(client):
    """Only the signed-in user's own connections are listed"""
    headers, _ = await _sign_up(client)
    async with TestSession() as session:
        other = _build_user("other@example.com")
        session.add(other)
        await session.commit()
    await _commit_bank_connection(other.id, created_at=datetime.now(UTC))

    response = await client.get("/bank-sync/connections", headers=headers)

    assert response.status_code == 200, response.text
    assert response.json() == []


async def test_connections_list_runs_the_same_queries_however_many_connections_there_are(client):
    """Three connections with linked bank accounts, pending discoveries and counted requests take the queries one bare connection does"""
    headers, user_id = await _sign_up(client)
    everyday_id = await _create_usd_account(client, headers, "Everyday")
    now = datetime.now(UTC)
    await _commit_bank_connection(user_id, created_at=now - timedelta(days=3))
    one_listed, one_selects = await _get_with_selects(client, "/bank-sync/connections", headers)
    for days in (2, 1):
        connection = await _commit_bank_connection(user_id, created_at=now - timedelta(days=days))
        async with TestSession() as session:
            session.add_all(_build_external_account(connection, f"ACT-{days}-{index}") for index in range(3))
            session.add(BankSyncJob(owner_id=user_id, connection_id=connection.id, kind=BankSyncJobKind.RETRY, discover=True))
            session.add(BankProviderRequest(owner_id=user_id, connection_id=connection.id, purpose="sync", requested_at=now))
            await session.flush()
            if days == 1:
                session.add(_build_bank_link(await session.get(Account, everyday_id), connection, "ACT-1-0"))
            await session.commit()

    three_listed, three_selects = await _get_with_selects(client, "/bank-sync/connections", headers)

    assert len(one_listed) == 1
    assert [(len(connection["accounts"]), connection["discovery_pending"]) for connection in three_listed] == [(0, False), (3, True), (3, True)]
    assert len(three_selects) == len(one_selects)
