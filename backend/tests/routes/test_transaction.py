from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.conftest import _create_user, _get_auth_header

# --- Helpers ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"


async def _seed_usd_currency():
    """Seed a USD currency row directly in the database for fx_rate validation tests.

    Inserts via raw session (not the API) because currencies are seeded data,
    not user-created resources.
    """
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()


async def _create_category(client, headers, **overrides):
    """Create a category via POST /categories.

    Defaults: name="Test Groceries", kind="expense".

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The HTTP response from the API.
    """
    payload = {"name": "Test Expense", "kind": "expense", **overrides}
    return await client.post("/categories", json=payload, headers=headers)


async def _create_account(client, headers, **overrides):
    """Create an account via POST /accounts.

    Defaults: account_type="checking", name="Main Chequing", currency="CAD".

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The HTTP response from the API.
    """
    payload = {
        "account_kind": "asset",
        "account_type": "checking",
        "name": "Main Chequing",
        "currency": "CAD",
        **overrides,
    }
    return await client.post("/accounts", json=payload, headers=headers)


async def _create_merchant(client, headers, **overrides):
    """Create a merchant via POST /merchants.

    Defaults: name="Costco".

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The HTTP response from the API.
    """
    payload = {"name": "Costco", **overrides}
    return await client.post("/merchants", json=payload, headers=headers)


async def _create_tag(client, headers, **overrides):
    """Create a tag via POST /tags.

    Defaults: name="vacation".

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The HTTP response from the API.
    """
    payload = {"name": "vacation", **overrides}
    return await client.post("/tags", json=payload, headers=headers)


async def _create_transaction(client, headers, account_id, category_id, **overrides):
    """Create a transaction via POST /transactions.

    Defaults: dt="2026-03-15", amount=-5000, currency="CAD".

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        account_id: UUID of the account to attach the transaction to.
        category_id: UUID of the category to assign.
        **overrides: Fields to override in the default payload.

    Returns:
        The HTTP response from the API.
    """
    payload = {
        "account_id": account_id,
        "category_id": category_id,
        "dt": "2026-03-15",
        "amount": -5000,
        "currency": "CAD",
        **overrides,
    }
    return await client.post("/transactions", json=payload, headers=headers)


async def _get_system_category_id(client, headers, name="Groceries"):
    """Return the ID for a seeded system category."""
    resp = await client.get("/categories", headers=headers)
    return next(category["id"] for category in resp.json() if category["name"] == name)


async def _setup_user_with_deps(client, email="test@example.com", name_prefix="Main"):
    """Sign up a user and create the minimum dependencies for a transaction.

    Creates one account and one category — the required FKs for any transaction.
    Pass a different email/name_prefix to create an isolated second user.

    Args:
        client: The async test client.
        email: Email for signup. Must be unique per test to avoid conflicts.
        name_prefix: Prefix for the account and category names.

    Returns:
        Tuple of (auth_headers, account_id, category_id).
    """
    if email == "test@example.com":
        signup_resp = await _create_user(client)
    else:
        signup_resp = await client.post("/auth/signup", json={
            "email": email,
            "password": "securepassword123",
            "first_name": name_prefix,
            "tz": "America/Toronto",
            "base_currency": "CAD",
        })
    headers = _get_auth_header(signup_resp)
    account_resp = await _create_account(client, headers, name=f"{name_prefix} Chequing")
    category_resp = await _create_category(client, headers, name=f"{name_prefix} Groceries")
    return headers, account_resp.json()["id"], category_resp.json()["id"]


# --- POST /transactions/import ---


