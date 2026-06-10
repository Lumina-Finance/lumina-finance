from tests.routes.categories._helpers import (
    NONEXISTENT_ID,
    _create_category,
    _create_group,
    _setup_group_with_member,
)
from tests.routes.support import _create_user, _get_auth_header

# --- Group categories: POST /categories ---


async def test_create_group_category_as_member_returns_201(client):
    """Any group member can create a group category."""
    _, member_headers, _, group_id = await _setup_group_with_member(client)

    resp = await _create_category(client, member_headers, name="Games", group_id=group_id)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Games"
    assert data["group_id"] == group_id
    assert data["owner_id"] is None


async def test_create_group_category_as_admin_returns_201(client):
    """Admin can create a group category."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    resp = await _create_category(client, admin_headers, name="Test Utilities", group_id=group_id)

    assert resp.status_code == 201
    assert resp.json()["group_id"] == group_id


async def test_create_group_category_non_member_returns_404(client):
    """Non-member cannot create a category in a group."""
    _, _, _, group_id = await _setup_group_with_member(client)

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await _create_category(client, outsider_headers, group_id=group_id)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Group not found"


async def test_create_group_category_duplicate_returns_409(client):
    """Duplicate name within the same group returns 409."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_category(client, admin_headers, name="Food", kind="expense", group_id=group_id)
    resp = await _create_category(client, admin_headers, name="Food", kind="expense", group_id=group_id)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_create_group_category_same_name_as_system_returns_409(client):
    """Group categories cannot reuse system category names, regardless of kind or casing."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    resp = await _create_category(client, admin_headers, name="transfer", kind="expense", group_id=group_id)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_create_group_category_same_name_as_personal_allowed(client):
    """Personal and group categories with the same name can coexist."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    personal = await _create_category(client, admin_headers, name="Coexist Test", kind="expense")
    group = await _create_category(client, admin_headers, name="Coexist Test", kind="expense", group_id=group_id)

    assert personal.status_code == 201
    assert group.status_code == 201
    assert personal.json()["id"] != group.json()["id"]


async def test_create_group_category_nonexistent_group_returns_404(client):
    """Creating a category with a fake group_id returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_category(client, headers, group_id=NONEXISTENT_ID)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Group not found"


# --- Group categories: GET /categories ---


async def test_list_categories_with_group_filter_as_admin(client):
    """Admin passing group_id returns personal + that group's categories."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_category(client, admin_headers, name="Personal Cat", kind="expense")
    await _create_category(client, admin_headers, name="Shared Cat", kind="expense", group_id=group_id)

    resp = await client.get(f"/categories?group_id={group_id}", headers=admin_headers)

    assert resp.status_code == 200
    names = {c["name"] for c in resp.json()}
    assert "Personal Cat" in names
    assert "Shared Cat" in names


async def test_list_categories_with_group_filter_as_member(client):
    """Non-admin member passing group_id also sees group categories."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    await _create_category(client, admin_headers, name="Shared Cat", kind="expense", group_id=group_id)

    resp = await client.get(f"/categories?group_id={group_id}", headers=member_headers)

    assert resp.status_code == 200
    names = {c["name"] for c in resp.json()}
    assert "Shared Cat" in names


async def test_list_categories_without_group_filter_excludes_group(client):
    """Without group_id filter, only personal categories are returned."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_category(client, admin_headers, name="Personal Cat", kind="expense")
    await _create_category(client, admin_headers, name="Shared Cat", kind="expense", group_id=group_id)

    resp = await client.get("/categories", headers=admin_headers)

    assert resp.status_code == 200
    names = {c["name"] for c in resp.json()}
    assert "Personal Cat" in names
    assert "Shared Cat" not in names


async def test_list_categories_group_filter_non_member_returns_404(client):
    """Non-member passing group_id filter returns 404."""
    _, _, _, group_id = await _setup_group_with_member(client)

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.get(f"/categories?group_id={group_id}", headers=outsider_headers)

    assert resp.status_code == 404


async def test_get_group_category_as_member(client):
    """Non-admin member can view a group category."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_category(client, admin_headers, name="Shared", group_id=group_id)
    category_id = create_resp.json()["id"]

    resp = await client.get(f"/categories/{category_id}", headers=member_headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "Shared"
    assert resp.json()["group_id"] == group_id


async def test_get_group_category_non_member_returns_404(client):
    """Non-member cannot view a group category."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_category(client, admin_headers, name="Shared", group_id=group_id)
    category_id = create_resp.json()["id"]

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.get(f"/categories/{category_id}", headers=outsider_headers)

    assert resp.status_code == 404


