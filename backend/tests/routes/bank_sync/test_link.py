"""Linking an account to a bank account on one of the user's connections

A link decides which ledger a bank account's transactions land in, so every rule the link flow's
list shows is checked again here: one bank account feeds one ledger, an account follows one bank
account, the currencies match, and the import never starts outside the account's import range.
Choosing a bank account again goes through the same request and keeps the account's link, but
nothing of the old bank account's progress
"""

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import func, select, update

from app.models.account import Account
from app.models.bank_connection import (
    BankAccountLink,
    BankConnection,
    BankExternalAccount,
    BankLinkState,
)
from app.models.bank_pending_transaction import BankPendingTransaction
from app.models.bank_sync_job import BankSyncJob
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition
from app.services.bank_sync import availability, import_range, links
from app.utils.dates import format_day
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    BANK_ACCOUNT_ID,
    _build_account,
    _build_bank_link,
    _build_bank_transaction,
    _build_category,
    _build_external_account,
    _build_ledger_transaction,
    _build_pending_transaction,
    _build_user,
    _commit_listed_connection,
    _link,
    _new_account,
    _sign_up,
)
from tests.routes.support.link_helpers import _NOW, _linkable
from tests.services.bank_sync.fake_provider import FAKE_PROVIDER, remove_provider, use_adapter

_TODAY = _NOW.date()
_ACCOUNT_ALREADY_LINKED = "This account is already linked to a bank"
_BANK_ACCOUNT_ALREADY_LINKED = "That bank account is already linked to another account"


@pytest.fixture(autouse=True)
def _pinned_now(pin_clock):
    """Pin the time the link and import range routes read"""
    pin_clock(_NOW, links, import_range)


async def _stored_links() -> list[tuple]:
    """Return every stored link's account, connection, bank account, state, kind, start and checkpoint, oldest first"""
    async with TestSession() as session:
        rows = await session.execute(
            select(
                BankAccountLink.account_id,
                BankAccountLink.connection_id,
                BankAccountLink.external_account_id,
                BankAccountLink.state,
                BankAccountLink.import_kind,
                BankAccountLink.import_start,
                BankAccountLink.checkpoint,
            ).order_by(BankAccountLink.linked_at)
        )
        return [tuple(row) for row in rows]


async def _queued_jobs() -> list[tuple]:
    """Return every stored job's connection, kind, discovery flag and status"""
    async with TestSession() as session:
        rows = await session.execute(select(BankSyncJob.connection_id, BankSyncJob.kind, BankSyncJob.discover, BankSyncJob.status))
        return [tuple(row) for row in rows]


async def _importing(account_id: str) -> bool:
    """Return whether an import runs on the account's live link. It holds back its review pause"""
    async with TestSession() as session:
        return await session.scalar(
            select(BankAccountLink.importing).where(
                BankAccountLink.account_id == uuid.UUID(account_id), BankAccountLink.state != BankLinkState.UNLINKED
            )
        )


async def test_link_creates_the_link_and_queues_its_first_import(client):
    """Linking empty Everyday from 30 days ago starts an initial import there, queued at once"""
    headers, _, account_id, connection = await _linkable(client)
    start = _TODAY - timedelta(days=30)

    before = await client.get("/me/cache-status", headers=headers)
    linked = await _link(client, headers, account_id, connection.id, start_date=start)
    after = await client.get("/me/cache-status", headers=headers)

    assert linked.status_code == 201, linked.text
    body = linked.json()

    # The database sets when the account was linked
    body.pop("linked_at")
    assert body == {
        "account_id": account_id,
        "connection_id": str(connection.id),
        "provider": "fake",
        "provider_name": "Fake Bank",
        "provider_site": "Fake Bank Online",
        "provider_available": True,
        "external_account_id": BANK_ACCOUNT_ID,
        "external_account_name": "Everyday Chequing",
        "institution_name": "Harbour Bank",
        "import_start": start.isoformat(),
    }
    assert await _stored_links() == [
        (uuid.UUID(account_id), connection.id, BANK_ACCOUNT_ID, "active", "initial", start, start - timedelta(days=1))
    ]
    assert await _importing(account_id) is True
    assert await _queued_jobs() == [(connection.id, "initial", False, "queued")]
    assert after.status_code == 200, after.text
    assert after.json()["personal"]["changed_at"] != before.json()["personal"]["changed_at"]
    assert after.json()["personal"]["last_change_from_current_session"] is True


