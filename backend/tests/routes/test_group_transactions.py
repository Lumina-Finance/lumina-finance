"""Tests for transaction behaviour within group boundaries.

Verifies cross-user isolation holds even when users share a group,
and documents current limitations around group account transactions.
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
        "account_kind": "asset",
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


async def _create_group(client, headers, **overrides):
    """Create a group via POST /groups.

    Defaults: name="Smith Family".

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The HTTP response from the API.
    """
    payload = {"name": "Smith Family", **overrides}
    return await client.post("/groups", json=payload, headers=headers)


async def _setup_group_with_two_members(client):
    """Create two users in the same group, each with their own account and category.

    User 1 is the group owner (admin). User 2 is added as a regular member.

    Args:
        client: The async test client.

    Returns:
        Tuple of (user1_headers, user1_account_id, user1_category_id,
                  user2_headers, user2_account_id, user2_category_id,
                  group_id).
    """
    # User 1 — group owner
    signup1 = await _create_user(client)
    headers1 = _get_auth_header(signup1)
    acct1 = await _create_account(client, headers1, name="User1 Chequing")
    cat1 = await _create_category(client, headers1, name="User1 Groceries")

    # Create group
    group_resp = await _create_group(client, headers1)
    group_id = group_resp.json()["id"]

    # User 2 — group member
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

    # Add user 2 to group
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": user2_id},
        headers=headers1,
    )

    return (
        headers1, acct1.json()["id"], cat1.json()["id"],
        headers2, acct2.json()["id"], cat2.json()["id"],
        group_id,
    )


# --- Cross-user isolation within a group ---


async def test_group_member_cannot_list_other_members_transactions(client):
    """Group members cannot see each other's personal transactions."""
    h1, acct1, cat1, h2, acct2, cat2, _ = await _setup_group_with_two_members(client)

    await _create_transaction(client, h1, acct1, cat1, amount=-1000)
    await _create_transaction(client, h2, acct2, cat2, amount=-2000)

    resp1 = await client.get("/transactions", headers=h1)
    resp2 = await client.get("/transactions", headers=h2)

    assert len(resp1.json()) == 1
    assert resp1.json()[0]["amount"] == -1000
    assert len(resp2.json()) == 1
    assert resp2.json()[0]["amount"] == -2000


async def test_group_member_cannot_get_other_members_transaction(client):
    """Group member cannot retrieve another member's transaction by ID."""
    h1, acct1, cat1, h2, _, _, _ = await _setup_group_with_two_members(client)

    create_resp = await _create_transaction(client, h1, acct1, cat1)
    txn_id = create_resp.json()["id"]

    resp = await client.get(f"/transactions/{txn_id}", headers=h2)
    assert resp.status_code == 404


async def test_group_member_cannot_patch_other_members_transaction(client):
    """Group member cannot update another member's transaction."""
    h1, acct1, cat1, h2, _, _, _ = await _setup_group_with_two_members(client)

    create_resp = await _create_transaction(client, h1, acct1, cat1)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"amount": -9999}, headers=h2)
    assert resp.status_code == 404


async def test_group_member_cannot_delete_other_members_transaction(client):
    """Group member cannot delete another member's transaction."""
    h1, acct1, cat1, h2, _, _, _ = await _setup_group_with_two_members(client)

    create_resp = await _create_transaction(client, h1, acct1, cat1)
    txn_id = create_resp.json()["id"]

    resp = await client.delete(f"/transactions/{txn_id}", headers=h2)
    assert resp.status_code == 404


async def test_group_member_cannot_create_transaction_on_other_members_account(client):
    """Group member cannot create a transaction on another member's personal account."""
    _, acct1, _, h2, _, cat2, _ = await _setup_group_with_two_members(client)

    resp = await _create_transaction(client, h2, acct1, cat2)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Account not found"


# --- Group account transactions with permissions ---


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


