import uuid
from datetime import date
from decimal import Decimal

from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.support import _create_user, _get_auth_header, _get_system_merchant_id
from tests.routes.transactions._helpers import (
    NONEXISTENT_ID,
    _create_account,
    _create_category,
    _create_merchant,
    _create_tag,
    _create_transaction,
    _get_system_category_id,
    _seed_usd_currency,
    _setup_user_with_deps,
)

# --- POST /transactions ---


async def test_create_transaction_returns_201(client):
    """Valid payload creates a transaction with correct fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    account_resp = await _create_account(client, headers)
    category_resp = await _create_category(client, headers)
    account_id = account_resp.json()["id"]
    category_id = category_resp.json()["id"]

    resp = await _create_transaction(client, headers, account_id, category_id)

    assert resp.status_code == 201
    data = resp.json()
    assert data["created_by_user_id"] == user_id
    assert data["account_id"] == account_id
    assert data["category_id"] == category_id
    assert data["amount"] == -5000
    assert data["currency"] == "CAD"
    assert data["merchant_id"] == await _get_system_merchant_id(client, headers)
    assert data["fx_rate"] is None
    assert data["notes"] is None
    assert data["tag_ids"] == []
    assert data["tags"] == []
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_create_transaction_accepts_debit_and_credit_for_all_category_kinds(client):
    """Category kind classifies a transaction; amount sign stores debit/credit direction."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]

    categories = {}
    for kind in ("expense", "income", "transfer"):
        category_resp = await _create_category(client, headers, name=f"Direction {kind}", kind=kind)
        categories[kind] = category_resp.json()["id"]

    for kind, category_id in categories.items():
        # A transfer records its counterparty account, and the other kinds reject the field
        counterparty_kwargs = {"counterparty_account_scope": "outside"} if kind == "transfer" else {}
        for amount in (-1234, 5678):
            resp = await _create_transaction(
                client, headers, account_id, category_id, amount=amount, **counterparty_kwargs,
            )

            assert resp.status_code == 201
            data = resp.json()
            assert data["category_id"] == category_id
            assert data["amount"] == amount


async def test_create_transaction_with_all_optional_fields(client):
    """Transaction created with merchant, notes, and tags returns correct values."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    merchant_resp = await _create_merchant(client, headers)
    tag1_resp = await _create_tag(client, headers, name="business")
    tag2_resp = await _create_tag(client, headers, name="travel")

    resp = await _create_transaction(
        client, headers, account_id, category_id,
        merchant_id=merchant_resp.json()["id"],
        notes="Business lunch",
        tag_ids=[tag1_resp.json()["id"], tag2_resp.json()["id"]],
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["merchant_id"] == merchant_resp.json()["id"]
    assert data["merchant_name"] == "Costco"
    assert data["notes"] == "Business lunch"
    assert set(data["tag_ids"]) == {tag1_resp.json()["id"], tag2_resp.json()["id"]}
    assert {tag["name"] for tag in data["tags"]} == {"business", "travel"}


async def test_create_transaction_invalid_account_returns_404(client):
    """Non-existent account_id returns 404."""
    headers, _, category_id = await _setup_user_with_deps(client)

    resp = await _create_transaction(client, headers, NONEXISTENT_ID, category_id)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Account not found"


async def test_create_transaction_invalid_currency_returns_422(client):
    """Non-existent currency returns 422."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _create_transaction(client, headers, account_id, category_id, currency="XXX")

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid currency code"


async def test_create_transaction_invalid_category_returns_422(client):
    """Non-existent category_id returns 422."""
    headers, account_id, _ = await _setup_user_with_deps(client)

    resp = await _create_transaction(client, headers, account_id, NONEXISTENT_ID)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Category not found"


async def test_create_transaction_with_system_category_returns_201(client):
    """Transactions on personal accounts can use system categories."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    category_id = await _get_system_category_id(client, headers)

    resp = await _create_transaction(client, headers, account_id, category_id)

    assert resp.status_code == 201
    assert resp.json()["category_id"] == category_id


async def test_create_transaction_invalid_merchant_returns_422(client):
    """Non-existent merchant_id returns 422."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _create_transaction(client, headers, account_id, category_id, merchant_id=NONEXISTENT_ID)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Merchant not found"


async def test_create_transaction_without_a_merchant_returns_422(client):
    """Every transaction created through the route has to carry a merchant."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await client.post("/transactions", json={
        "account_id": account_id,
        "category_id": category_id,
        "dt": "2026-03-15",
        "amount": -5000,
        "currency": "CAD",
    }, headers=headers)

    assert resp.status_code == 422


async def test_create_transaction_invalid_tag_returns_422(client):
    """Non-existent tag ID returns 422."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _create_transaction(client, headers, account_id, category_id, tag_ids=[NONEXISTENT_ID])

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Tag not found"


async def test_create_transaction_fx_rate_required_for_different_currency(client):
    """fx_rate is required when transaction currency differs from account currency."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _seed_usd_currency()

    resp = await _create_transaction(client, headers, account_id, category_id, currency="USD")

    assert resp.status_code == 422
    assert resp.json()["detail"] == "fx_rate is required when transaction currency differs from account currency"


async def test_create_transaction_fx_rate_accepted_for_different_currency(client):
    """Providing fx_rate with a different currency succeeds."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _seed_usd_currency()

    resp = await _create_transaction(client, headers, account_id, category_id, currency="USD", fx_rate=1.35)

    assert resp.status_code == 201
    assert resp.json()["fx_rate"] == 1.35


