"""Route tests for insights merchant ranking endpoint."""

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
    currency: str = "CAD",
) -> Transaction:
    """Build a transaction row for direct test setup."""
    return Transaction(
        created_by_user_id=user_id,
        account_id=account_id,
        dt=dt,
        merchant_id=merchant_id,
        category_id=category_id,
        amount=amount,
        currency=currency,
    )


async def test_merchant_ranking_returns_ranked_rows_with_counts_and_changes(client):
    """The card receives only current-period expense merchants with transaction counts."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)

    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    archived_account_id = UUID((await _create_account(client, headers, name="Archived Cash", is_archived=True)).json()["id"])
    expense_id, expense = _category(user_id, "Shopping", CategoryKind.EXPENSE)
    income_id, income = _category(user_id, "Salary", CategoryKind.INCOME)
    transfer_id, transfer = _category(user_id, "Transfer", CategoryKind.TRANSFER)
    merchant_rows = [
        _merchant(user_id, name)
        for name in [
            "Alpha Market",
            "Beta Grocer",
            "Cafe Delta",
            "Diner Echo",
            "Fitness Foxtrot",
            "Gas Gamma",
            "Hotel Indigo",
            "Refund Only",
            "Income Merchant",
            "Transfer Merchant",
            "Archived Merchant",
        ]
    ]
    merchant_ids = {merchant.name: merchant_id for merchant_id, merchant in merchant_rows}

    async with TestSession() as session:
        session.add_all([
            expense,
            income,
            transfer,
            *(merchant for _merchant_id, merchant in merchant_rows),
            _transaction(user_id, account_id, expense_id, date(2026, 4, 10), -120_000, merchant_ids["Alpha Market"]),
            _transaction(user_id, account_id, expense_id, date(2026, 4, 11), 20_000, merchant_ids["Alpha Market"]),
            _transaction(user_id, account_id, expense_id, date(2026, 4, 10), -90_000, merchant_ids["Beta Grocer"]),
            _transaction(user_id, account_id, expense_id, date(2026, 4, 10), -80_000, merchant_ids["Cafe Delta"]),
            _transaction(user_id, account_id, expense_id, date(2026, 4, 10), -70_000, merchant_ids["Diner Echo"]),
            _transaction(user_id, account_id, expense_id, date(2026, 4, 10), -60_000, merchant_ids["Fitness Foxtrot"]),
            _transaction(user_id, account_id, expense_id, date(2026, 4, 10), -50_000, merchant_ids["Gas Gamma"]),
            _transaction(user_id, account_id, expense_id, date(2026, 4, 10), -40_000, merchant_ids["Hotel Indigo"]),
            _transaction(user_id, account_id, expense_id, date(2026, 4, 10), 30_000, merchant_ids["Refund Only"]),
            _transaction(user_id, account_id, income_id, date(2026, 4, 10), -999_999, merchant_ids["Income Merchant"]),
            _transaction(user_id, account_id, transfer_id, date(2026, 4, 10), -999_999, merchant_ids["Transfer Merchant"]),
            _transaction(user_id, account_id, expense_id, date(2026, 4, 10), -999_999, None),
            _transaction(user_id, archived_account_id, expense_id, date(2026, 4, 10), -999_999, merchant_ids["Archived Merchant"]),
            _transaction(user_id, account_id, expense_id, date(2026, 3, 20), -50_000, merchant_ids["Alpha Market"]),
            _transaction(user_id, account_id, expense_id, date(2026, 3, 20), -100_000, merchant_ids["Beta Grocer"]),
            _transaction(user_id, account_id, expense_id, date(2026, 3, 20), -90_000, merchant_ids["Diner Echo"]),
            _transaction(user_id, account_id, expense_id, date(2026, 3, 1), -999_999, merchant_ids["Alpha Market"]),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/merchant-ranking",
        params={"from_date": "2026-04-01", "to_date": "2026-04-30"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "merchants": [
            [str(merchant_ids["Alpha Market"]), "Alpha Market", 100_000, 2, 100],
            [str(merchant_ids["Beta Grocer"]), "Beta Grocer", 90_000, 1, -10],
            [str(merchant_ids["Cafe Delta"]), "Cafe Delta", 80_000, 1, None],
            [str(merchant_ids["Diner Echo"]), "Diner Echo", 70_000, 1, -22],
            [str(merchant_ids["Fitness Foxtrot"]), "Fitness Foxtrot", 60_000, 1, None],
            [str(merchant_ids["Gas Gamma"]), "Gas Gamma", 50_000, 1, None],
            [str(merchant_ids["Hotel Indigo"]), "Hotel Indigo", 40_000, 1, None],
        ],
    }


async def test_merchant_ranking_does_not_emit_more_than_ten_rows(client):
    """Exactly ten rows are returned even when more merchants have spend."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    expense_id, expense = _category(user_id, "Shopping", CategoryKind.EXPENSE)
    merchant_rows = [_merchant(user_id, f"Merchant {index}") for index in range(1, 12)]

    async with TestSession() as session:
        session.add_all([
            expense,
            *(merchant for _merchant_id, merchant in merchant_rows),
            *(
                _transaction(user_id, account_id, expense_id, date(2026, 5, index), -(10_000 * index), merchant_id)
                for index, (merchant_id, _merchant_row) in enumerate(merchant_rows, start=1)
            ),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/merchant-ranking",
        params={"from_date": "2026-05-01", "to_date": "2026-05-31"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["merchants"] == [
        [str(merchant_id), f"Merchant {index}", 10_000 * index, 1, None]
        for index, (merchant_id, _merchant_row) in list(reversed(list(enumerate(merchant_rows, start=1))))[:10]
    ]


async def test_merchant_ranking_uses_stable_tie_breakers(client):
    """Equal merchant totals are ordered by merchant name."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    expense_id, expense = _category(user_id, "Shopping", CategoryKind.EXPENSE)
    beta_id, beta = _merchant(user_id, "Beta Store")
    alpha_id, alpha = _merchant(user_id, "Alpha Store")

    async with TestSession() as session:
        session.add_all([
            expense,
            beta,
            alpha,
            _transaction(user_id, account_id, expense_id, date(2026, 6, 3), -50_000, beta_id),
            _transaction(user_id, account_id, expense_id, date(2026, 6, 4), -50_000, alpha_id),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/merchant-ranking",
        params={"from_date": "2026-06-01", "to_date": "2026-06-30"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["merchants"] == [
        [str(alpha_id), "Alpha Store", 50_000, 1, None],
        [str(beta_id), "Beta Store", 50_000, 1, None],
    ]


async def test_merchant_ranking_one_day_range_compares_previous_one_day(client):
    """A one-day range compares against only the immediately preceding day."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    expense_id, expense = _category(user_id, "Dining", CategoryKind.EXPENSE)
    merchant_id, merchant = _merchant(user_id, "Cafe Delta")

    async with TestSession() as session:
        session.add_all([
            expense,
            merchant,
            _transaction(user_id, account_id, expense_id, date(2026, 7, 15), -50_000, merchant_id),
            _transaction(user_id, account_id, expense_id, date(2026, 7, 14), -20_000, merchant_id),
            _transaction(user_id, account_id, expense_id, date(2026, 7, 13), -900_000, merchant_id),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/merchant-ranking",
        params={"from_date": "2026-07-15", "to_date": "2026-07-15"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["merchants"] == [
        [str(merchant_id), "Cafe Delta", 50_000, 1, 150],
    ]


async def test_merchant_ranking_omits_zero_net_current_merchants(client):
    """Merchants with no net current spend are omitted even if they had prior spend."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    expense_id, expense = _category(user_id, "Shopping", CategoryKind.EXPENSE)
    merchant_id, merchant = _merchant(user_id, "Refunded Store")

    async with TestSession() as session:
        session.add_all([
            expense,
            merchant,
            _transaction(user_id, account_id, expense_id, date(2026, 8, 10), -40_000, merchant_id),
            _transaction(user_id, account_id, expense_id, date(2026, 8, 11), 40_000, merchant_id),
            _transaction(user_id, account_id, expense_id, date(2026, 7, 20), -80_000, merchant_id),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/merchant-ranking",
        params={"from_date": "2026-08-01", "to_date": "2026-08-31"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {"merchants": []}


async def test_merchant_ranking_returns_empty_payload_without_accounts(client):
    """Users without base-currency accounts get an empty card payload."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(
        "/insights/merchant-ranking",
        params={"from_date": "2026-04-01", "to_date": "2026-04-30"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {"merchants": []}


async def test_merchant_ranking_rejects_invalid_date_range(client):
    """The endpoint rejects a start date after the end date."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(
        "/insights/merchant-ranking",
        params={"from_date": "2026-04-30", "to_date": "2026-04-01"},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_merchant_ranking_requires_date_params(client):
    """Both date bounds are required for a cacheable card-specific query."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/insights/merchant-ranking", headers=headers)

    assert resp.status_code == 422


async def test_merchant_ranking_requires_auth(client):
    """Insights endpoints require an authenticated user."""
    resp = await client.get(
        "/insights/merchant-ranking",
        params={"from_date": "2026-04-01", "to_date": "2026-04-30"},
    )

    assert resp.status_code == 401