async def test_link_of_an_account_unlinked_before_is_a_relink(client):
    """An account that was linked and then unlinked links the same way, with a relink import, and keeps its earlier link"""
    headers, _, account_id, connection = await _linkable(client)
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(account_id))
        session.add(_build_bank_link(account, None, state=BankLinkState.UNLINKED, unlinked_at=_NOW))
        await session.commit()
    start = _TODAY - timedelta(days=10)

    linked = await _link(client, headers, account_id, connection.id, start_date=start)

    assert linked.status_code == 201, linked.text
    assert [(state, kind) for *_, state, kind, _, _ in await _stored_links()] == [("unlinked", "initial"), ("active", "relink")]
    assert await _importing(account_id) is True
    assert await _queued_jobs() == [(connection.id, "initial", False, "queued")]


async def _waiting_to_choose_again(client) -> tuple[dict, str, BankConnection, uuid.UUID, date]:
    """Sign up with Everyday's link to ACT-1 waiting in Choose bank account, its connection now listing ACT-2 instead

    ACT-1 left 4 items waiting for review and a pending item, the link's import had ended and it was
    also waiting on a bank sign-in after 2 failed retries, and Everyday's latest ledger transaction
    is 14 days ago

    Returns:
        The auth headers, Everyday's id, the connection, the link's id and the latest ledger date
    """
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, "ACT-2", discovered_at=_NOW)
    latest = _TODAY - timedelta(days=14)
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(account_id))
        category = _build_category(user_id)
        session.add(category)
        await session.flush()
        transaction = _build_ledger_transaction(account, category.id)
        transaction.dt = latest
        link = _build_bank_link(
            account,
            connection,
            state=BankLinkState.CHOOSE_ACCOUNT,
            last_success_at=_NOW - timedelta(days=12),
            last_failure_reason="Harbour Bank needs you to sign in again.",
            retry_count=2,
            signin_needed_since=_NOW - timedelta(days=11),
            importing=False,
        )
        link_id = link.id
        session.add_all(
            [
                transaction,
                link,
                *(_build_bank_transaction(account, f"TRN-OLD-{number}") for number in range(4)),
                _build_pending_transaction(account, "HOLD-1"),
            ]
        )
        await session.commit()
    return headers, account_id, connection, link_id, latest


async def test_choose_again_moves_the_link_to_the_new_bank_account_from_after_the_latest_ledger_transaction(client):
    """Everyday's latest ledger transaction was 14 days ago and ACT-1 left 4 items waiting: ACT-2 starts the day after, and the 4 stay"""
    headers, account_id, connection, link_id, latest = await _waiting_to_choose_again(client)
    floor = latest + timedelta(days=1)

    ranged = await client.get(f"/accounts/{account_id}/bank-link/import-range", params={"provider": "fake"}, headers=headers)
    too_early = await _link(client, headers, account_id, connection.id, "ACT-2", start_date=latest)
    chosen = await _link(client, headers, account_id, connection.id, "ACT-2", start_date=floor)

    assert ranged.status_code == 200, ranged.text
    assert ranged.json()["earliest_allowed"] == floor.isoformat()
    assert too_early.status_code == 422, too_early.text
    assert too_early.json()["detail"] == f"Choose a start date from {format_day(floor)} to {format_day(_TODAY)}"
    assert chosen.status_code == 201, chosen.text
    assert (chosen.json()["external_account_id"], chosen.json()["import_start"]) == ("ACT-2", floor.isoformat())
    assert await _stored_links() == [(uuid.UUID(account_id), connection.id, "ACT-2", "active", "choose_again", floor, latest)]
    async with TestSession() as session:
        link = await session.get_one(BankAccountLink, link_id)
        waiting = await session.scalar(
            select(func.count()).select_from(BankTransaction).where(BankTransaction.disposition == BankTransactionDisposition.AWAITING_REVIEW)
        )
        pending = await session.scalar(select(func.count()).select_from(BankPendingTransaction))
    assert (link.signin_needed_since, link.last_success_at, link.last_failure_reason, link.retry_count, link.importing) == (
        None,
        None,
        None,
        0,
        True,
    )
    assert (waiting, pending) == (4, 0)
    assert await _queued_jobs() == [(connection.id, "initial", False, "queued")]


