from tests.routes.merchants._helpers import (
    NONEXISTENT_ID,
    _create_category,
    _create_group,
    _create_merchant,
    _get_system_category_id,
    _setup_group_with_member,
)
from tests.routes.support import _create_user, _get_auth_header

# --- Group merchants: POST /merchants ---


async def test_create_group_merchant_as_member_returns_201(client):
    """Any group member can create a group merchant."""
    _, member_headers, _, group_id = await _setup_group_with_member(client)

    resp = await _create_merchant(client, member_headers, name="Costco", group_id=group_id)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Costco"
    assert data["group_id"] == group_id


async def test_create_group_merchant_as_admin_returns_201(client):
    """Admin can create a group merchant."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    resp = await _create_merchant(client, admin_headers, name="Walmart", group_id=group_id)

    assert resp.status_code == 201
    assert resp.json()["group_id"] == group_id


async def test_create_group_merchant_non_member_returns_404(client):
    """Non-member cannot create a merchant in a group."""
    _, _, _, group_id = await _setup_group_with_member(client)

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "SecurePassword123!",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await _create_merchant(client, outsider_headers, group_id=group_id)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Group not found"


async def test_create_group_merchant_nonexistent_group_returns_404(client):
    """Creating a merchant with a fake group_id returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_merchant(client, headers, group_id=NONEXISTENT_ID)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Group not found"


async def test_create_group_merchant_duplicate_returns_409(client):
    """Duplicate name within the same group returns 409."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_merchant(client, admin_headers, name="Costco", group_id=group_id)
    resp = await _create_merchant(client, admin_headers, name="Costco", group_id=group_id)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_create_group_merchant_same_name_as_personal_allowed(client):
    """Personal and group merchants with the same name can coexist."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    personal = await _create_merchant(client, admin_headers, name="Costco")
    group = await _create_merchant(client, admin_headers, name="Costco", group_id=group_id)

    assert personal.status_code == 201
    assert group.status_code == 201
    assert personal.json()["id"] != group.json()["id"]


async def test_create_group_merchant_with_group_category(client):
    """Group merchant can use a group category as default."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    cat_resp = await _create_category(client, admin_headers, name="Test Groceries", group_id=group_id)
    category_id = cat_resp.json()["id"]

    resp = await _create_merchant(client, admin_headers, name="Costco", group_id=group_id, default_category_id=category_id)

    assert resp.status_code == 201
    assert resp.json()["default_category_id"] == category_id


async def test_create_group_merchant_with_system_category(client):
    """Group merchant can use a system category as default."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)
    category_id = await _get_system_category_id(client, admin_headers)

    resp = await _create_merchant(client, admin_headers, name="Costco", group_id=group_id, default_category_id=category_id)

    assert resp.status_code == 201
    assert resp.json()["default_category_id"] == category_id


async def test_create_group_merchant_with_personal_category(client):
    """Group merchant can use the creator's personal category as default."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    cat_resp = await _create_category(client, admin_headers, name="Test Groceries")
    category_id = cat_resp.json()["id"]

    resp = await _create_merchant(client, admin_headers, name="Costco", group_id=group_id, default_category_id=category_id)

    assert resp.status_code == 201
    assert resp.json()["default_category_id"] == category_id


# --- Group merchants: GET /merchants ---


async def test_list_merchants_with_group_filter_as_admin(client):
    """Admin passing group_id returns personal + that group's merchants."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_merchant(client, admin_headers, name="Personal Store")
    await _create_merchant(client, admin_headers, name="Shared Store", group_id=group_id)

    resp = await client.get(f"/merchants?group_id={group_id}", headers=admin_headers)

    assert resp.status_code == 200
    names = {m["name"] for m in resp.json()}
    assert "Personal Store" in names
    assert "Shared Store" in names


async def test_list_merchants_with_group_filter_as_member(client):
    """Non-admin member passing group_id also sees group merchants."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    await _create_merchant(client, admin_headers, name="Shared Store", group_id=group_id)

    resp = await client.get(f"/merchants?group_id={group_id}", headers=member_headers)

    assert resp.status_code == 200
    names = {m["name"] for m in resp.json()}
    assert "Shared Store" in names


async def test_list_merchants_without_group_filter_excludes_group(client):
    """Without group_id filter, only personal merchants are returned."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_merchant(client, admin_headers, name="Personal Store")
    await _create_merchant(client, admin_headers, name="Shared Store", group_id=group_id)

    resp = await client.get("/merchants", headers=admin_headers)

    assert resp.status_code == 200
    names = {m["name"] for m in resp.json()}
    assert "Personal Store" in names
    assert "Shared Store" not in names


async def test_list_merchants_group_filter_non_member_returns_404(client):
    """Non-member passing group_id filter returns 404."""
    _, _, _, group_id = await _setup_group_with_member(client)

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "SecurePassword123!",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.get(f"/merchants?group_id={group_id}", headers=outsider_headers)

    assert resp.status_code == 404


async def test_get_group_merchant_as_member(client):
    """Non-admin member can view a group merchant."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_merchant(client, admin_headers, name="Shared", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    resp = await client.get(f"/merchants/{merchant_id}", headers=member_headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "Shared"
    assert resp.json()["group_id"] == group_id


async def test_get_group_merchant_non_member_returns_404(client):
    """Non-member cannot view a group merchant."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_merchant(client, admin_headers, name="Shared", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "SecurePassword123!",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.get(f"/merchants/{merchant_id}", headers=outsider_headers)

    assert resp.status_code == 404


