

from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import (
    _create_account,
    _create_category,
    _create_merchant,
    _create_tag,
    _create_transaction,
    _seed_usd_currency,
    _setup_user_with_deps,
)

# --- Filtering ---


async def test_list_transactions_filter_by_account(client):
    """Filtering by account_id returns only that account's transactions."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_account = await _create_account(client, headers, name="Savings")

    await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, other_account.json()["id"], category_id, amount=-2000)

    resp = await client.get(f"/transactions?account_id={account_id}", headers=headers)

    assert len(resp.json()) == 1
    assert resp.json()[0]["amount"] == -1000


async def test_list_transactions_filter_by_category(client):
    """Filtering by category_id returns only that category's transactions."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_cat = await _create_category(client, headers, name="Test Income", kind="income")

    await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, account_id, other_cat.json()["id"], amount=5000)

    resp = await client.get(f"/transactions?category_id={other_cat.json()['id']}", headers=headers)

    assert len(resp.json()) == 1
    assert resp.json()[0]["amount"] == 5000


async def test_list_transactions_filter_by_merchant(client):
    """Filtering by merchant_id returns only that merchant's transactions."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    merchant = await _create_merchant(client, headers)

    await _create_transaction(client, headers, account_id, category_id, merchant_id=merchant.json()["id"], amount=-1000)
    await _create_transaction(client, headers, account_id, category_id, amount=-2000)

    resp = await client.get(f"/transactions?merchant_id={merchant.json()['id']}", headers=headers)

    assert len(resp.json()) == 1
    assert resp.json()[0]["amount"] == -1000
    assert resp.json()[0]["merchant_name"] == "Costco"


async def test_list_transactions_filter_by_currency(client):
    """Filtering by currency returns only transactions in that currency."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _seed_usd_currency()

    usd_account = await _create_account(client, headers, name="USD Account", currency="USD")
    await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, usd_account.json()["id"], category_id, amount=-2000, currency="USD")

    resp = await client.get("/transactions?currency=USD", headers=headers)

    assert len(resp.json()) == 1
    assert resp.json()[0]["amount"] == -2000


async def test_list_transactions_filter_by_date_range(client):
    """Filtering by from_date and to_date returns transactions within the range."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    await _create_transaction(client, headers, account_id, category_id, dt="2026-01-15")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-02-15")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-03-15")

    resp = await client.get(
        "/transactions?from_date=2026-02-01&to_date=2026-02-28",
        headers=headers,
    )

    assert len(resp.json()) == 1


async def test_list_transactions_filter_by_date_range_is_inclusive(client):
    """Transactions exactly on from_date and to_date are included."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    await _create_transaction(client, headers, account_id, category_id, dt="2026-02-01")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-02-15")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-02-28")

    resp = await client.get(
        "/transactions?from_date=2026-02-01&to_date=2026-02-28",
        headers=headers,
    )

    assert len(resp.json()) == 3


async def test_list_transactions_filter_by_from_date_only(client):
    """Filtering with only from_date returns transactions on or after that date."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    await _create_transaction(client, headers, account_id, category_id, dt="2026-01-15")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-03-15")

    resp = await client.get("/transactions?from_date=2026-02-01", headers=headers)

    assert len(resp.json()) == 1


async def test_list_transactions_filter_by_to_date_only(client):
    """Filtering with only to_date returns transactions on or before that date."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    await _create_transaction(client, headers, account_id, category_id, dt="2026-01-15")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-03-15")

    resp = await client.get("/transactions?to_date=2026-02-01", headers=headers)

    assert len(resp.json()) == 1


async def test_list_transactions_multiple_filters_combined(client):
    """Multiple filters applied together narrow results correctly."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_cat = await _create_category(client, headers, name="Test Income", kind="income")

    await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, account_id, other_cat.json()["id"], amount=5000)
    await _create_transaction(client, headers, account_id, category_id, amount=-3000)

    resp = await client.get(
        f"/transactions?account_id={account_id}&category_id={category_id}",
        headers=headers,
    )

    assert len(resp.json()) == 2
    amounts = {t["amount"] for t in resp.json()}
    assert amounts == {-1000, -3000}


async def test_list_transactions_from_date_after_to_date_returns_422(client):
    """from_date after to_date returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(
        "/transactions?from_date=2026-04-01&to_date=2026-03-01",
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Start date must be before end date"


# --- Multi-value filtering ---


async def test_list_transactions_filter_by_multiple_accounts(client):
    """Repeating account_id keeps transactions from any of the selected accounts."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    second_account = await _create_account(client, headers, name="Savings")
    third_account = await _create_account(client, headers, name="Cash")
    second_id = second_account.json()["id"]

    await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, second_id, category_id, amount=-2000)
    await _create_transaction(client, headers, third_account.json()["id"], category_id, amount=-3000)

    resp = await client.get(f"/transactions?account_id={account_id}&account_id={second_id}", headers=headers)

    assert len(resp.json()) == 2
    assert {transaction["amount"] for transaction in resp.json()} == {-1000, -2000}


async def test_list_transactions_filter_by_multiple_categories(client):
    """Repeating category_id keeps transactions from any of the selected categories."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    income = await _create_category(client, headers, name="Test Salary", kind="income")
    rent = await _create_category(client, headers, name="Test Rent", kind="expense")
    income_id = income.json()["id"]

    await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, account_id, income_id, amount=5000)
    await _create_transaction(client, headers, account_id, rent.json()["id"], amount=-3000)

    resp = await client.get(f"/transactions?category_id={category_id}&category_id={income_id}", headers=headers)

    assert len(resp.json()) == 2
    assert {transaction["amount"] for transaction in resp.json()} == {-1000, 5000}


