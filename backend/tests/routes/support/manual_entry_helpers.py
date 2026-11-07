"""Writing transactions into a linked account around the days its bank supplies

Everyday is linked to Fake Bank from 1 June 2026, and it is 11pm on 3 October 2026 in the user's
zone, already 4 October in UTC, so the bank supplies 1 June through 3 October. The tests pin the
clock to NOW, so a check reading the day in UTC would refuse 4 October as well
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.models.account import Account
from app.models.bank_connection import BankLinkState
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _build_bank_link, _commit_listed_connection, _new_account, _sign_up
from tests.routes.support.transaction_helpers import _create_transaction

NOW = datetime(2026, 10, 3, 23, 0, tzinfo=ZoneInfo("America/Toronto"))
TODAY = NOW.date()
IMPORT_START = date(2026, 6, 1)

SUPPLIED = "Fake Bank supplies this account's transactions from Jun 1, 2026 to today"

# A write that can cover several accounts names the one refused
SUPPLIED_IN_EVERYDAY = "Fake Bank supplies the transactions in Everyday from Jun 1, 2026 to today"

# A move is refused naming the account it would leave, for one transaction or several
MOVE_REFUSED = "Transactions from Fake Bank can't move out of Everyday while it's linked"

# A delete of a bank-imported transaction is refused naming its account, for one transaction alone
DELETE_REFUSED = "Imported from Fake Bank. While Everyday is linked, edit it rather than deleting it"

# And for a selection deleted together, which may hold several
BULK_DELETE_REFUSED = "Transactions from Fake Bank can't be deleted from Everyday while it's linked"

# A day the bank supplies, where a manual transaction can only have been entered before the link
COFFEE_DAY = date(2026, 7, 12)

# Either end of the range the bank supplies, and a day inside it
INSIDE = [IMPORT_START, date(2026, 7, 12), TODAY]

# The day before the import start, the day after today, which is already today in UTC, and a later future day
OUTSIDE = [IMPORT_START - timedelta(days=1), TODAY + timedelta(days=1), date(2026, 10, 10)]


@dataclass(frozen=True)
class _Ledger:
    """A signed-up user's Everyday and Savings accounts and an expense category"""

    headers: dict
    user_id: uuid.UUID
    everyday_id: str
    savings_id: str
    category_id: str


async def _ledger(client) -> _Ledger:
    """Sign up with empty Everyday and Savings accounts in CAD and a Coffee category"""
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    savings_id = await _new_account(client, headers, "Savings")
    category = await client.post("/categories", json={"name": "Coffee", "kind": "expense"}, headers=headers)
    assert category.status_code == 201, category.text
    return _Ledger(headers, user_id, everyday_id, savings_id, category.json()["id"])


async def _commit_link(
    ledger: _Ledger,
    account_id: str,
    *,
    import_start: date = IMPORT_START,
    state: str = BankLinkState.ACTIVE,
    external_account_id: str = "ACT-1",
) -> None:
    """Commit the account's link to a bank account on a new Fake Bank connection, importing from the start given"""
    connection = await _commit_listed_connection(ledger.user_id, external_account_id)
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(account_id))
        link = _build_bank_link(account, connection, external_account_id, state=state)
        link.import_start = import_start
        link.checkpoint = import_start - timedelta(days=1)
        session.add(link)
        await session.commit()


async def _unlink(client, ledger: _Ledger, account_id: str) -> None:
    """Unlink the account through the route"""
    unlinked = await client.delete(f"/accounts/{account_id}/bank-link", headers=ledger.headers)
    assert unlinked.status_code == 200, unlinked.text


async def _add(client, ledger: _Ledger, account_id: str, day: date):
    """Create a manual 4.50 Coffee transaction on the day given"""
    return await _create_transaction(client, ledger.headers, account_id, ledger.category_id, dt=day.isoformat(), amount=-450)


async def _added_id(client, ledger: _Ledger, account_id: str, day: date) -> str:
    """Create a manual transaction that is expected to save, and return its id"""
    added = await _add(client, ledger, account_id, day)
    assert added.status_code == 201, added.text
    return added.json()["id"]


async def _dates_in(account_id: str) -> list[date]:
    """Return the dates of the account's transactions, earliest first"""
    async with TestSession() as session:
        return list(
            await session.scalars(select(Transaction.dt).where(Transaction.account_id == uuid.UUID(account_id)).order_by(Transaction.dt))
        )