async def _setup_group_with_shared_account(client):
    """Create a group with admin, member, group account, category, and merchant.

    Args:
        client: The async test client.

    Returns:
        Tuple of (admin_headers, member_headers, member_user_id,
                  group_id, account_id, category_id, merchant_id).
    """
    signup1 = await _create_user(client)
    admin_headers = _get_auth_header(signup1)

    group_resp = await _create_group(client, admin_headers)
    group_id = group_resp.json()["id"]

    signup2 = await client.post("/auth/signup", json={
        "email": "member@example.com", "password": "securepassword123",
        "first_name": "Member", "tz": "America/Toronto", "base_currency": "CAD",
    })
    member_headers = _get_auth_header(signup2)
    member_user_id = signup2.json()["user"]["id"]
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )

    acct_resp = await _create_account(client, admin_headers, name="Joint Checking", group_id=group_id)
    account_id = acct_resp.json()["id"]

    cat_resp = await _create_category(client, admin_headers, name="Group Groceries", group_id=group_id)
    category_id = cat_resp.json()["id"]

    merchant_resp = await _create_merchant(client, admin_headers, name="Group Costco", group_id=group_id)
    merchant_id = merchant_resp.json()["id"]

    return admin_headers, member_headers, member_user_id, group_id, account_id, category_id, merchant_id


async def _grant_account_permission(client, admin_headers, account_id, user_id, level):
    """Grant an account permission to a user.

    Args:
        client: The async test client.
        admin_headers: Auth headers for a group admin.
        account_id: UUID of the account.
        user_id: UUID of the target user.
        level: Permission level ("read", "write", "admin").
    """
    await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": user_id, "level": level},
        headers=admin_headers,
    )


async def test_create_transaction_on_group_account_as_admin(client):
    """Admin can create a transaction on a group account with group category and merchant."""
    admin_headers, _, _, _, account_id, category_id, merchant_id = (
        await _setup_group_with_shared_account(client)
    )

    resp = await _create_transaction(
        client, admin_headers, account_id, category_id, merchant_id=merchant_id,
    )

    assert resp.status_code == 201
    assert resp.json()["account_id"] == account_id
    assert resp.json()["category_id"] == category_id
    assert resp.json()["merchant_id"] == merchant_id


async def test_create_transaction_on_group_account_with_write_permission(client):
    """Member with write permission can create a transaction on a group account."""
    admin_headers, member_headers, member_user_id, _, account_id, category_id, merchant_id = (
        await _setup_group_with_shared_account(client)
    )
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "write")

    resp = await _create_transaction(
        client, member_headers, account_id, category_id, merchant_id=merchant_id,
    )

    assert resp.status_code == 201
    assert resp.json()["account_id"] == account_id


async def test_create_transaction_on_group_account_read_only_returns_403(client):
    """Member with read-only permission cannot create a transaction."""
    admin_headers, member_headers, member_user_id, _, account_id, category_id, _ = (
        await _setup_group_with_shared_account(client)
    )
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "read")

    resp = await _create_transaction(client, member_headers, account_id, category_id)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_create_transaction_on_group_account_no_permission_returns_404(client):
    """Member with no permission cannot create a transaction on a group account."""
    _, member_headers, _, _, account_id, category_id, _ = (
        await _setup_group_with_shared_account(client)
    )

    resp = await _create_transaction(client, member_headers, account_id, category_id)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Account not found"


async def test_create_transaction_with_group_category(client):
    """Transaction on a group account accepts group-scoped categories."""
    admin_headers, member_headers, member_user_id, group_id, account_id, _, _ = (
        await _setup_group_with_shared_account(client)
    )
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "write")

    # Create a different group category as the member
    cat_resp = await _create_category(client, member_headers, name="Games", kind="expense", group_id=group_id)
    category_id = cat_resp.json()["id"]

    resp = await _create_transaction(client, member_headers, account_id, category_id)

    assert resp.status_code == 201
    assert resp.json()["category_id"] == category_id


async def test_create_transaction_with_group_merchant(client):
    """Transaction on a group account accepts group-scoped merchants."""
    admin_headers, member_headers, member_user_id, _, account_id, category_id, merchant_id = (
        await _setup_group_with_shared_account(client)
    )
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "write")

    resp = await _create_transaction(
        client, member_headers, account_id, category_id, merchant_id=merchant_id,
    )

    assert resp.status_code == 201
    assert resp.json()["merchant_id"] == merchant_id


