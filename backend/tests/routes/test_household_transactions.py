"""Tests for transaction behaviour within household boundaries.

Verifies cross-user isolation holds even when users share a household,
and documents current limitations around household account transactions.
"""

from tests.routes.conftest import _create_user, _get_auth_header

# --- Helpers ---


async def _create_account(client, headers, **overrides):
    """Create an account via POST /accounts.

    Defaults: account_type="checking", tax_treatment="taxable",
    name="Main Chequing", currency="CAD".

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The HTTP response from the API.
    """
    payload = {
        "account_type": "checking",
        "tax_treatment": "taxable",
        "name": "Main Chequing",
        "currency": "CAD",
        **overrides,
    }
    return await client.post("/accounts", json=payload, headers=headers)


async def _create_category(client, headers, **overrides):
    """Create a category via POST /categories.

    Defaults: name="Groceries", kind="expense".

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The HTTP response from the API.
    """
    payload = {"name": "Groceries", "kind": "expense", **overrides}
    return await client.post("/categories", json=payload, headers=headers)


async def _create_transaction(client, headers, account_id, category_id, **overrides):
    """Create a transaction via POST /transactions.

    Defaults: ts="2026-03-15T12:00:00Z", amount=-5000, currency="CAD".

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
        "ts": "2026-03-15T12:00:00Z",
        "amount": -5000,
        "currency": "CAD",
        **overrides,
    }
    return await client.post("/transactions", json=payload, headers=headers)


async def _create_household(client, headers, **overrides):
    """Create a household via POST /households.

    Defaults: name="Smith Family".

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The HTTP response from the API.
    """
    payload = {"name": "Smith Family", **overrides}
    return await client.post("/households", json=payload, headers=headers)


async def _setup_household_with_two_members(client):
    """Create two users in the same household, each with their own account and category.

    User 1 is the household owner (admin). User 2 is added as a regular member.

    Args:
        client: The async test client.

    Returns:
        Tuple of (user1_headers, user1_account_id, user1_category_id,
                  user2_headers, user2_account_id, user2_category_id,
                  household_id).
    """
    # User 1 — household owner
    signup1 = await _create_user(client)
    headers1 = _get_auth_header(signup1)
    acct1 = await _create_account(client, headers1, name="User1 Chequing")
    cat1 = await _create_category(client, headers1, name="User1 Groceries")

    # Create household
    household_resp = await _create_household(client, headers1)
    household_id = household_resp.json()["id"]

    # User 2 — household member
    signup2 = await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "securepassword123",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    headers2 = _get_auth_header(signup2)
    user2_id = signup2.json()["user"]["id"]
    acct2 = await _create_account(client, headers2, name="User2 Chequing")
    cat2 = await _create_category(client, headers2, name="User2 Groceries")

    # Add user 2 to household
    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": user2_id},
        headers=headers1,
    )

    return (
        headers1, acct1.json()["id"], cat1.json()["id"],
        headers2, acct2.json()["id"], cat2.json()["id"],
        household_id,
    )


# --- Cross-user isolation within a household ---


async def test_household_member_cannot_list_other_members_transactions(client):
    """Household members cannot see each other's personal transactions."""
    h1, acct1, cat1, h2, acct2, cat2, _ = await _setup_household_with_two_members(client)

    await _create_transaction(client, h1, acct1, cat1, amount=-1000)
    await _create_transaction(client, h2, acct2, cat2, amount=-2000)

    resp1 = await client.get("/transactions", headers=h1)
    resp2 = await client.get("/transactions", headers=h2)

    assert len(resp1.json()) == 1
    assert resp1.json()[0]["amount"] == -1000
    assert len(resp2.json()) == 1
    assert resp2.json()[0]["amount"] == -2000


async def test_household_member_cannot_get_other_members_transaction(client):
    """Household member cannot retrieve another member's transaction by ID."""
    h1, acct1, cat1, h2, _, _, _ = await _setup_household_with_two_members(client)

    create_resp = await _create_transaction(client, h1, acct1, cat1)
    txn_id = create_resp.json()["id"]

    resp = await client.get(f"/transactions/{txn_id}", headers=h2)
    assert resp.status_code == 404


async def test_household_member_cannot_patch_other_members_transaction(client):
    """Household member cannot update another member's transaction."""
    h1, acct1, cat1, h2, _, _, _ = await _setup_household_with_two_members(client)

    create_resp = await _create_transaction(client, h1, acct1, cat1)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"amount": -9999}, headers=h2)
    assert resp.status_code == 404


async def test_household_member_cannot_delete_other_members_transaction(client):
    """Household member cannot delete another member's transaction."""
    h1, acct1, cat1, h2, _, _, _ = await _setup_household_with_two_members(client)

    create_resp = await _create_transaction(client, h1, acct1, cat1)
    txn_id = create_resp.json()["id"]

    resp = await client.delete(f"/transactions/{txn_id}", headers=h2)
    assert resp.status_code == 404


async def test_household_member_cannot_create_transaction_on_other_members_account(client):
    """Household member cannot create a transaction on another member's personal account."""
    _, acct1, _, h2, _, cat2, _ = await _setup_household_with_two_members(client)

    resp = await _create_transaction(client, h2, acct1, cat2)
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account not found"
