"""Reading an account's bank link for the account's page

The page shows the live link with how far its import has got, or what the account was last linked
to, and only for the user's own personal accounts, as linking does
"""

import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select, update

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankImportKind, BankLinkState
from app.models.bank_sync_job import BankSyncJobKind
from app.services.bank_sync import account_link, import_range, links
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _build_bank_link,
    _commit_link,
    _commit_listed_connection,
    _commit_other_users_account,
    _commit_review_item,
    _commit_running_job,
    _link,
    _new_account,
    _new_group_account,
    _sign_up,
    _update_connection,
)

# Noon on October 5 in Toronto, the zone _sign_up stores
_NOW = datetime(2026, 10, 5, 12, 0, tzinfo=ZoneInfo("America/Toronto"))


@pytest.fixture(autouse=True)
def _pinned_now(pin_clock):
    """Pin the time the link, import range and account link routes read"""
    pin_clock(_NOW, links, import_range, account_link)


async def _read_status(client, headers, account_id):
    """Read an account's bank link through the route"""
    return await client.get(f"/accounts/{account_id}/bank-link", headers=headers)


async def test_account_bank_link_shows_its_imports_progress(client):
    """Everyday's import from June 1 to October 5 spans two 90-day windows, and the first is stored

    A bank item received before the link was made isn't one the import found
    """
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    await _commit_review_item(account_id, "TRN-before")
    linked = await _link(client, headers, account_id, connection.id, start_date=date(2026, 6, 1))
    assert linked.status_code == 201, linked.text
    await _commit_review_item(account_id, "TRN-1")
    await _commit_review_item(account_id, "TRN-2")
    async with TestSession() as session:
        await session.execute(
            update(BankAccountLink)
            .where(BankAccountLink.account_id == uuid.UUID(account_id))
            .values(checkpoint=date(2026, 8, 29), earliest_booked_date=date(2026, 6, 2))
        )
        await session.commit()

    response = await _read_status(client, headers, account_id)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["link"].pop("linked_at") == linked.json()["linked_at"]
    assert body == {
        "account_id": account_id,
        "link": {
            "account_id": account_id,
            "connection_id": str(connection.id),
            "provider": "fake",
            "provider_name": "Fake Bank",
            "provider_site": "Fake Bank Online",
            "provider_available": True,
            "external_account_id": "ACT-1",
            "external_account_name": "Everyday Chequing",
            "institution_name": "Harbour Bank",
            "import_start": "2026-06-01",
            "state": "active",
            "import": {
                "kind": "initial",
                "state": "running",
                "requested_start": "2026-06-01",
                "windows_total": 2,
                "windows_done": 1,
                "items_found": 2,
                "earliest_returned_date": "2026-06-02",
            },
            "sync": {
                "state": "importing",
                "last_success_at": None,
                "last_failure": None,
                "next_attempt_at": None,
                "waiting_on_budget": False,
                "held_by_provider": False,
                "sync_running": False,
                "sync_requested": False,
                "waiting_new_count": 3,
                "paused": False,
                "review_warning": False,
            },
            "history_reminder": None,
            "cut_off_day": None,
        },
        "previous_link": None,
        "balance": None,
        "balance_match": None,
    }


async def test_account_bank_link_counts_only_its_own_accounts_items(client):
    """Two accounts importing from one connection each count the items received for them alone"""
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    savings_id = await _new_account(client, headers, "Savings")
    connection = await _commit_listed_connection(user_id, "ACT-1", "ACT-2", discovered_at=_NOW)
    assert (await _link(client, headers, everyday_id, connection.id, "ACT-1")).status_code == 201
    assert (await _link(client, headers, savings_id, connection.id, "ACT-2")).status_code == 201
    await _commit_review_item(everyday_id, "TRN-1")
    await _commit_review_item(savings_id, "TRN-2")
    await _commit_review_item(savings_id, "TRN-3")

    everyday = await _read_status(client, headers, everyday_id)
    savings = await _read_status(client, headers, savings_id)

    assert everyday.status_code == 200, everyday.text
    assert everyday.json()["link"]["import"]["items_found"] == 1
    assert savings.status_code == 200, savings.text
    assert savings.json()["link"]["import"]["items_found"] == 2


@pytest.mark.parametrize(
    ("link_values", "connection_values", "state"),
    [
        pytest.param({"retry_count": 1, "next_attempt_at": _NOW + timedelta(minutes=30)}, {}, "waiting", id="retry-pending"),
        pytest.param({"signin_needed_since": _NOW}, {}, "waiting", id="signin-needed"),
        pytest.param({}, {"credential_rejected_at": _NOW}, "waiting", id="credential-rejected"),
        pytest.param({}, {"request_budget_spent_until": _NOW + timedelta(hours=1)}, "waiting_on_budget", id="budget-spent"),
    ],
)
async def test_account_bank_link_import_reads_as_waiting_while_it_cant_fetch_now(client, link_values, connection_values, state):
    """An import only runs while its next part can be fetched now, so a stall reads as waiting rather than running"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    await _commit_link(account_id, connection, **link_values)
    if connection_values:
        await _update_connection(connection, **connection_values)

    response = await _read_status(client, headers, account_id)

    assert response.status_code == 200, response.text
    assert response.json()["link"]["import"]["state"] == state


async def test_account_bank_link_import_reads_as_running_while_a_sync_fetches_its_retry(client):
    """An import whose failed attempt is being retried runs while the retry fetches, though it still counts as a retry"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    link = await _commit_link(account_id, connection, retry_count=1, next_attempt_at=_NOW - timedelta(minutes=1))
    await _commit_running_job(connection, link, now=_NOW, kind=BankSyncJobKind.RETRY)

    response = await _read_status(client, headers, account_id)

    assert response.status_code == 200, response.text
    assert (response.json()["link"]["import"]["state"], response.json()["link"]["sync"]["state"]) == ("running", "importing")


