"""Listing a connection's bank accounts for the account being linked

The link flow shows every bank account the connection lists, unavailable ones with their reason
rather than hidden, so the user can see why one can't be chosen. Opening it asks for a fresh
discovery when the last is over an hour old, so a bank added at the provider shows up within minutes
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models.bank_connection import BankExternalAccount
from app.models.institution import Institution, InstitutionStatus
from app.services.bank_sync import availability
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _build_account,
    _build_external_account,
    _build_user,
    _commit_listed_connection,
    _link,
    _new_account,
    _sign_up,
)
from tests.routes.transactions._import_helpers import _import_run


async def _list(client, headers, connection_id, account_id):
    """List a connection's bank accounts for an account through the route"""
    return await client.get(f"/bank-sync/connections/{connection_id}/accounts", params={"for_account_id": str(account_id)}, headers=headers)


async def test_listing_marks_each_bank_account_linkable_or_unavailable_with_its_reason(client, monkeypatch):
    """For Everyday (CAD), with a limit of one institution and Harbour Bank already linked to Savings

    Harbour's other CAD account is linkable, the one Savings takes, the USD one and the points one
    are unavailable, Lakeshore would go over the limit, and one the connection no longer lists is left out
    """
    monkeypatch.setattr(availability, "get_institution_limit", lambda _user_id, _provider: 1)
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    savings_id = await _new_account(client, headers, "Savings")
    connection = await _commit_listed_connection(user_id, "ACT-1", "ACT-2", discovered_at=datetime.now(UTC))
    async with TestSession() as session:
        balance_at = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)
        added = [_build_external_account(connection, external_id) for external_id in ("ACT-USD", "ACT-PTS", "ACT-LAKE", "ACT-GONE")]
        added[0].currency = "USD"
        added[1].currency = "https://bank.example/points"
        added[2].institution_key, added[2].institution_name = "lakeshore", "Lakeshore Credit Union"
        added[3].listed = False
        session.add_all(added)
        await session.flush()
        harbour = await session.scalar(select(BankExternalAccount).where(BankExternalAccount.external_id == "ACT-2"))
        harbour.balance, harbour.balance_at = 1_234_56, balance_at
        await session.commit()
    assert (await _link(client, headers, savings_id, connection.id, "ACT-1")).status_code == 201

    listed = await _list(client, headers, connection.id, everyday_id)

    assert listed.status_code == 200, listed.text
    unavailable = {
        "ACT-1": ("already_linked", "Already linked to Savings"),
        "ACT-PTS": ("custom_currency", "Uses a currency of its own that Lumina Finance can't track"),
        "ACT-USD": ("currency_mismatch", "In USD, but Everyday is in CAD"),
        "ACT-LAKE": ("institution_limit", "Would go over your limit of 1 institution for Fake Bank"),
    }
    assert [
        (account["external_id"], account["linkable"], account["unavailable_reason"], account["unavailable_message"])
        for account in listed.json()["accounts"]
    ] == [
        (external_id, external_id not in unavailable, *unavailable.get(external_id, (None, None)))
        for external_id in ("ACT-1", "ACT-2", "ACT-PTS", "ACT-USD", "ACT-LAKE")
    ]
    assert listed.json()["accounts"][1] == {
        "external_id": "ACT-2",
        "name": "Everyday Chequing",
        "institution_name": "Harbour Bank",
        "currency": "CAD",
        "balance": 1_234_56,
        "balance_date": "2026-10-01T09:00:00Z",
        "linkable": True,
        "unavailable_reason": None,
        "unavailable_message": None,
        "institution_differs": False,
    }
    assert listed.json()["discovery_pending"] is False