async def test_list_categories_with_group_filter_excludes_other_groups(client):
    """Category created in Group A must not appear when listing with Group B's filter."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_a = await _create_group(client, headers)
    group_b = await _create_group(client, headers)

    await _create_category(client, headers, name="Personal Cat", kind="expense")
    await _create_category(client, headers, name="Group A Cat", kind="expense", group_id=group_a)
    await _create_category(client, headers, name="Group B Cat", kind="expense", group_id=group_b)

    resp = await client.get(f"/categories?group_id={group_b}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    names = {c["name"] for c in data}
    assert "Personal Cat" in names
    assert "Group B Cat" in names
    assert "Group A Cat" not in names


# --- Group categories: PATCH /categories ---


async def test_patch_group_category_as_admin(client):
    """Admin can update a group category."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_category(client, admin_headers, name="Old Name", group_id=group_id)
    category_id = create_resp.json()["id"]

    resp = await client.patch(f"/categories/{category_id}", json={"name": "New Name"}, headers=admin_headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"


async def test_patch_group_category_as_non_admin_returns_403(client):
    """Non-admin member cannot update a group category."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_category(client, admin_headers, name="Shared", group_id=group_id)
    category_id = create_resp.json()["id"]

    resp = await client.patch(f"/categories/{category_id}", json={"name": "Hacked"}, headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"


async def test_patch_group_category_non_member_returns_404(client):
    """Non-member cannot see or update a group category."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_category(client, admin_headers, name="Shared", group_id=group_id)
    category_id = create_resp.json()["id"]

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.patch(f"/categories/{category_id}", json={"name": "Hacked"}, headers=outsider_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Category not found"


async def test_patch_group_category_rename_to_duplicate_returns_409(client):
    """Renaming a group category to an existing group category name returns 409."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_category(client, admin_headers, name="Food", kind="expense", group_id=group_id)
    create_resp = await _create_category(client, admin_headers, name="Test Transport", kind="expense", group_id=group_id)
    category_id = create_resp.json()["id"]

    resp = await client.patch(f"/categories/{category_id}", json={"name": "Food"}, headers=admin_headers)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]

    # Verify the category was not mutated
    get_resp = await client.get(f"/categories/{category_id}", headers=admin_headers)
    assert get_resp.json()["name"] == "Test Transport"


# --- Group categories: DELETE /categories ---


async def test_delete_group_category_as_admin(client):
    """Admin can delete a group category."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_category(client, admin_headers, name="ToDelete", group_id=group_id)
    category_id = create_resp.json()["id"]

    resp = await client.delete(f"/categories/{category_id}", headers=admin_headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/categories/{category_id}", headers=admin_headers)
    assert get_resp.status_code == 404


async def test_delete_group_category_as_non_admin_returns_403(client):
    """Non-admin member cannot delete a group category."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_category(client, admin_headers, name="Shared", group_id=group_id)
    category_id = create_resp.json()["id"]

    resp = await client.delete(f"/categories/{category_id}", headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"


async def test_delete_group_category_non_member_returns_404(client):
    """Non-member cannot see or delete a group category."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_category(client, admin_headers, name="Shared", group_id=group_id)
    category_id = create_resp.json()["id"]

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.delete(f"/categories/{category_id}", headers=outsider_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Category not found"


async def test_delete_category_referenced_by_transaction_returns_409(client):
    """Deleting a category that has transactions referencing it returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    # Set up a category, account, and a transaction referencing the category
    cat_resp = await _create_category(client, headers, name="Test Deletable")
    category_id = cat_resp.json()["id"]

    acct_resp = await client.post("/accounts", json={
        "account_kind": "asset", "account_type": "checking", "name": "Chequing", "currency": "CAD",
    }, headers=headers)
    account_id = acct_resp.json()["id"]

    await client.post("/transactions", json={
        "account_id": account_id,
        "category_id": category_id,
        "dt": "2026-03-15",
        "amount": -5000,
        "currency": "CAD",
    }, headers=headers)

    resp = await client.delete(f"/categories/{category_id}", headers=headers)

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Category is referenced by existing transactions"