async def test_list_transactions_filter_by_multiple_currencies(client):
    """Repeating currency keeps transactions in any of the selected currencies."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _seed_usd_currency()
    usd_account = await _create_account(client, headers, name="USD Account", currency="USD")

    await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, usd_account.json()["id"], category_id, amount=-2000, currency="USD")

    resp = await client.get("/transactions?currency=CAD&currency=USD", headers=headers)

    assert len(resp.json()) == 2
    assert {transaction["currency"] for transaction in resp.json()} == {"CAD", "USD"}


# --- Tag filtering ---


async def test_list_transactions_filter_by_tags_requires_all_by_default(client):
    """By default a transaction must carry every selected tag to match."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    work = (await _create_tag(client, headers, name="work")).json()["id"]
    travel = (await _create_tag(client, headers, name="travel")).json()["id"]

    await _create_transaction(client, headers, account_id, category_id, amount=-1000, tag_ids=[work, travel])
    await _create_transaction(client, headers, account_id, category_id, amount=-2000, tag_ids=[work])

    resp = await client.get(f"/transactions?tag_id={work}&tag_id={travel}", headers=headers)

    assert len(resp.json()) == 1
    assert resp.json()[0]["amount"] == -1000


async def test_list_transactions_filter_by_tags_any_matches_either(client):
    """tag_match=any keeps transactions carrying at least one selected tag."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    work = (await _create_tag(client, headers, name="work")).json()["id"]
    travel = (await _create_tag(client, headers, name="travel")).json()["id"]

    await _create_transaction(client, headers, account_id, category_id, amount=-1000, tag_ids=[work])
    await _create_transaction(client, headers, account_id, category_id, amount=-2000, tag_ids=[travel])
    await _create_transaction(client, headers, account_id, category_id, amount=-3000)

    resp = await client.get(f"/transactions?tag_id={work}&tag_id={travel}&tag_match=any", headers=headers)

    assert len(resp.json()) == 2
    assert {transaction["amount"] for transaction in resp.json()} == {-1000, -2000}


async def test_list_transactions_invalid_tag_match_returns_422(client):
    """A tag filter with an unsupported match mode returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    work = (await _create_tag(client, headers, name="work")).json()["id"]

    resp = await client.get(f"/transactions?tag_id={work}&tag_match=some", headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Tag match must be 'all' or 'any'"


# --- Amount filtering ---


async def test_list_transactions_filter_by_amount_range(client):
    """Amount bounds keep transactions whose magnitude falls within the range."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, account_id, category_id, amount=-5000)
    await _create_transaction(client, headers, account_id, category_id, amount=-9000)

    resp = await client.get("/transactions?min_amount=2000&max_amount=6000&amount_currency=CAD", headers=headers)

    assert len(resp.json()) == 1
    assert resp.json()[0]["amount"] == -5000


async def test_list_transactions_amount_range_matches_inflow_and_outflow(client):
    """The amount range matches magnitude, so inflows and outflows are treated the same."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    income = await _create_category(client, headers, name="Test Salary", kind="income")

    await _create_transaction(client, headers, account_id, category_id, amount=-5000)
    await _create_transaction(client, headers, account_id, income.json()["id"], amount=5000)

    resp = await client.get("/transactions?min_amount=4000&max_amount=6000&amount_currency=CAD", headers=headers)

    assert len(resp.json()) == 2
    assert {transaction["amount"] for transaction in resp.json()} == {-5000, 5000}


async def test_list_transactions_amount_range_scoped_to_currency(client):
    """The amount range only matches transactions in the requested currency."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _seed_usd_currency()
    usd_account = await _create_account(client, headers, name="USD Account", currency="USD")

    await _create_transaction(client, headers, account_id, category_id, amount=-5000)
    await _create_transaction(client, headers, usd_account.json()["id"], category_id, amount=-5000, currency="USD")

    resp = await client.get("/transactions?min_amount=1000&max_amount=9000&amount_currency=USD", headers=headers)

    assert len(resp.json()) == 1
    assert resp.json()[0]["currency"] == "USD"


async def test_list_transactions_amount_range_without_currency_returns_422(client):
    """An amount bound without amount_currency returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/transactions?min_amount=1000", headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Amount currency is required when filtering by amount"


async def test_list_transactions_amount_min_above_max_returns_422(client):
    """A minimum amount above the maximum returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/transactions?min_amount=9000&max_amount=1000&amount_currency=CAD", headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Minimum amount must not exceed maximum amount"
