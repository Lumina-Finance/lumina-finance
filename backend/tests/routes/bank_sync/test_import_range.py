"""Reading where a bank import into an account may start

The start step shows this range before anything is linked, so it must answer only for the user's own
personal account, through a provider the deployment enables, and only for a user who may link
"""

import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.models.account import Account
from app.models.bank_connection import BankProvider
from app.services.bank_sync import availability, import_range
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _build_account,
    _build_category,
    _build_ledger_transaction,
    _build_user,
    _new_account,
    _sign_up,
)

# The zone _sign_up stores on the user
_USER_TZ = ZoneInfo("America/Toronto")


async def _read_range(client, headers, account_id, provider: str = "simplefin"):
    """Read an account's import range through the route"""
    return await client.get(f"/accounts/{account_id}/bank-link/import-range", params={"provider": provider}, headers=headers)


async def test_import_range_route_answers_in_the_users_timezone(client, pin_clock):
    """At 11pm on October 3 in Toronto, already October 4 in UTC, the range ends on October 3

    Everyday's latest transaction is on August 24, so SimpleFIN's 12-month range starts the day after it
    """
    pin_clock(datetime(2026, 10, 3, 23, 0, tzinfo=_USER_TZ), import_range)
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    async with TestSession() as session:
        category = _build_category(user_id)
        session.add(category)
        await session.flush()
        transaction = _build_ledger_transaction(await session.get_one(Account, uuid.UUID(account_id)), category.id)
        transaction.dt = date(2026, 8, 24)
        session.add(transaction)
        await session.commit()

    response = await _read_range(client, headers, account_id)

    assert response.status_code == 200, response.text
    assert response.json() == {
        "suggested_start": "2026-08-25",
        "default_suggestion": "2026-07-01",
        "earliest_allowed": "2026-08-25",
        "latest_allowed": "2026-10-03",
        "ledger_floor": "2026-08-25",
        "provider_limit_date": "2025-10-01",
        "provider_history_months": 12,
        "latest_ledger_date": "2026-08-24",
    }


async def test_import_range_of_a_group_account_is_refused_to_its_admin(client):
    """A group account isn't the user's own, so even the group's admin can't link it"""
    headers, _ = await _sign_up(client)
    group = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    assert group.status_code == 201, group.text
    account_id = await _new_account(client, headers, "Joint", group_id=group.json()["id"])

    refused = await _read_range(client, headers, account_id)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Accounts shared with a group can't be linked to a bank yet"


async def test_import_range_of_another_users_account_is_not_found(client):
    """Another user's account reads the same as one that doesn't exist"""
    headers, _ = await _sign_up(client)
    async with TestSession() as session:
        other = _build_user("other@example.com")
        session.add(other)
        await session.flush()
        theirs = _build_account(other.id, name="Theirs")
        session.add(theirs)
        await session.commit()

    refused = await _read_range(client, headers, theirs.id)
    missing = await _read_range(client, headers, uuid.uuid4())

    assert refused.status_code == 404, refused.text
    assert refused.json()["detail"] == "Account not found"
    assert missing.status_code == 404, missing.text
    assert missing.json()["detail"] == "Account not found"


async def test_import_range_through_a_disabled_provider_is_refused(client, monkeypatch):
    """A deployment that disabled SimpleFIN has no history limit to offer"""
    monkeypatch.delitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN)
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")

    refused = await _read_range(client, headers, account_id)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Choose a bank provider this server supports"


async def test_import_range_for_a_user_who_may_not_link_bank_accounts_is_refused(client, monkeypatch):
    """The bank-linking check is enforced on the start step's range, not only in the interface"""
    monkeypatch.setattr(availability, "may_link_bank_accounts", lambda _user_id: False)
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")

    refused = await _read_range(client, headers, account_id)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Bank sync isn't available for your account"
