"""Reading the bank's balance beside the ledger's on an account's bank link

The ledger is the account's balance at the end of the bank's balance date in the owner's profile
timezone, so transactions dated after it don't count. The comparison shows once the link has synced
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.models.bank_connection import BankLinkState
from app.services.bank_sync import account_link
from tests.routes.support.bank_sync_helpers import (
    _commit_bank_balance,
    _commit_link,
    _commit_listed_connection,
    _new_account,
    _record_ledger,
    _sign_up,
)

# Noon on October 5 in Toronto, the zone _sign_up stores
_NOW = datetime(2026, 10, 5, 12, 0, tzinfo=ZoneInfo("America/Toronto"))

# 6:00 PM on October 3 in Toronto
_BALANCE_AT = datetime(2026, 10, 3, 18, 0, tzinfo=ZoneInfo("America/Toronto"))


@pytest.fixture(autouse=True)
def _pinned_now(pin_clock):
    """Pin the time the account link route describes the link at"""
    pin_clock(_NOW, account_link)


async def _synced_account(client, *ledger: tuple[str, int], tz: str | None = None, **bank) -> tuple[dict, str]:
    """Sign up, record the ledger on a new Everyday account, link it after its first sync, and give its bank account a balance

    Returns:
        The owner's auth headers and the account's id
    """
    headers, user_id = await _sign_up(client)
    if tz is not None:
        moved = await client.patch("/me", json={"tz": tz}, headers=headers)
        assert moved.status_code == 200, moved.text
    account_id = await _new_account(client, headers, "Everyday")
    await _record_ledger(client, headers, account_id, *ledger)
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    await _commit_bank_balance(connection, **{"balance_at": _BALANCE_AT, **bank})
    await _commit_link(account_id, connection, importing=False, last_success_at=_NOW - timedelta(hours=1))
    return headers, account_id


async def _read_balance(client, headers, account_id) -> dict | None:
    """Read the account's bank link through the route and return its balance comparison"""
    response = await client.get(f"/accounts/{account_id}/bank-link", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["balance"]


async def test_bank_balance_that_matches_the_ledger_has_no_difference(client):
    """Fake Bank reports 1,250.00 as of Oct 3, 6:00 PM with 1,180.00 available, and the ledger at the end of October 3 is 1,250.00"""
    headers, account_id = await _synced_account(client, ("2026-10-01", 130000), ("2026-10-03", -5000), balance=125000, available_balance=118000)

    balance = await _read_balance(client, headers, account_id)

    assert datetime.fromisoformat(balance.pop("balance_date")) == _BALANCE_AT
    assert balance == {"amount": 125000, "available": 118000, "available_unreadable": False, "ledger_balance": 125000, "difference": 0}


@pytest.mark.parametrize(
    ("bank_balance", "difference"),
    [
        pytest.param(120000, 5000, id="ledger-above-bank"),
        pytest.param(130000, -5000, id="ledger-below-bank"),
    ],
)
async def test_bank_balance_difference_is_the_ledger_against_the_bank(client, bank_balance, difference):
    """A ledger of 1,250.00 is 50.00 above Fake Bank's 1,200.00 and 50.00 below its 1,300.00

    Fake Bank gives no available balance here, so none is shown
    """
    headers, account_id = await _synced_account(client, ("2026-10-03", 125000), balance=bank_balance)

    balance = await _read_balance(client, headers, account_id)

    assert (balance["ledger_balance"], balance["difference"], balance["available"]) == (125000, difference, None)


async def test_bank_balance_of_an_account_with_no_transactions_is_compared_with_a_ledger_of_zero(client):
    """Nothing is recorded on Everyday yet, so its ledger is 0.00 and falls 1,250.00 short of Fake Bank's 1,250.00"""
    headers, account_id = await _synced_account(client, balance=125000)

    balance = await _read_balance(client, headers, account_id)

    assert (balance["ledger_balance"], balance["difference"]) == (0, -125000)


async def test_bank_balance_ledger_leaves_out_transactions_after_the_balance_date(client):
    """In Phoenix, 02:00 UTC on October 4 is 7:00 PM on October 3, so the ledger ends with October 3

    The October 4 transaction falls on the balance date's UTC day and the October 10 one is future-dated,
    and neither counts
    """
    headers, account_id = await _synced_account(
        client,
        ("2026-10-03", 125000),
        ("2026-10-04", -3000),
        ("2026-10-10", -8000),
        tz="America/Phoenix",
        balance=125000,
        balance_at=datetime(2026, 10, 4, 2, 0, tzinfo=ZoneInfo("UTC")),
    )

    balance = await _read_balance(client, headers, account_id)

    assert (balance["ledger_balance"], balance["difference"]) == (125000, 0)


async def test_bank_balance_that_cant_be_read_exactly_isnt_compared(client):
    """A balance Fake Bank sent with more decimals than CAD holds is stored as none, so there's no difference to give"""
    headers, account_id = await _synced_account(client, ("2026-10-03", 125000), balance=None, available_balance=118000)

    balance = await _read_balance(client, headers, account_id)

    assert datetime.fromisoformat(balance.pop("balance_date")) == _BALANCE_AT
    assert balance == {"amount": None, "available": 118000, "available_unreadable": False, "ledger_balance": 125000, "difference": None}


async def test_available_balance_that_cant_be_read_exactly_is_flagged_rather_than_left_out(client):
    """An available balance Fake Bank sent with more decimals than CAD holds reads as unreadable, not as never sent

    The balance itself is still compared with the ledger
    """
    headers, account_id = await _synced_account(client, ("2026-10-03", 125000), balance=125000, available_balance_unreadable=True)

    balance = await _read_balance(client, headers, account_id)

    assert datetime.fromisoformat(balance.pop("balance_date")) == _BALANCE_AT
    assert balance == {"amount": 125000, "available": None, "available_unreadable": True, "ledger_balance": 125000, "difference": 0}


@pytest.mark.parametrize(
    ("link_values", "bank_values"),
    [
        pytest.param({"last_success_at": None}, {}, id="never-synced"),
        pytest.param({"state": BankLinkState.CHOOSE_ACCOUNT}, {}, id="choose-account"),
        pytest.param({}, {"balance_at": None}, id="no-balance-date"),
    ],
)
async def test_bank_balance_isnt_shown_without_a_synced_bank_account_balance(client, link_values, bank_values):
    """A link shows no comparison before its first sync, while its bank account must be chosen again, or without a balance date"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    await _commit_bank_balance(connection, **{"balance_at": _BALANCE_AT, "balance": 125000, **bank_values})
    await _commit_link(account_id, connection, **{"importing": False, "last_success_at": _NOW - timedelta(hours=1), **link_values})

    assert await _read_balance(client, headers, account_id) is None