async def test_list_transactions_includes_group_account_transactions(client):
    """Member with read permission sees transactions on group accounts."""
    admin_headers, member_headers, member_user_id, _, account_id, category_id, _ = (
        await _setup_group_with_shared_account(client)
    )
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "read")

    # Admin creates a transaction on the group account
    await _create_transaction(client, admin_headers, account_id, category_id, amount=-3000)

    # Member should see it
    resp = await client.get("/transactions", headers=member_headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["amount"] == -3000
    assert resp.json()[0]["account_id"] == account_id


async def test_update_transaction_on_group_account_requires_write(client):
    """Member with read-only permission cannot update a group transaction."""
    admin_headers, member_headers, member_user_id, _, account_id, category_id, _ = (
        await _setup_group_with_shared_account(client)
    )
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "read")

    create_resp = await _create_transaction(client, admin_headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"amount": -9999}, headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_delete_transaction_on_group_account_requires_write(client):
    """Member with read-only permission cannot delete a group transaction."""
    admin_headers, member_headers, member_user_id, _, account_id, category_id, _ = (
        await _setup_group_with_shared_account(client)
    )
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "read")

    create_resp = await _create_transaction(client, admin_headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.delete(f"/transactions/{txn_id}", headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_update_transaction_on_group_account_with_write_permission(client):
    """Member with write permission can update a group transaction."""
    admin_headers, member_headers, member_user_id, _, account_id, category_id, _ = (
        await _setup_group_with_shared_account(client)
    )
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "write")

    create_resp = await _create_transaction(client, admin_headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"amount": -9999}, headers=member_headers)

    assert resp.status_code == 200
    assert resp.json()["amount"] == -9999


async def test_delete_transaction_on_group_account_with_write_permission(client):
    """Member with write permission can delete a group transaction."""
    admin_headers, member_headers, member_user_id, _, account_id, category_id, _ = (
        await _setup_group_with_shared_account(client)
    )
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "write")

    create_resp = await _create_transaction(client, admin_headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.delete(f"/transactions/{txn_id}", headers=member_headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/transactions/{txn_id}", headers=admin_headers)
    assert get_resp.status_code == 404


async def test_create_transaction_with_other_users_personal_category_returns_422(client):
    """Cannot use another member's personal category on a group account."""
    admin_headers, member_headers, member_user_id, _, account_id, _, _ = (
        await _setup_group_with_shared_account(client)
    )
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "write")

    # Admin's personal category (not group-scoped)
    admin_personal_cat = await _create_category(client, admin_headers, name="Admin Personal", kind="expense")
    admin_cat_id = admin_personal_cat.json()["id"]

    # Member tries to use admin's personal category
    resp = await _create_transaction(client, member_headers, account_id, admin_cat_id)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Category not found"


# --- Transactions on closed group accounts ---


async def test_create_transaction_on_closed_group_account_returns_422(client):
    """Admin cannot create a transaction on a closed group account."""
    admin_headers, _, _, _, account_id, category_id, _ = (
        await _setup_group_with_shared_account(client)
    )

    await client.patch(
        f"/accounts/{account_id}",
        json={"closed_at": "2026-03-01T00:00:00Z"},
        headers=admin_headers,
    )

    resp = await _create_transaction(client, admin_headers, account_id, category_id)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account is closed"


async def test_create_transaction_on_closed_group_account_with_write_permission_returns_422(client):
    """Member with write permission cannot create on a closed group account."""
    admin_headers, member_headers, member_user_id, _, account_id, category_id, _ = (
        await _setup_group_with_shared_account(client)
    )
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "write")

    await client.patch(
        f"/accounts/{account_id}",
        json={"closed_at": "2026-03-01T00:00:00Z"},
        headers=admin_headers,
    )

    resp = await _create_transaction(client, member_headers, account_id, category_id)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account is closed"


async def test_move_transaction_to_closed_group_account_returns_422(client):
    """Moving a transaction onto a closed group account is rejected."""
    admin_headers, _, _, group_id, account_id, category_id, _ = (
        await _setup_group_with_shared_account(client)
    )

    # Create a second group account and close it
    second_acct = await _create_account(
        client, admin_headers, name="Joint Savings", group_id=group_id,
    )
    closed_account_id = second_acct.json()["id"]
    await client.patch(
        f"/accounts/{closed_account_id}",
        json={"closed_at": "2026-03-01T00:00:00Z"},
        headers=admin_headers,
    )

    # Create a transaction on the open group account
    create_resp = await _create_transaction(client, admin_headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"account_id": closed_account_id},
        headers=admin_headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account is closed"
