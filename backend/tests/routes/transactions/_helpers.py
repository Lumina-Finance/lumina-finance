

from app.models.base import InstitutionStatus
from app.models.currency import Currency
from app.models.institution import Institution
from tests.conftest import TestSession
from tests.routes.support import _create_user, _get_auth_header

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"

async def _seed_usd_currency():
    """Seed a USD currency row directly in the database for fx_rate validation tests

    Inserts via raw session (not the API) because currencies are seeded data,
    not user-created resources
    """
    async with TestSession() as session:

        # Insert USD as seeded currency data for transaction FX validation tests
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

async def _seed_institution():
    """Seed an institution directly for import-created account linking"""
    async with TestSession() as session:

        # Insert a canonical institution row so import mappings can link accounts
        inst = Institution(
            status=InstitutionStatus.CANONICAL,
            name="Test Bank",
            country_code="CA",
            website="https://testbank.example.com",
        )
        session.add(inst)
        await session.commit()
        await session.refresh(inst)
        return inst

async def _create_category(client, headers, **overrides):
    """Create a category via POST /categories

    Defaults: name="Test Groceries", kind="expense"

    Args:
        client: The async test client
        headers: Auth headers for the requesting user
        **overrides: Fields to override in the default payload

    Returns:
        The HTTP response from the API
    """
    payload = {"name": "Test Expense", "kind": "expense", **overrides}
    return await client.post("/categories", json=payload, headers=headers)

async def _create_account(client, headers, **overrides):
    """Create an account via POST /accounts

    Defaults: account_type="checking", name="Main Chequing", currency="CAD"

    Args:
        client: The async test client
        headers: Auth headers for the requesting user
        **overrides: Fields to override in the default payload

    Returns:
        The HTTP response from the API
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
    """Create a merchant via POST /merchants

    Defaults: name="Costco"

    Args:
        client: The async test client
        headers: Auth headers for the requesting user
        **overrides: Fields to override in the default payload

    Returns:
        The HTTP response from the API
    """
    payload = {"name": "Costco", **overrides}
    return await client.post("/merchants", json=payload, headers=headers)

async def _create_tag(client, headers, **overrides):
    """Create a tag via POST /tags

    Defaults: name="vacation"

    Args:
        client: The async test client
        headers: Auth headers for the requesting user
        **overrides: Fields to override in the default payload

    Returns:
        The HTTP response from the API
    """
    payload = {"name": "vacation", **overrides}
    return await client.post("/tags", json=payload, headers=headers)

async def _create_transaction(client, headers, account_id, category_id, **overrides):
    """Create a transaction via POST /transactions

    Defaults: dt="2026-03-15", amount=-5000, currency="CAD"

    Args:
        client: The async test client
        headers: Auth headers for the requesting user
        account_id: UUID of the account to attach the transaction to
        category_id: UUID of the category to assign
        **overrides: Fields to override in the default payload

    Returns:
        The HTTP response from the API
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
    """Return the ID for a seeded system category"""
    resp = await client.get("/categories", headers=headers)
    return next(category["id"] for category in resp.json() if category["name"] == name)

async def _setup_user_with_deps(client, email="test@example.com", name_prefix="Main"):
    """Sign up a user and create the minimum dependencies for a transaction

    Creates one account and one category — the required FKs for any transaction
    Pass a different email/name_prefix to create an isolated second user

    Args:
        client: The async test client
        email: Email for signup. Must be unique per test to avoid conflicts
        name_prefix: Prefix for the account and category names

    Returns:
        Tuple of (auth_headers, account_id, category_id)
    """
    if email == "test@example.com":
        signup_resp = await _create_user(client)
    else:
        signup_resp = await client.post("/auth/signup", json={
            "email": email,
            "password": "SecurePassword123!",
            "first_name": name_prefix,
            "tz": "America/Toronto",
            "base_currency": "CAD",
        })
    headers = _get_auth_header(signup_resp)
    account_resp = await _create_account(client, headers, name=f"{name_prefix} Chequing")
    category_resp = await _create_category(client, headers, name=f"{name_prefix} Groceries")
    return headers, account_resp.json()["id"], category_resp.json()["id"]
