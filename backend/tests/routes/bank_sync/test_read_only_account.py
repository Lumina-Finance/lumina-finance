"""What the bank link routes do with an account the installed check keeps read-only, as its currency is another than the user's main one

Nothing a bank sends can come into the account, so it can't be linked, synced, given a date range or
matched to the bank's balance, while it can always be unlinked
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import update

from app.models.bank_connection import BankAccountLink, BankExternalAccount
from app.services.bank_sync import account_link, range_import
from tests.conftest import TestSession
from tests.routes.read_only_records._helpers import _refuse_other_currencies
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON
from tests.routes.support.bank_sync_helpers import _commit_link, _commit_listed_connection, _link, _new_account, _queued_jobs, _sign_up

# Noon on October 5 in Toronto, the zone _sign_up stores
_NOW = datetime(2026, 10, 5, 12, 0, tzinfo=ZoneInfo("America/Toronto"))


async def _linked_travel(client) -> tuple[dict, str, BankAccountLink]:
    """Sign up a user with a US account linked to a bank account, last synced 5 hours ago, and return their headers, its id and the link"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Travel", currency="USD")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    link = await _commit_link(account_id, connection, importing=False, last_success_at=_NOW - timedelta(hours=5))
    return headers, account_id, link


async def _stored_link(link: BankAccountLink) -> tuple:
    """Return the link's state, date range, import flag and last successful sync"""
    async with TestSession() as session:
        stored = await session.get_one(BankAccountLink, link.id)
    return stored.state, stored.range_first_day, stored.range_next_day, stored.importing, stored.last_success_at


async def test_link_read_only_account_is_refused_and_links_nothing(client):
    """The bank account stays unlinked"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Travel", currency="USD")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    _refuse_other_currencies()

    response = await _link(client, headers, account_id, connection.id)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    listed = await client.get("/bank-sync/connections", headers=headers)
    assert [account["linked_account_id"] for account in listed.json()[0]["accounts"]] == [None]


@pytest.mark.parametrize("refused", [pytest.param(True, id="refused"), pytest.param(False, id="no-check")])
async def test_connection_offers_a_us_bank_account_no_read_only_account(client, refused):
    """The bank's US account is offered the user's US account only while that account can change"""
    headers, user_id = await _sign_up(client)
    travel_id = await _new_account(client, headers, "Travel", currency="USD")
    await _commit_listed_connection(user_id, discovered_at=_NOW)
    async with TestSession() as session:
        await session.execute(update(BankExternalAccount).values(currency="USD"))
        await session.commit()
    if refused:
        _refuse_other_currencies()

    listed = await client.get("/bank-sync/connections", headers=headers)

    assert listed.status_code == 200, listed.text
    assert listed.json()[0]["accounts"][0]["eligible_account_ids"] == ([] if refused else [travel_id])


@pytest.mark.parametrize(
    ("path", "body"),
    [
        pytest.param("sync", None, id="sync-now"),
        pytest.param("range-import", {"first_day": "2026-03-01", "last_day": "2026-03-31"}, id="range-import"),
        pytest.param("balance-match", {"offered_amount": 100_00}, id="balance-match"),
    ],
)
async def test_bank_link_write_on_a_read_only_account_is_refused_and_changes_nothing(client, pin_clock, path, body):
    """The link stays as its last sync left it and no sync is queued"""
    pin_clock(_NOW, range_import, account_link)
    headers, account_id, link = await _linked_travel(client)
    before = await _stored_link(link)
    _refuse_other_currencies()

    response = await client.post(f"/accounts/{account_id}/bank-link/{path}", json=body, headers=headers)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert await _stored_link(link) == before
    assert await _queued_jobs() == []


async def test_unlink_read_only_account_goes_through(client):
    """The link ends"""
    headers, account_id, link = await _linked_travel(client)
    _refuse_other_currencies()

    response = await client.delete(f"/accounts/{account_id}/bank-link", headers=headers)

    assert response.status_code == 200, response.text
    assert (await _stored_link(link))[0] == "unlinked"
