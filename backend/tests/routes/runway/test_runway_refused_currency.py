"""What runway does when the installed check refuses converting between currencies

One case of the table the dashboard net worth tests hold in full: the balance and the spending of the
account in another currency are both left out
"""

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import update

from app.allowance_hook import AllowanceKind
from app.models.account import AccountBalanceSnapshot
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.support import _create_account, _create_user, _get_auth_header
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check, seed_usd_currency


def _owner_local_creation_day(account):
    """Return the account creation date in the owner timezone"""
    return datetime.fromisoformat(account["created_at"]).astimezone(ZoneInfo("America/Toronto")).date()


async def test_runway_leaves_out_the_account_in_another_currency_the_check_refuses_converting(client, monkeypatch):
    """A 1,000.00 Canadian, a 200.00 US and a 100.00 US group account, each with spending, count the personal US one out"""
    from app.routes.users import date_helpers as user_routes
    from app.services.fx import FrankfurterProvider

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 4, 15, 16, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {date(2026, 3, 13): Decimal("1.25"), date(2026, 4, 15): Decimal("1.5")}

    monkeypatch.setattr(user_routes, "datetime", FixedDateTime)
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    await seed_usd_currency()
    cad_account = (await _create_account(client, headers, name="CAD Cash")).json()
    usd_account = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()
    group = await client.post("/groups", json={"name": "Household"}, headers=headers)
    joint_account = (await _create_account(client, headers, name="USD Joint", currency="USD", group_id=group.json()["id"])).json()
    async with TestSession() as session:
        category = Category(owner_id=user_id, name="Test Expense", kind=CategoryKind.EXPENSE)
        session.add(category)
        await session.flush()
        session.add_all(
            [
                Transaction(
                    created_by_user_id=user_id,
                    account_id=UUID(cad_account["id"]),
                    category_id=category.id,
                    dt=date(2026, 3, 13),
                    amount=-12_000,
                    currency="CAD",
                ),
                Transaction(
                    created_by_user_id=user_id,
                    account_id=UUID(usd_account["id"]),
                    category_id=category.id,
                    dt=date(2026, 3, 13),
                    amount=-10_000,
                    currency="USD",
                ),
                Transaction(
                    created_by_user_id=user_id,
                    account_id=UUID(joint_account["id"]),
                    category_id=category.id,
                    dt=date(2026, 3, 13),
                    amount=-5_000,
                    currency="USD",
                ),
                AccountBalanceSnapshot(account_id=UUID(joint_account["id"]), dt=date(2026, 4, 15), balance=10_000),
                AccountBalanceSnapshot(account_id=UUID(cad_account["id"]), dt=date(2026, 4, 15), balance=100_000),
                AccountBalanceSnapshot(account_id=UUID(usd_account["id"]), dt=date(2026, 4, 15), balance=20_000),
            ]
        )
        for account, balance in [(cad_account, 100_000), (usd_account, 20_000), (joint_account, 10_000)]:
            await session.execute(
                update(AccountBalanceSnapshot)
                .where(
                    AccountBalanceSnapshot.account_id == UUID(account["id"]),
                    AccountBalanceSnapshot.dt == _owner_local_creation_day(account),
                )
                .values(balance=balance),
            )
        await session.commit()
    await client.put("/me/runway-accounts", json={"account_ids": [cad_account["id"], usd_account["id"], joint_account["id"]]}, headers=headers)
    install_check(refused={AllowanceKind.FOREIGN_CURRENCIES})

    response = await client.get("/me/runway", headers=headers)

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["liquid_balance"] == 115_000
    assert {(row["account_id"], row["balance"]) for row in data["account_balances"]} == {
        (cad_account["id"], 100_000),
        (joint_account["id"], 15_000),
    }
    assert data["avg_monthly_expense"] == 18_250
    assert data["months"] == pytest.approx(115_000 / 18_250)
    assert data["fx_status"] == {"state": "complete", "missing_pairs": [], "withheld_reason": ALLOWANCE_REASON}