async def test_account_bank_link_shows_no_progress_once_its_import_ends(client):
    """A first link whose import reached today has nothing left to show progress for"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    await _commit_link(account_id, connection, importing=False)

    response = await _read_status(client, headers, account_id)

    assert response.status_code == 200, response.text
    link = response.json()["link"]
    assert (link["state"], link["import"]) == ("active", None)


async def test_account_bank_link_names_the_latest_of_its_previous_links(client):
    """An account unlinked twice names the bank account it followed last"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, "ACT-1", "ACT-2", discovered_at=_NOW)
    await _commit_link(account_id, connection, "ACT-1", state=BankLinkState.UNLINKED, unlinked_at=_NOW - timedelta(days=9))
    await _commit_link(account_id, connection, "ACT-2", state=BankLinkState.UNLINKED, unlinked_at=_NOW - timedelta(days=1))

    response = await _read_status(client, headers, account_id)

    assert response.status_code == 200, response.text
    assert response.json()["previous_link"]["external_account_id"] == "ACT-2"


async def test_account_bank_link_after_an_unlink_shows_what_it_was_linked_to(client):
    """A never-linked account has nothing to show, and once unlinked it names the bank account it followed"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)

    never_linked = await _read_status(client, headers, account_id)
    assert (await _link(client, headers, account_id, connection.id)).status_code == 201
    unlinked = await client.delete(f"/accounts/{account_id}/bank-link", headers=headers)
    assert unlinked.status_code == 200, unlinked.text
    after_unlink = await _read_status(client, headers, account_id)

    assert never_linked.status_code == 200, never_linked.text
    assert never_linked.json() == {"account_id": account_id, "link": None, "previous_link": None, "balance": None, "balance_match": None}
    async with TestSession() as session:
        unlinked_at = await session.scalar(select(BankAccountLink.unlinked_at).where(BankAccountLink.account_id == uuid.UUID(account_id)))
    assert after_unlink.status_code == 200, after_unlink.text
    body = after_unlink.json()
    assert datetime.fromisoformat(body["previous_link"].pop("unlinked_at")) == unlinked_at
    assert body == {
        "account_id": account_id,
        "link": None,
        "previous_link": {
            "provider_name": "Fake Bank",
            "external_account_id": "ACT-1",
            "external_account_name": "Everyday Chequing",
            "institution_name": "Harbour Bank",
        },
        "balance": None,
        "balance_match": None,
    }


async def test_account_bank_link_shows_no_progress_without_a_recorded_import_start(client):
    """A link waiting for its bank account to be chosen again doesn't sync, and a reconnect's catch-up has no recorded first day"""
    headers, user_id = await _sign_up(client)
    choosing_id = await _new_account(client, headers, "Everyday")
    catching_up_id = await _new_account(client, headers, "Savings")
    connection = await _commit_listed_connection(user_id, "ACT-1", "ACT-2", discovered_at=_NOW)
    async with TestSession() as session:
        choosing = _build_bank_link(await session.get_one(Account, uuid.UUID(choosing_id)), connection, state=BankLinkState.CHOOSE_ACCOUNT)
        catching_up = _build_bank_link(await session.get_one(Account, uuid.UUID(catching_up_id)), connection, "ACT-2")
        catching_up.import_kind = BankImportKind.RECONNECT
        session.add_all([choosing, catching_up])
        await session.commit()

    choosing_status = await _read_status(client, headers, choosing_id)
    catching_up_status = await _read_status(client, headers, catching_up_id)

    assert choosing_status.status_code == 200, choosing_status.text
    assert (choosing_status.json()["link"]["state"], choosing_status.json()["link"]["import"]) == ("choose_account", None)
    assert catching_up_status.status_code == 200, catching_up_status.text
    assert (catching_up_status.json()["link"]["state"], catching_up_status.json()["link"]["import"]) == ("active", None)


async def test_account_bank_link_of_a_group_account_is_refused_to_its_admin(client):
    """A group account isn't the user's own, so even the group's admin has no bank link to read"""
    headers, _ = await _sign_up(client)
    account_id = await _new_group_account(client, headers)

    refused = await _read_status(client, headers, account_id)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Accounts shared with a group can't be linked to a bank yet"


async def test_account_bank_link_of_another_users_account_is_not_found(client):
    """Another user's account reads the same as one that doesn't exist"""
    headers, _ = await _sign_up(client)
    theirs = await _commit_other_users_account()

    refused = await _read_status(client, headers, theirs.id)
    missing = await _read_status(client, headers, uuid.uuid4())

    assert refused.status_code == 404, refused.text
    assert refused.json()["detail"] == "Account not found"
    assert missing.status_code == 404, missing.text
    assert missing.json()["detail"] == "Account not found"
