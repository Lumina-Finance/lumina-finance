"""What the insights period glance does when the installed check refuses converting between currencies

One case of the table the dashboard net worth tests hold in full: every figure leaves out the account in
another currency and says why, and the check is asked once for the whole request
"""

from datetime import date
from uuid import UUID, uuid4

from app.allowance_hook import AllowanceKind
from app.models.account import AccountBalanceSnapshot
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.support import _create_account, _create_user, _get_auth_header
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check, seed_usd_currency

_WITHHELD = {"state": "none", "missing_pairs": [], "withheld_reason": ALLOWANCE_REASON}


def _transaction(user_id: UUID, account_id: UUID, category_id: UUID, dt: date, amount: int, currency: str) -> Transaction:
    """Build a transaction row for direct test setup"""
    return Transaction(created_by_user_id=user_id, account_id=account_id, dt=dt, category_id=category_id, amount=amount, currency=currency)


async def test_period_glance_leaves_out_the_account_in_another_currency_the_check_refuses_converting(client, monkeypatch):
    """Income, expenses, top category and net worth movement count the Canadian account alone, each saying why, from one ask of the check"""
    from app.services.fx import FrankfurterProvider

    rate_requests = []

    async def fake_get_rates(self, base, quote, start_date, end_date):
        rate_requests.append((base, quote))
        return {}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    await seed_usd_currency()
    cash_id = UUID((await _create_account(client, headers, name="CAD Cash")).json()["id"])
    usd_id = UUID((await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"])
    salary_id, food_id = uuid4(), uuid4()
    async with TestSession() as session:
        session.add_all(
            [
                Category(id=salary_id, owner_id=user_id, name="Paycheque", kind=CategoryKind.INCOME),
                Category(id=food_id, owner_id=user_id, name="Food", kind=CategoryKind.EXPENSE),
                _transaction(user_id, cash_id, salary_id, date(2026, 5, 2), 100_000, "CAD"),
                _transaction(user_id, cash_id, food_id, date(2026, 5, 3), -20_000, "CAD"),
                _transaction(user_id, usd_id, salary_id, date(2026, 5, 2), 900_000, "USD"),
                _transaction(user_id, usd_id, food_id, date(2026, 5, 3), -700_000, "USD"),
                AccountBalanceSnapshot(account_id=cash_id, dt=date(2026, 4, 30), balance=100_000),
                AccountBalanceSnapshot(account_id=cash_id, dt=date(2026, 5, 7), balance=200_000),
                AccountBalanceSnapshot(account_id=usd_id, dt=date(2026, 4, 30), balance=5_000_000),
                AccountBalanceSnapshot(account_id=usd_id, dt=date(2026, 5, 7), balance=9_000_000),
            ]
        )
        await session.commit()
    asked = install_check(refused={AllowanceKind.FOREIGN_CURRENCIES})

    response = await client.get("/insights/period-glance", params={"from_date": "2026-05-01", "to_date": "2026-05-07"}, headers=headers)

    assert response.status_code == 200, response.text
    data = response.json()
    assert (data["income"], data["expenses"], data["net_worth_change"]) == (100_000, 20_000, 100_000)
    assert (data["top_category_name"], data["top_category_amount"]) == ("Food", 20_000)
    assert (data["biggest_change_name"], data["biggest_change_amount"]) == ("Food", 20_000)
    for field in ("income_expense_fx_status", "net_worth_change_fx_status", "top_category_fx_status", "biggest_change_fx_status"):
        assert data[field] == _WITHHELD, field
    assert rate_requests == []
    assert [request.kind for request in asked if request.kind == AllowanceKind.FOREIGN_CURRENCIES] == [AllowanceKind.FOREIGN_CURRENCIES]