async def test_choose_again_can_take_the_old_bank_account_through_another_connection(client):
    """ACT-1 vanished from Everyday's connection but a second one lists it, so Everyday's own link doesn't make it unavailable"""
    headers, user_id, account_id, first = await _linkable(client)
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(account_id))
        session.add(_build_bank_link(account, first, state=BankLinkState.CHOOSE_ACCOUNT))
        await session.execute(update(BankExternalAccount).values(listed=False))
        await session.commit()
    second = await _commit_listed_connection(user_id, discovered_at=_NOW)
    start = _TODAY - timedelta(days=10)

    listed = await client.get(f"/bank-sync/connections/{second.id}/accounts", params={"for_account_id": account_id}, headers=headers)
    chosen = await _link(client, headers, account_id, second.id, start_date=start)

    assert listed.status_code == 200, listed.text
    assert [(bank["external_id"], bank["linkable"], bank["unavailable_reason"]) for bank in listed.json()["accounts"]] == [
        (BANK_ACCOUNT_ID, True, None)
    ]
    assert chosen.status_code == 201, chosen.text
    assert await _stored_links() == [
        (uuid.UUID(account_id), second.id, BANK_ACCOUNT_ID, "active", "choose_again", start, start - timedelta(days=1))
    ]


async def test_choose_again_carries_over_no_reminder_about_the_earlier_bank_accounts_history(client):
    """Everyday's earlier link to ACT-old waits to choose its bank account again

    It reminded, dismissed or not, that its import got history from 9 June rather than 1 June and
    that 2 October may be missing transactions, and was noting a catch-up from 20 September. The
    import that linking ACT-1 starts raises its own reminders, so the live link starts with none
    """
    headers, _, account_id, connection = await _linkable(client)
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(account_id))
        session.add(
            _build_bank_link(
                account,
                connection,
                "ACT-old",
                importing=False,
                state=BankLinkState.CHOOSE_ACCOUNT,
                catchup_requested_start=date(2026, 9, 20),
                earliest_booked_date=date(2026, 9, 25),
                history_reminder_start=date(2026, 6, 1),
                history_reminder_earliest=date(2026, 6, 9),
                history_reminder_dismissed=True,
                cut_off_day=date(2026, 10, 2),
                cut_off_day_dismissed=True,
            )
        )
        await session.commit()

    linked = await _link(client, headers, account_id, connection.id, start_date=_TODAY - timedelta(days=10))

    assert linked.status_code == 201, linked.text
    async with TestSession() as session:
        live = (
            await session.execute(
                select(
                    BankAccountLink.history_reminder_start,
                    BankAccountLink.history_reminder_earliest,
                    BankAccountLink.history_reminder_dismissed,
                    BankAccountLink.cut_off_day,
                    BankAccountLink.cut_off_day_dismissed,
                    BankAccountLink.catchup_requested_start,
                    BankAccountLink.earliest_booked_date,
                ).where(BankAccountLink.account_id == uuid.UUID(account_id), BankAccountLink.state == BankLinkState.ACTIVE)
            )
        ).one()
    assert tuple(live) == (None, None, False, None, False, None, None)


async def test_link_through_a_provider_withdrawn_from_new_connections_still_links(client, fake_provider, monkeypatch):
    """Withdrawing the provider's offer stops only new connections, so an existing one links further accounts"""
    use_adapter(monkeypatch, fake_provider, offered=False)
    headers, _, account_id, connection = await _linkable(client)

    linked = await _link(client, headers, account_id, connection.id)

    assert linked.status_code == 201, linked.text


