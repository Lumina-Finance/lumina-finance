"""Route tests for the shared insights merchants endpoint."""

from datetime import date
from uuid import UUID, uuid4

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.conftest import _create_account, _create_user, _get_auth_header


def _category(user_id: UUID, name: str, kind: CategoryKind) -> tuple[UUID, Category]:
    """Build a personal category row for direct test setup."""
    category_id = uuid4()
    return category_id, Category(id=category_id, owner_id=user_id, name=name, kind=kind)


def _merchant(user_id: UUID, name: str) -> tuple[UUID, Merchant]:
    """Build a personal merchant row for direct test setup."""
    merchant_id = uuid4()
    return merchant_id, Merchant(id=merchant_id, owner_id=user_id, name=name)


def _transaction(
    user_id: UUID,
    account_id: UUID,
    category_id: UUID,
    dt: date,
    amount: int,
    merchant_id: UUID | None = None,
) -> Transaction:
    """Build a transaction row for direct test setup."""
    return Transaction(
        created_by_user_id=user_id,
        account_id=account_id,
        dt=dt,
        merchant_id=merchant_id,
        category_id=category_id,
        amount=amount,
        currency="CAD",
    )


async def test_merchants_returns_distribution_and_ranking_payloads(client):
    """The shared endpoint returns both merchant card payloads from one request."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    expense_id, expense = _category(user_id, "Shopping", CategoryKind.EXPENSE)
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)
    alpha_id, alpha = _merchant(user_id, "Alpha Market")
    beta_id, beta = _merchant(user_id, "Beta Grocer")
    income_merchant_id, income_merchant = _merchant(user_id, "Income Merchant")

    async with TestSession() as session:
        session.add_all([
            expense,
            salary,
            alpha,
            beta,
            income_merchant,
            _transaction(user_id, account_id, expense_id, date(2026, 4, 10), -100_000, alpha_id),
            _transaction(user_id, account_id, expense_id, date(2026, 4, 11), 20_000, alpha_id),
            _transaction(user_id, account_id, expense_id, date(2026, 4, 12), -50_000, beta_id),
            _transaction(user_id, account_id, salary_id, date(2026, 4, 12), -999_999, income_merchant_id),
            _transaction(user_id, account_id, expense_id, date(2026, 3, 20), -40_000, alpha_id),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/merchants",
        params={"from_date": "2026-04-01", "to_date": "2026-04-30"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "distribution": [
            [str(alpha_id), "Alpha Market", 80_000, 100, 40_000],
            [str(beta_id), "Beta Grocer", 50_000, None, 50_000],
        ],
        "ranking": [
            [str(alpha_id), "Alpha Market", 80_000, 2, 100],
            [str(beta_id), "Beta Grocer", 50_000, 1, None],
        ],
    }


async def test_merchants_rejects_invalid_date_range(client):
    """The shared endpoint rejects a start date after the end date."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(
        "/insights/merchants",
        params={"from_date": "2026-04-30", "to_date": "2026-04-01"},
        headers=headers,
    )

    assert resp.status_code == 422