async def test_import_transactions_creates_records_and_recomputes_snapshots(client):
    """Import creates requested records, transactions, tags, and account snapshots."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post("/transactions/import", json={
        "accounts": [{
            "source": "TD Visa",
            "create": {"name": "TD Visa", "account_type": "credit_card", "currency": "CAD"},
        }],
        "categories": [{
            "source": "Restaurants",
            "create": {"name": "Restaurants", "kind": "expense"},
        }],
        "rows": [{
            "account_source": "TD Visa",
            "category_source": "Restaurants",
            "dt": "2026-04-10",
            "amount": "-12.34",
            "merchant_name": "Corner Cafe",
            "notes": "Lunch",
            "tag_names": ["Food", "Food", ""],
        }],
    }, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["transactions_created"] == 1
    assert data["accounts_created"] == 1
    assert data["categories_created"] == 1
    assert data["merchants_created"] == 1
    assert data["tags_created"] == 1
    assert data["affected_account_ids"] == data["created_account_ids"]

    account_id = data["created_account_ids"][0]
    transactions_resp = await client.get("/transactions", headers=headers)
    transaction = transactions_resp.json()[0]
    assert transaction["account_id"] == account_id
    assert transaction["amount"] == -1234
    assert transaction["currency"] == "CAD"
    assert transaction["merchant_name"] == "Corner Cafe"
    assert transaction["notes"] == "Lunch"
    assert [tag["name"] for tag in transaction["tags"]] == ["Food"]

    accounts_resp = await client.get("/accounts", headers=headers)
    account = next(item for item in accounts_resp.json() if item["id"] == account_id)
    assert account["account_kind"] == "revolving"
    assert account["account_type"] == "credit_card"
    assert account["current_balance"] == -1234

    snapshots_resp = await client.get(f"/accounts/{account_id}/snapshots", headers=headers)
    assert {"account_id": account_id, "dt": "2026-04-10", "balance": -1234} in snapshots_resp.json()


async def test_import_transactions_reuses_existing_records_and_parses_comma_amount(client):
    """Import reuses explicit mappings and existing merchant/tag names."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _create_merchant(client, headers, name="Costco")
    await _create_tag(client, headers, name="bulk")

    resp = await client.post("/transactions/import", json={
        "accounts": [{"source": "Main Chequing", "account_id": account_id}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [{
            "account_source": "Main Chequing",
            "category_source": "Groceries",
            "dt": "2026-04-11",
            "amount": "1,234.56",
            "merchant_name": "Costco",
            "tag_names": ["bulk"],
        }],
    }, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["transactions_created"] == 1
    assert data["accounts_reused"] == 1
    assert data["categories_reused"] == 1
    assert data["merchants_reused"] == 1
    assert data["tags_reused"] == 1
    assert data["created_account_ids"] == []
    assert data["created_category_ids"] == []
    assert data["created_merchant_ids"] == []
    assert data["created_tag_ids"] == []

    transactions_resp = await client.get("/transactions", headers=headers)
    transaction = transactions_resp.json()[0]
    assert transaction["account_id"] == account_id
    assert transaction["category_id"] == category_id
    assert transaction["amount"] == 123456
    assert transaction["merchant_name"] == "Costco"
    assert [tag["name"] for tag in transaction["tags"]] == ["bulk"]


async def test_import_transactions_rejects_unmapped_account_source(client):
    """Rows must reference a declared account source."""
    headers, _, category_id = await _setup_user_with_deps(client)

    resp = await client.post("/transactions/import", json={
        "accounts": [{
            "source": "Mapped Account",
            "create": {"name": "Imported Account", "account_type": "checking", "currency": "CAD"},
        }],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [{
            "account_source": "Missing Account",
            "category_source": "Groceries",
            "dt": "2026-04-11",
            "amount": "-10.00",
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account source is not mapped: Missing Account"


async def test_import_transactions_rejects_invalid_raw_amount(client):
    """Imported amounts must be raw numeric strings with optional thousands separators."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await client.post("/transactions/import", json={
        "accounts": [{"source": "Main Chequing", "account_id": account_id}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [{
            "account_source": "Main Chequing",
            "category_source": "Groceries",
            "dt": "2026-04-11",
            "amount": "$12.34",
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid amount: $12.34"


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
    assert data["merchant_id"] is None
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

    for category_id in categories.values():
        for amount in (-1234, 5678):
            resp = await _create_transaction(client, headers, account_id, category_id, amount=amount)

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
    """A group category cannot be used on a personal-account transaction.

    Personal-account transactions must stay personal or system-scoped so group
    spending cannot land on the user's personal ledger.
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


# --- GET /transactions ---


async def test_list_transactions_returns_empty_list(client):
    """User with no transactions gets an empty list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/transactions", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_transactions_returns_user_transactions(client):
    """User sees their own transactions and not another user's."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, account_id, category_id, amount=-2000)

    other_headers, other_acct, other_cat = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")
    await _create_transaction(client, other_headers, other_acct, other_cat)

    resp = await client.get("/transactions", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    amounts = {t["amount"] for t in data}
    assert amounts == {-1000, -2000}


async def test_list_transactions_excludes_hidden_accounts_unscoped(client):
    """Default transaction list excludes hidden-account rows."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    hidden_account_id = (await _create_account(client, headers, name="Hidden", is_hidden=True)).json()["id"]

    await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, hidden_account_id, category_id, amount=-9000)

    resp = await client.get("/transactions", headers=headers)

    assert resp.status_code == 200
    assert [txn["amount"] for txn in resp.json()] == [-1000]


async def test_list_transactions_explicit_hidden_account_is_allowed(client):
    """Directly filtering by a hidden account still exposes its transactions."""
    headers, _, category_id = await _setup_user_with_deps(client)
    hidden_account_id = (await _create_account(client, headers, name="Hidden", is_hidden=True)).json()["id"]

    await _create_transaction(client, headers, hidden_account_id, category_id, amount=-9000)

    resp = await client.get(f"/transactions?account_id={hidden_account_id}", headers=headers)

    assert resp.status_code == 200
    assert [txn["amount"] for txn in resp.json()] == [-9000]


async def test_list_transactions_without_auth_returns_401(client):
    """GET /transactions without an Authorization header returns 401."""
    resp = await client.get("/transactions")
    assert resp.status_code == 401


# --- GET /transactions/overview ---


async def test_transactions_overview_excludes_hidden_accounts_unscoped(client):
    """Default transaction overview excludes hidden-account activity."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    hidden_account_id = (await _create_account(client, headers, name="Hidden", is_hidden=True)).json()["id"]

    await _create_transaction(client, headers, account_id, category_id, amount=10_000)
    await _create_transaction(client, headers, account_id, category_id, amount=-4_000)
    await _create_transaction(client, headers, hidden_account_id, category_id, amount=90_000)
    await _create_transaction(client, headers, hidden_account_id, category_id, amount=-30_000)

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["total_inflow"] == 10_000
    assert data["total_outflow"] == -4_000


async def test_transactions_overview_explicit_hidden_account_is_allowed(client):
    """Explicit account_id keeps hidden account detail inspectable."""
    headers, _, category_id = await _setup_user_with_deps(client)
    hidden_account_id = (await _create_account(client, headers, name="Hidden", is_hidden=True)).json()["id"]

    await _create_transaction(client, headers, hidden_account_id, category_id, amount=90_000)
    await _create_transaction(client, headers, hidden_account_id, category_id, amount=-30_000)

    resp = await client.get(f"/transactions/overview?account_id={hidden_account_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["total_inflow"] == 90_000
    assert data["total_outflow"] == -30_000


async def test_transactions_overview_top_categories_only_include_expense_categories(client):
    """Top categories exclude negative income and transfer rows."""
    headers, account_id, expense_category_id = await _setup_user_with_deps(client)
    transfer_category_id = (await _create_category(client, headers, name="Main Transfer", kind="transfer")).json()["id"]
    income_category_id = (await _create_category(client, headers, name="Main Income", kind="income")).json()["id"]

    await _create_transaction(client, headers, account_id, transfer_category_id, amount=-20_000)
    await _create_transaction(client, headers, account_id, income_category_id, amount=-15_000)
    await _create_transaction(client, headers, account_id, expense_category_id, amount=-4_000)
    await _create_transaction(client, headers, account_id, expense_category_id, amount=-3_000)

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert [(row["category_id"], row["total"]) for row in data["top_categories"]] == [
        (expense_category_id, -7_000),
    ]


async def test_transactions_overview_outliers_only_include_expense_categories(client):
    """Most expensive transactions exclude negative income and transfer rows."""
    headers, account_id, expense_category_id = await _setup_user_with_deps(client)
    transfer_category_id = (await _create_category(client, headers, name="Main Transfer", kind="transfer")).json()["id"]
    income_category_id = (await _create_category(client, headers, name="Main Income", kind="income")).json()["id"]

    await _create_transaction(client, headers, account_id, transfer_category_id, amount=-20_000)
    await _create_transaction(client, headers, account_id, income_category_id, amount=-15_000)
    await _create_transaction(client, headers, account_id, expense_category_id, amount=-4_000)
    await _create_transaction(client, headers, account_id, expense_category_id, amount=-3_000)

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert [row["amount"] for row in data["outliers"]] == [-4_000, -3_000]


# --- Sorting ---


async def test_list_transactions_default_sort_dt_desc(client):
    """Transactions default to most recent first."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    await _create_transaction(client, headers, account_id, category_id, dt="2026-01-01")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-03-01")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-02-01")

    resp = await client.get("/transactions", headers=headers)

    dates = [t["dt"] for t in resp.json()]
    assert dates == sorted(dates, reverse=True)


async def test_list_transactions_sort_by_amount_asc(client):
    """Sorting by amount ascending returns smallest first."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    await _create_transaction(client, headers, account_id, category_id, amount=-5000)
    await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, account_id, category_id, amount=-3000)

    resp = await client.get("/transactions?sort_by=amount&sort_order=asc", headers=headers)

    amounts = [t["amount"] for t in resp.json()]
    assert amounts == [-5000, -3000, -1000]


async def test_list_transactions_sort_by_created_at(client):
    """Sorting by created_at returns transactions in insertion order."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp1 = await _create_transaction(client, headers, account_id, category_id, amount=-1000, dt="2026-03-01")
    resp2 = await _create_transaction(client, headers, account_id, category_id, amount=-2000, dt="2026-01-01")

    resp = await client.get("/transactions?sort_by=created_at&sort_order=asc", headers=headers)

    ids = [t["id"] for t in resp.json()]
    assert ids == [resp1.json()["id"], resp2.json()["id"]]


async def test_list_transactions_sort_by_updated_at(client):
    """Sorting by updated_at reflects edit order."""
    import asyncio

    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp1 = await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, account_id, category_id, amount=-2000)

    await asyncio.sleep(0.01)
    await client.patch(f"/transactions/{resp1.json()['id']}", json={"notes": "edited"}, headers=headers)

    resp = await client.get("/transactions?sort_by=updated_at&sort_order=desc", headers=headers)

    ids = [t["id"] for t in resp.json()]
    assert ids[0] == resp1.json()["id"]


async def test_list_transactions_invalid_sort_by_returns_422(client):
    """Invalid sort_by field returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/transactions?sort_by=invalid", headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid sort field"


async def test_list_transactions_invalid_sort_order_returns_422(client):
    """Invalid sort_order returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/transactions?sort_order=sideways", headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Sort order must be 'asc' or 'desc'"


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


# --- Pagination ---


async def test_list_transactions_pagination_limit(client):
    """Limit controls the number of returned transactions."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    for i in range(5):
        await _create_transaction(
            client, headers, account_id, category_id,
            amount=-(i + 1) * 1000, dt=f"2026-03-{i + 1:02d}",
        )

    # Default sort is dt desc, so we expect the 3 most recent (Mar 5, 4, 3)
    resp = await client.get("/transactions?limit=3", headers=headers)
    data = resp.json()
    assert len(data) == 3
    amounts = [t["amount"] for t in data]
    assert amounts == [-5000, -4000, -3000]


async def test_list_transactions_pagination_offset(client):
    """Offset skips the first N transactions."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    for i in range(5):
        await _create_transaction(
            client, headers, account_id, category_id,
            amount=-(i + 1) * 1000, dt=f"2026-03-{i + 1:02d}",
        )

    # Default sort is dt desc: [Mar 5, 4, 3, 2, 1]. Offset 3 skips first 3, leaving Mar 2 and 1.
    resp = await client.get("/transactions?limit=3&offset=3", headers=headers)
    data = resp.json()
    assert len(data) == 2
    amounts = [t["amount"] for t in data]
    assert amounts == [-2000, -1000]


async def test_list_transactions_limit_zero_returns_422(client):
    """limit=0 is below the minimum and returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/transactions?limit=0", headers=headers)
    assert resp.status_code == 422


async def test_list_transactions_limit_over_max_returns_422(client):
    """limit=51 exceeds the maximum and returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/transactions?limit=51", headers=headers)
    assert resp.status_code == 422


async def test_list_transactions_includes_tag_ids(client):
    """List endpoint returns correct tag IDs and summaries for each transaction."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    tag_resp = await _create_tag(client, headers, name="listed-tag")
    tag_id = tag_resp.json()["id"]

    await _create_transaction(client, headers, account_id, category_id, tag_ids=[tag_id])
    await _create_transaction(client, headers, account_id, category_id)

    resp = await client.get("/transactions", headers=headers)

    tagged = [t for t in resp.json() if t["tag_ids"]]
    untagged = [t for t in resp.json() if not t["tag_ids"]]
    assert len(tagged) == 1
    assert tagged[0]["tag_ids"] == [tag_id]
    assert tagged[0]["tags"] == [{"id": tag_id, "group_id": None, "name": "listed-tag"}]
    assert len(untagged) == 1
    assert untagged[0]["tags"] == []


# --- GET /transactions/{id} ---


async def test_get_transaction_returns_transaction(client):
    """Valid transaction ID returns the transaction with all fields."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    merchant_resp = await _create_merchant(client, headers, name="Detail Store")
    create_resp = await _create_transaction(
        client,
        headers,
        account_id,
        category_id,
        merchant_id=merchant_resp.json()["id"],
    )
    txn_id = create_resp.json()["id"]

    resp = await client.get(f"/transactions/{txn_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["id"] == txn_id
    assert resp.json()["amount"] == -5000
    assert resp.json()["merchant_name"] == "Detail Store"
    assert resp.json()["tag_ids"] == []
    assert resp.json()["tags"] == []


async def test_get_transaction_includes_tag_ids(client):
    """Get transaction returns associated tag IDs and summaries."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    tag_resp = await _create_tag(client, headers, name="tagged")
    tag_id = tag_resp.json()["id"]

    create_resp = await _create_transaction(client, headers, account_id, category_id, tag_ids=[tag_id])
    txn_id = create_resp.json()["id"]

    resp = await client.get(f"/transactions/{txn_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["tag_ids"] == [tag_id]
    assert resp.json()["tags"] == [{"id": tag_id, "group_id": None, "name": "tagged"}]


async def test_get_transaction_not_found_returns_404(client):
    """Non-existent transaction ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/transactions/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Transaction not found"


async def test_get_transaction_other_user_returns_404(client):
    """Accessing another user's transaction returns 404."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    other_headers, _, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")

    resp = await client.get(f"/transactions/{txn_id}", headers=other_headers)
    assert resp.status_code == 404


async def test_get_transaction_without_auth_returns_401(client):
    """GET /transactions/{id} without an Authorization header returns 401."""
    resp = await client.get(f"/transactions/{NONEXISTENT_ID}")
    assert resp.status_code == 401


# --- PATCH /transactions/{id} ---


async def test_patch_transaction_updates_amount(client):
    """PATCH updates the amount field."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"amount": -9999}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["amount"] == -9999


async def test_patch_transaction_accepts_sign_changes_for_all_category_kinds(client):
    """Editing direction is a signed amount change, independent of category kind."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]

    for kind in ("expense", "income", "transfer"):
        category_resp = await _create_category(client, headers, name=f"Patch Direction {kind}", kind=kind)
        create_resp = await _create_transaction(
            client,
            headers,
            account_id,
            category_resp.json()["id"],
            amount=-1000,
        )
        txn_id = create_resp.json()["id"]

        credit_resp = await client.patch(f"/transactions/{txn_id}", json={"amount": 2500}, headers=headers)
        assert credit_resp.status_code == 200
        assert credit_resp.json()["amount"] == 2500

        debit_resp = await client.patch(f"/transactions/{txn_id}", json={"amount": -1500}, headers=headers)
        assert debit_resp.status_code == 200
        assert debit_resp.json()["amount"] == -1500


async def test_patch_transaction_updates_notes(client):
    """PATCH updates the notes field."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"notes": "Updated"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["notes"] == "Updated"


async def test_patch_transaction_updates_dt(client):
    """PATCH updates the date field."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"dt": "2026-01-01"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["dt"] == "2026-01-01"


async def test_patch_transaction_updates_account(client):
    """PATCH can move a transaction to a different account."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_account = await _create_account(client, headers, name="Savings")

    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"account_id": other_account.json()["id"]},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["account_id"] == other_account.json()["id"]


async def test_patch_transaction_replaces_tags(client):
    """PATCH with tag_ids replaces all existing tags."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    tag_a = await _create_tag(client, headers, name="tag-a")
    tag_b = await _create_tag(client, headers, name="tag-b")

    create_resp = await _create_transaction(client, headers, account_id, category_id, tag_ids=[tag_a.json()["id"]])
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"tag_ids": [tag_b.json()["id"]]}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["tag_ids"] == [tag_b.json()["id"]]
    assert resp.json()["tags"] == [{"id": tag_b.json()["id"], "group_id": None, "name": "tag-b"}]


async def test_patch_transaction_clears_tags(client):
    """PATCH with tag_ids=[] clears all tags."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    tag_resp = await _create_tag(client, headers, name="to-remove")

    create_resp = await _create_transaction(client, headers, account_id, category_id, tag_ids=[tag_resp.json()["id"]])
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"tag_ids": []}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["tag_ids"] == []
    assert resp.json()["tags"] == []


async def test_patch_transaction_updates_fx_rate(client):
    """PATCH can update fx_rate on an existing cross-currency transaction."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _seed_usd_currency()

    create_resp = await _create_transaction(client, headers, account_id, category_id, currency="USD", fx_rate=1.35)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"fx_rate": 1.40}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["fx_rate"] == 1.4


async def test_patch_transaction_move_account_with_fx_rate_succeeds(client):
    """Moving to a different-currency account succeeds when fx_rate is provided."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _seed_usd_currency()

    usd_account = await _create_account(client, headers, name="USD Account", currency="USD")

    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"account_id": usd_account.json()["id"], "fx_rate": 1.35},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["account_id"] == usd_account.json()["id"]
    assert resp.json()["fx_rate"] == 1.35


async def test_patch_transaction_updated_at_changes(client):
    """updated_at advances after a PATCH."""
    import asyncio

    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]
    original_updated_at = create_resp.json()["updated_at"]

    await asyncio.sleep(0.01)

    resp = await client.patch(f"/transactions/{txn_id}", json={"notes": "edited"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["updated_at"] > original_updated_at


async def test_patch_transaction_invalid_account_returns_404(client):
    """PATCH with non-existent account_id returns 404."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"account_id": NONEXISTENT_ID}, headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Account not found"


async def test_patch_transaction_invalid_category_returns_422(client):
    """PATCH with non-existent category_id returns 422."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"category_id": NONEXISTENT_ID}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Category not found"


async def test_patch_transaction_invalid_merchant_returns_422(client):
    """PATCH with non-existent merchant_id returns 422."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"merchant_id": NONEXISTENT_ID}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Merchant not found"


async def test_patch_transaction_invalid_tag_returns_422(client):
    """PATCH with non-existent tag ID returns 422."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"tag_ids": [NONEXISTENT_ID]}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Tag not found"


async def test_patch_transaction_clears_merchant(client):
    """PATCH with merchant_id=null clears the merchant."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    merchant_resp = await _create_merchant(client, headers)

    create_resp = await _create_transaction(client, headers, account_id, category_id, merchant_id=merchant_resp.json()["id"])
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"merchant_id": None}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["merchant_id"] is None
    assert resp.json()["merchant_name"] is None


async def test_patch_transaction_clears_notes(client):
    """PATCH with notes=null clears the notes field."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id, notes="some note")
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"notes": None}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["notes"] is None


async def test_patch_transaction_empty_body_returns_unchanged(client):
    """PATCH with empty body returns 200 with no changes."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    before = await client.get(f"/transactions/{txn_id}", headers=headers)
    resp = await client.patch(f"/transactions/{txn_id}", json={}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == before.json()


async def test_patch_transaction_different_currency_account_requires_fx_rate(client):
    """Moving a transaction to an account with a different currency requires fx_rate."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _seed_usd_currency()

    usd_account = await _create_account(client, headers, name="USD Account", currency="USD")

    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"account_id": usd_account.json()["id"]}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "fx_rate is required when transaction currency differs from account currency"


async def test_patch_transaction_not_found_returns_404(client):
    """PATCH non-existent transaction returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(f"/transactions/{NONEXISTENT_ID}", json={"amount": 1}, headers=headers)
    assert resp.status_code == 404


async def test_patch_transaction_other_user_returns_404(client):
    """PATCH on another user's transaction returns 404."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    other_headers, _, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")

    resp = await client.patch(f"/transactions/{txn_id}", json={"amount": 1}, headers=other_headers)
    assert resp.status_code == 404


async def test_patch_transaction_without_auth_returns_401(client):
    """PATCH /transactions/{id} without an Authorization header returns 401."""
    resp = await client.patch(f"/transactions/{NONEXISTENT_ID}", json={"amount": 1})
    assert resp.status_code == 401


# --- DELETE /transactions/{id} ---


async def test_delete_transaction_returns_204(client):
    """DELETE removes the transaction and returns 204."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.delete(f"/transactions/{txn_id}", headers=headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/transactions/{txn_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_transaction_cleans_up_tags(client):
    """DELETE removes junction rows — tag itself is not deleted."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    tag_resp = await _create_tag(client, headers, name="keep-me")
    tag_id = tag_resp.json()["id"]

    create_resp = await _create_transaction(client, headers, account_id, category_id, tag_ids=[tag_id])
    txn_id = create_resp.json()["id"]

    await client.delete(f"/transactions/{txn_id}", headers=headers)

    tag_check = await client.get(f"/tags/{tag_id}", headers=headers)
    assert tag_check.status_code == 200


async def test_delete_transaction_not_found_returns_404(client):
    """DELETE non-existent transaction returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(f"/transactions/{NONEXISTENT_ID}", headers=headers)
    assert resp.status_code == 404


async def test_delete_transaction_other_user_returns_404(client):
    """Deleting another user's transaction returns 404."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    other_headers, _, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")

    resp = await client.delete(f"/transactions/{txn_id}", headers=other_headers)
    assert resp.status_code == 404


async def test_delete_transaction_double_delete_returns_404(client):
    """Deleting the same transaction twice returns 204 then 404."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp1 = await client.delete(f"/transactions/{txn_id}", headers=headers)
    resp2 = await client.delete(f"/transactions/{txn_id}", headers=headers)

    assert resp1.status_code == 204
    assert resp2.status_code == 404


async def test_delete_transaction_without_auth_returns_401(client):
    """DELETE /transactions/{id} without an Authorization header returns 401."""
    resp = await client.delete(f"/transactions/{NONEXISTENT_ID}")
    assert resp.status_code == 401


# --- Transactions on closed accounts ---


async def test_create_transaction_on_closed_account_returns_422(client):
    """Creating a transaction on a closed account is rejected."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    # Close the account
    await client.patch(
        f"/accounts/{account_id}",
        json={"closed_at": "2026-03-01"},
        headers=headers,
    )

    resp = await _create_transaction(client, headers, account_id, category_id)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account is closed"


async def test_move_transaction_to_closed_account_returns_422(client):
    """Moving a transaction to a closed account is rejected."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    # Create a second account and close it
    second_acct_resp = await _create_account(client, headers, name="Closed Savings")
    closed_account_id = second_acct_resp.json()["id"]
    await client.patch(
        f"/accounts/{closed_account_id}",
        json={"closed_at": "2026-03-01"},
        headers=headers,
    )

    # Create a transaction on the open account
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    # Attempt to move it
    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"account_id": closed_account_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account is closed"


async def test_create_transaction_negative_fx_rate_different_currency_returns_422(client):
    """Creating a cross-currency transaction with a negative fx_rate is rejected."""
    await _seed_usd_currency()
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _create_transaction(
        client, headers, account_id, category_id, fx_rate=-1.5, currency="USD",
    )

    assert resp.status_code == 422


async def test_create_transaction_zero_fx_rate_different_currency_returns_422(client):
    """Creating a cross-currency transaction with fx_rate=0 is rejected."""
    await _seed_usd_currency()
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _create_transaction(
        client, headers, account_id, category_id, fx_rate=0, currency="USD",
    )

    assert resp.status_code == 422


async def test_create_transaction_negative_fx_rate_same_currency_returns_422(client):
    """Creating a same-currency transaction with a negative fx_rate is rejected."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _create_transaction(
        client, headers, account_id, category_id, fx_rate=-1.5,
    )

    assert resp.status_code == 422


async def test_create_transaction_zero_fx_rate_same_currency_returns_422(client):
    """Creating a same-currency transaction with fx_rate=0 is rejected."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _create_transaction(
        client, headers, account_id, category_id, fx_rate=0,
    )

    assert resp.status_code == 422


async def test_update_transaction_negative_fx_rate_same_currency_returns_422(client):
    """Updating a same-currency transaction to a negative fx_rate is rejected."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"fx_rate": -1.0},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_update_transaction_zero_fx_rate_same_currency_returns_422(client):
    """Updating a same-currency transaction to fx_rate=0 is rejected."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"fx_rate": 0},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_update_transaction_negative_fx_rate_different_currency_returns_422(client):
    """Updating a cross-currency transaction to a negative fx_rate is rejected."""
    await _seed_usd_currency()
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(
        client, headers, account_id, category_id, currency="USD", fx_rate=1.35,
    )
    txn_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"fx_rate": -1.0},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_update_transaction_zero_fx_rate_different_currency_returns_422(client):
    """Updating a cross-currency transaction to fx_rate=0 is rejected."""
    await _seed_usd_currency()
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(
        client, headers, account_id, category_id, currency="USD", fx_rate=1.35,
    )
    txn_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"fx_rate": 0},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_update_transaction_on_closed_account_allows_non_move_edits(client):
    """Closing an account after a transaction exists does not block edits that stay on it."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    # Create a transaction first, then close the account
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]
    await client.patch(
        f"/accounts/{account_id}",
        json={"closed_at": "2026-03-01"},
        headers=headers,
    )

    # Editing notes on the existing transaction should still succeed
    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"notes": "updated after close"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["notes"] == "updated after close"