def _archive_account(account_id, _connection):
    """Return a statement archiving the account"""
    return update(Account).where(Account.id == uuid.UUID(account_id)).values(is_archived=True)


def _reject_connection(_account_id, connection):
    """Return a statement recording that the provider rejected the connection"""
    return update(BankConnection).where(BankConnection.id == connection.id).values(credential_rejected_at=_NOW)


def _unlist_bank_account(_account_id, connection):
    """Return a statement recording that a discovery no longer found the bank account"""
    return update(BankExternalAccount).where(BankExternalAccount.connection_id == connection.id).values(listed=False)


def _change_currency(currency):
    """Return a change giving the bank account another currency"""

    def change(_account_id, connection):
        """Return the statement"""
        return update(BankExternalAccount).where(BankExternalAccount.connection_id == connection.id).values(currency=currency)

    return change


@pytest.mark.parametrize(
    ("change", "status_code", "detail"),
    [
        (_archive_account, 422, "Archived accounts can't be linked to a bank"),
        (_reject_connection, 409, "Fake Bank rejected this connection. Reconnect it in Settings"),
        (_unlist_bank_account, 404, "Fake Bank no longer returns that bank account"),
        (_change_currency("USD"), 422, "That bank account is in USD, but Everyday is in CAD"),
        (
            _change_currency("https://bank.example/points"),
            422,
            "That bank account uses a currency of its own that Lumina Finance can't track",
        ),
    ],
    ids=["archived-account", "rejected-connection", "bank-account-no-longer-listed", "different-currency", "custom-currency"],
)
async def test_link_refusals_save_nothing(client, change, status_code, detail):
    """Each rule the link flow's list shows is checked again, since the list can be out of date"""
    headers, _, account_id, connection = await _linkable(client)
    async with TestSession() as session:
        await session.execute(change(account_id, connection))
        await session.commit()

    refused = await _link(client, headers, account_id, connection.id)

    assert refused.status_code == status_code, refused.text
    assert refused.json()["detail"] == detail
    assert await _stored_links() == []
    assert await _queued_jobs() == []


async def test_link_by_a_user_who_may_not_link_bank_accounts_is_refused(client, monkeypatch):
    """The bank-linking check is enforced on the link, not only in the interface"""
    monkeypatch.setattr(availability, "may_link_bank_accounts", lambda _user_id: False)
    headers, _, account_id, connection = await _linkable(client)

    refused = await _link(client, headers, account_id, connection.id)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Bank sync isn't available for your account"
    assert await _stored_links() == []


@pytest.mark.parametrize("gone", ["turned-off", "removed"])
async def test_link_through_a_provider_turned_off_or_removed_is_refused(client, fake_provider, monkeypatch, gone):
    """A connection whose provider the deployment turned off, or whose folder it deleted, links nothing"""
    if gone == "turned-off":
        use_adapter(monkeypatch, fake_provider, enabled=False)
    else:
        remove_provider(monkeypatch, FAKE_PROVIDER)
    headers, _, account_id, connection = await _linkable(client)

    refused = await _link(client, headers, account_id, connection.id)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Choose a bank provider this server supports"
    assert await _stored_links() == []


async def test_link_of_a_group_account_is_refused_to_its_admin(client):
    """A group account isn't the user's own, so even the group's admin can't link it"""
    headers, user_id = await _sign_up(client)
    group = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    assert group.status_code == 201, group.text
    account_id = await _new_account(client, headers, "Joint", group_id=group.json()["id"])
    connection = await _commit_listed_connection(user_id)

    refused = await _link(client, headers, account_id, connection.id)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Accounts shared with a group can't be linked to a bank yet"
    assert await _stored_links() == []


async def test_link_of_an_account_already_linked_is_refused(client):
    """An account follows one bank account at a time, so linking it to a second is refused"""
    headers, user_id, account_id, _ = await _linkable(client)
    connection = await _commit_listed_connection(user_id, BANK_ACCOUNT_ID, "ACT-2")
    assert (await _link(client, headers, account_id, connection.id)).status_code == 201

    refused = await _link(client, headers, account_id, connection.id, "ACT-2")

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == _ACCOUNT_ALREADY_LINKED
    assert [external_id for _, _, external_id, *_ in await _stored_links()] == [BANK_ACCOUNT_ID]