async def test_list_transactions_returns_account_amount_for_foreign_currency(client, monkeypatch):
    """Transaction responses include the amount converted into the account currency."""
    from app.models.account import Account
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {date(2026, 3, 15): Decimal("1.35")}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _seed_usd_currency()

    async with TestSession() as session:
        account = await session.get(Account, uuid.UUID(account_id))
        session.add(Transaction(
            created_by_user_id=account.owner_id,
            account_id=uuid.UUID(account_id),
            category_id=uuid.UUID(category_id),
            dt=date(2026, 3, 15),
            amount=-10_00,
            currency="USD",
            fx_rate=None,
        ))
        await session.commit()

    list_resp = await client.get("/transactions", headers=headers)

    assert list_resp.status_code == 200
    transaction = list_resp.json()[0]
    assert transaction["amount"] == -10_00
    assert transaction["currency"] == "USD"
    assert transaction["account_amount"] == -13_50
    assert transaction["base_currency_amount"] == -13_50


async def test_list_transactions_returns_per_day_base_currency_amount_for_foreign_account(client, monkeypatch):
    """Transaction list responses convert account amounts into user base currency by transaction date."""
    from app.services.fx import FrankfurterProvider

    calls = []

    async def fake_get_rates(self, base, quote, start_date, end_date):
        calls.append((base, quote, start_date, end_date))
        return {
            date(2026, 3, 14): Decimal("1.4"),
            date(2026, 3, 15): Decimal("1.5"),
        }

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)
    headers, _, category_id = await _setup_user_with_deps(client)
    await _seed_usd_currency()
    usd_account_id = (await _create_account(
        client,
        headers,
        name="USD Chequing",
        currency="USD",
    )).json()["id"]

    await _create_transaction(
        client,
        headers,
        usd_account_id,
        category_id,
        amount=-10_00,
        currency="USD",
        dt="2026-03-15",
    )

    list_resp = await client.get("/transactions", headers=headers)

    assert list_resp.status_code == 200
    transaction = list_resp.json()[0]
    assert transaction["amount"] == -10_00
    assert transaction["account_amount"] == -10_00
    assert transaction["base_currency_amount"] == -15_00
    assert calls == [("USD", "CAD", date(2026, 3, 15), date(2026, 3, 15))]


async def test_create_transaction_duplicate_tags_deduplicated(client):
    """Duplicate tag IDs are deduplicated — no integrity error."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    tag_resp = await _create_tag(client, headers, name="dup-test")
    tag_id = tag_resp.json()["id"]

    resp = await _create_transaction(client, headers, account_id, category_id, tag_ids=[tag_id, tag_id])

    assert resp.status_code == 201
    assert resp.json()["tag_ids"] == [tag_id]


async def test_create_transaction_other_users_account_returns_404(client):
    """Cannot create a transaction referencing another user's account."""
    headers, _, category_id = await _setup_user_with_deps(client)
    _, other_account_id, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")

    resp = await _create_transaction(client, headers, other_account_id, category_id)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Account not found"


async def test_create_transaction_other_users_category_returns_422(client):
    """Cannot create a transaction referencing another user's category."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    _, _, other_category_id = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")

    resp = await _create_transaction(client, headers, account_id, other_category_id)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Category not found"


async def test_create_transaction_with_group_category_on_personal_account_returns_422(client):
    """A group category cannot be used on a personal-account transaction

    Personal-account transactions must stay personal or system-scoped so group
    spending cannot land on the user's personal ledger
    """
    headers, personal_account_id, _ = await _setup_user_with_deps(client)
    group_resp = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    group_id = group_resp.json()["id"]
    group_category_resp = await client.post(
        "/categories",
        json={"name": "Group Groceries", "kind": "expense", "group_id": group_id},
        headers=headers,
    )
    group_category_id = group_category_resp.json()["id"]

    resp = await _create_transaction(client, headers, personal_account_id, group_category_id)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Category not found"


async def test_create_transaction_other_users_merchant_returns_422(client):
    """Cannot create a transaction referencing another user's merchant."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_headers, _, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")
    other_merchant_id = (await _create_merchant(client, other_headers, name="Other Merchant")).json()["id"]

    resp = await _create_transaction(client, headers, account_id, category_id, merchant_id=other_merchant_id)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Merchant not found"


async def test_create_transaction_other_users_tag_returns_422(client):
    """Cannot create a transaction referencing another user's tag."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_headers, _, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")
    other_tag_id = (await _create_tag(client, other_headers, name="Other Tag")).json()["id"]

    resp = await _create_transaction(client, headers, account_id, category_id, tag_ids=[other_tag_id])

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Tag not found"


async def test_create_transaction_without_auth_returns_401(client):
    """POST /transactions without an Authorization header returns 401."""
    resp = await client.post("/transactions", json={})
    assert resp.status_code == 401