async def test_list_merchants_with_group_filter_excludes_other_groups(client):
    """Merchant created in Group A must not appear when listing with Group B's filter."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_a = await _create_group(client, headers)
    group_b = await _create_group(client, headers)

    await _create_merchant(client, headers, name="Personal Store")
    await _create_merchant(client, headers, name="Group A Store", group_id=group_a)
    await _create_merchant(client, headers, name="Group B Store", group_id=group_b)

    resp = await client.get(f"/merchants?group_id={group_b}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    names = {m["name"] for m in data}
    assert len(data) == 2
    assert "Personal Store" in names
    assert "Group B Store" in names
    assert "Group A Store" not in names


async def test_list_merchants_group_filter_supports_search_and_pagination(client):
    """Search and pagination respect personal + selected-group merchant scope."""
    headers = _get_auth_header(await _create_user(client))

    group_a = await _create_group(client, headers)
    group_b = await _create_group(client, headers)

    await _create_merchant(client, headers, name="Alpha Shared Personal")
    await _create_merchant(client, headers, name="Beta Shared Group", group_id=group_b)
    await _create_merchant(client, headers, name="Gamma Shared Other Group", group_id=group_a)

    first_page = await client.get(f"/merchants?group_id={group_b}&q=shared&limit=1", headers=headers)
    second_page = await client.get(f"/merchants?group_id={group_b}&q=shared&limit=1&offset=1", headers=headers)

    assert first_page.status_code == 200
    assert [merchant["name"] for merchant in first_page.json()] == ["Alpha Shared Personal"]
    assert second_page.status_code == 200
    assert [merchant["name"] for merchant in second_page.json()] == ["Beta Shared Group"]


# --- Group merchants: PATCH /merchants ---


async def test_patch_group_merchant_as_admin(client):
    """Admin can update a group merchant."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_merchant(client, admin_headers, name="Old Name", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(f"/merchants/{merchant_id}", json={"name": "New Name"}, headers=admin_headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"


async def test_patch_group_merchant_with_group_category(client):
    """Admin can update a group merchant's default category to a group category."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    cat_resp = await _create_category(client, admin_headers, name="Test Groceries", group_id=group_id)
    category_id = cat_resp.json()["id"]

    create_resp = await _create_merchant(client, admin_headers, name="Costco", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/merchants/{merchant_id}",
        json={"default_category_id": category_id},
        headers=admin_headers,
    )

    assert resp.status_code == 200
    assert resp.json()["default_category_id"] == category_id


async def test_patch_group_merchant_as_non_admin_returns_403(client):
    """Non-admin member cannot update a group merchant."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_merchant(client, admin_headers, name="Shared", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(f"/merchants/{merchant_id}", json={"name": "Hacked"}, headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"


async def test_patch_group_merchant_non_member_returns_404(client):
    """Non-member cannot see or update a group merchant."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_merchant(client, admin_headers, name="Shared", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "SecurePassword123!",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.patch(f"/merchants/{merchant_id}", json={"name": "Hacked"}, headers=outsider_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Merchant not found"


async def test_patch_group_merchant_rename_to_duplicate_returns_409(client):
    """Renaming a group merchant to an existing group merchant name returns 409."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_merchant(client, admin_headers, name="Costco", group_id=group_id)
    create_resp = await _create_merchant(client, admin_headers, name="Walmart", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(f"/merchants/{merchant_id}", json={"name": "Costco"}, headers=admin_headers)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]

    # Verify the merchant was not mutated
    get_resp = await client.get(f"/merchants/{merchant_id}", headers=admin_headers)
    assert get_resp.json()["name"] == "Walmart"


# --- Group merchants: DELETE /merchants ---


async def test_delete_group_merchant_as_admin(client):
    """Admin can delete a group merchant."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_merchant(client, admin_headers, name="ToDelete", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    resp = await client.delete(f"/merchants/{merchant_id}", headers=admin_headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/merchants/{merchant_id}", headers=admin_headers)
    assert get_resp.status_code == 404


async def test_delete_group_merchant_as_non_admin_returns_403(client):
    """Non-admin member cannot delete a group merchant."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_merchant(client, admin_headers, name="Shared", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    resp = await client.delete(f"/merchants/{merchant_id}", headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"


async def test_delete_group_merchant_non_member_returns_404(client):
    """Non-member cannot see or delete a group merchant."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_merchant(client, admin_headers, name="Shared", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "SecurePassword123!",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.delete(f"/merchants/{merchant_id}", headers=outsider_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Merchant not found"


async def test_delete_merchant_referenced_by_transaction_returns_409(client):
    """Deleting a merchant that has transactions referencing it returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    # Set up category, merchant, account, and a transaction referencing the merchant
    cat_resp = await client.post("/categories", json={
        "name": "Test Groceries", "kind": "expense",
    }, headers=headers)
    category_id = cat_resp.json()["id"]

    merchant_resp = await _create_merchant(client, headers, name="Costco")
    merchant_id = merchant_resp.json()["id"]

    acct_resp = await client.post("/accounts", json={
        "account_kind": "asset", "account_type": "checking", "name": "Chequing", "currency": "CAD",
    }, headers=headers)
    account_id = acct_resp.json()["id"]

    await client.post("/transactions", json={
        "account_id": account_id,
        "category_id": category_id,
        "merchant_id": merchant_id,
        "dt": "2026-03-15",
        "amount": -5000,
        "currency": "CAD",
    }, headers=headers)

    resp = await client.delete(f"/merchants/{merchant_id}", headers=headers)

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Merchant is referenced by existing transactions"