async def test_link_of_a_bank_account_linked_through_another_connection_is_refused(client):
    """Savings takes the bank account through one connection, so Everyday can't take it through a second over the same Bridge account"""
    headers, user_id, account_id, first = await _linkable(client)
    savings_id = await _new_account(client, headers, "Savings")
    second = await _commit_listed_connection(user_id)
    assert (await _link(client, headers, savings_id, first.id)).status_code == 201

    refused = await _link(client, headers, account_id, second.id)

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == _BANK_ACCOUNT_ALREADY_LINKED
    assert [account for account, *_ in await _stored_links()] == [uuid.UUID(savings_id)]


async def test_link_that_races_another_to_the_same_bank_account_is_refused(client, monkeypatch):
    """A link that missed one committed just before it is still refused, by the one-ledger-per-bank-account rule"""
    headers, user_id, account_id, first = await _linkable(client)
    savings_id = await _new_account(client, headers, "Savings")
    second = await _commit_listed_connection(user_id)
    assert (await _link(client, headers, savings_id, first.id)).status_code == 201

    # As if Savings' link committed after this request read the user's links
    async def read_none(_db, _user_id):
        return {}

    monkeypatch.setattr(links, "read_linked_bank_accounts", read_none)
    refused = await _link(client, headers, account_id, second.id)

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == _BANK_ACCOUNT_ALREADY_LINKED
    assert [account for account, *_ in await _stored_links()] == [uuid.UUID(savings_id)]
    assert await _queued_jobs() == [(first.id, "initial", False, "queued")]


async def test_link_to_an_institution_over_the_limit_is_refused(client, monkeypatch):
    """With a limit of one institution and Harbour Bank linked, a bank account at Lakeshore would go over it"""
    monkeypatch.setattr(availability, "get_institution_limit", lambda _user_id, _provider: 1)
    headers, _, account_id, connection = await _linkable(client)
    savings_id = await _new_account(client, headers, "Savings")
    async with TestSession() as session:
        lakeshore = _build_external_account(connection, "ACT-LAKE")
        lakeshore.institution_key = "lakeshore"
        lakeshore.institution_name = "Lakeshore Credit Union"
        session.add(lakeshore)
        await session.commit()
    assert (await _link(client, headers, savings_id, connection.id)).status_code == 201

    refused = await _link(client, headers, account_id, connection.id, "ACT-LAKE")

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Would go over your limit of 1 institution for Fake Bank"
    assert [account for account, *_ in await _stored_links()] == [uuid.UUID(savings_id)]


async def test_link_of_another_users_account_connection_or_bank_account_is_not_found(client):
    """Nothing of another user's is linked or revealed"""
    headers, _, account_id, connection = await _linkable(client)
    async with TestSession() as session:
        other = _build_user("other@example.com")
        session.add(other)
        await session.commit()
    theirs = await _commit_listed_connection(other.id, "ACT-THEIRS")
    async with TestSession() as session:
        their_account = _build_account(other.id, name="Theirs")
        session.add(their_account)
        await session.commit()

    their_account_refused = await _link(client, headers, their_account.id, connection.id)
    their_connection_refused = await _link(client, headers, account_id, theirs.id, "ACT-THEIRS")
    their_bank_account_refused = await _link(client, headers, account_id, connection.id, "ACT-THEIRS")

    assert their_account_refused.status_code == 404, their_account_refused.text
    assert their_account_refused.json()["detail"] == "Account not found"
    assert their_connection_refused.status_code == 404, their_connection_refused.text
    assert their_connection_refused.json()["detail"] == "Bank connection not found"
    assert their_bank_account_refused.status_code == 404, their_bank_account_refused.text
    assert their_bank_account_refused.json()["detail"] == "Fake Bank no longer returns that bank account"
    assert await _stored_links() == []