@pytest.mark.parametrize("named", ["Harbour", "Harbour Bank Canada"], ids=["shorter-name", "longer-name"])
async def test_listing_says_which_institutions_look_different_from_the_accounts(client, named):
    """Whether Everyday names Harbour or Harbour Bank Canada, Harbour Bank reads as the same institution

    Lakeshore Credit Union reads as a different one
    """
    headers, user_id = await _sign_up(client)
    async with TestSession() as session:
        institution = Institution(status=InstitutionStatus.CANONICAL, name=named, country_code="CA", website="https://harbour.example")
        session.add(institution)
        await session.commit()
    everyday_id = await _new_account(client, headers, "Everyday", institution_id=str(institution.id))
    connection = await _commit_listed_connection(user_id, "ACT-1", discovered_at=datetime.now(UTC))
    async with TestSession() as session:
        lakeshore = _build_external_account(connection, "ACT-LAKE")
        lakeshore.institution_key, lakeshore.institution_name = "lakeshore", "Lakeshore Credit Union"
        session.add(lakeshore)
        await session.commit()

    listed = await _list(client, headers, connection.id, everyday_id)

    assert listed.status_code == 200, listed.text
    assert [(account["external_id"], account["institution_differs"]) for account in listed.json()["accounts"]] == [
        ("ACT-1", False),
        ("ACT-LAKE", True),
    ]


@pytest.mark.parametrize(
    ("last_discovered", "asks"),
    [(timedelta(hours=3), True), (timedelta(minutes=20), False)],
    ids=["3-hours-ago", "20-minutes-ago"],
)
async def test_listing_marks_the_cache_changed_only_when_it_asks_for_a_fresh_discovery(client, last_discovered, asks):
    """Listed 3 hours ago, opening the flow queues a discovery that other sessions learn of. Listed 20 minutes ago, nothing changes

    Which ages ask for a discovery is tested to the second in the service tests
    """
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=datetime.now(UTC) - last_discovered)

    before = await client.get("/me/cache-status", headers=headers)
    listed = await _list(client, headers, connection.id, everyday_id)
    after = await client.get("/me/cache-status", headers=headers)

    assert listed.status_code == 200, listed.text
    assert after.status_code == 200, after.text
    assert (after.json()["personal"]["changed_at"] != before.json()["personal"]["changed_at"]) is asks


async def test_listing_that_asks_for_a_fresh_discovery_leaves_the_last_import_undoable(client):
    """The user imported a file into Everyday, then opened the link flow on a connection listed 3 hours ago and closed it

    Asking for a fresh listing changes none of their data, so the import can still be undone
    """
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=datetime.now(UTC) - timedelta(hours=3))
    imported = await _import_run(
        client,
        headers,
        {
            "accounts": [{"source": "Everyday", "account_id": str(everyday_id)}],
            "categories": [{"source": "Coffee", "create": {"name": "Coffee", "kind": "expense"}}],
            "rows": [
                {
                    "account_source": "Everyday",
                    "category_source": "Coffee",
                    "dt": "2026-09-15",
                    "amount": "-4.50",
                    "merchant_name": "Harbour Coffee",
                }
            ],
        },
    )
    assert imported.status_code == 201, imported.text

    listed = await _list(client, headers, connection.id, everyday_id)
    last = await client.get("/transactions/import/last", headers=headers)

    assert listed.status_code == 200, listed.text
    assert last.status_code == 200, last.text
    assert last.json() is not None


async def test_listing_for_a_user_who_may_not_link_bank_accounts_is_refused(client, monkeypatch):
    """The bank-linking check is enforced on the link flow's list, not only in the interface"""
    monkeypatch.setattr(availability, "may_link_bank_accounts", lambda _user_id: False)
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=datetime.now(UTC))

    refused = await _list(client, headers, connection.id, everyday_id)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Bank sync isn't available for your account"


async def test_listing_for_another_users_connection_or_account_is_not_found(client):
    """Neither another user's connection nor their account is listed or revealed"""
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=datetime.now(UTC))
    async with TestSession() as session:
        other = _build_user("other@example.com")
        session.add(other)
        await session.flush()
        their_account = _build_account(other.id, name="Theirs")
        session.add(their_account)
        await session.commit()
    theirs = await _commit_listed_connection(other.id, discovered_at=datetime.now(UTC))

    their_connection = await _list(client, headers, theirs.id, everyday_id)
    their_account_listed = await _list(client, headers, connection.id, their_account.id)
    missing = await _list(client, headers, uuid.uuid4(), everyday_id)

    assert their_connection.status_code == 404, their_connection.text
    assert their_connection.json()["detail"] == "Bank connection not found"
    assert their_account_listed.status_code == 404, their_account_listed.text
    assert their_account_listed.json()["detail"] == "Account not found"
    assert missing.status_code == 404, missing.text
    assert missing.json()["detail"] == "Bank connection not found"
