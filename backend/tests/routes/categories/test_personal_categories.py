from tests.routes.categories._helpers import (
    CATEGORY_PAYLOAD,
    NONEXISTENT_ID,
    _create_category,
    _create_second_user,
)
from tests.routes.support import _create_user, _get_auth_header

# --- GET /categories ---


async def test_list_categories_returns_seeded_defaults(client):
    """New user sees global system categories."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/categories", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) > 0
    names = {c["name"] for c in data}
    assert "Groceries" in names
    assert "Salary" in names
    assert "Balance Adjustment" in names
    assert "Transfer" in names
    assert "Debt Payment" in names
    assert "Fuel" in names
    assert "Miscellaneous" in names
    assert "Capital Gains" in names
    assert {
        "Advertising & Marketing",
        "Business Expenses",
        "Business Insurance",
        "Business Meals",
        "Business Taxes",
        "Business Travel",
        "Condo Maintenance",
        "Dental",
        "Digital News",
        "Electricity",
        "Electronics",
        "Equipment",
        "Financial Fees",
        "Propane/LNG",
        "HOA Fees",
        "Home Improvement",
        "Home Phone",
        "Home Repairs",
        "Hobby",
        "Income Taxes",
        "Internet",
        "Legal Fees",
        "Phone Plan",
        "Office Supplies",
        "Parking",
        "Payroll Taxes",
        "Medical",
        "Medicine",
        "Print News",
        "Professional Services",
        "Property Taxes",
        "Rent",
        "Ride Hailing",
        "Sales Taxes",
        "Software",
        "Taxis",
        "Tolls",
        "Water",
    } <= names
    assert {"Utilities", "Taxes"}.isdisjoint(names)
    assert "Gas" not in names
    assert "Capital Gains/Losses" not in names
    assert "Pharmacy" not in names

    by_name = {c["name"]: c for c in data}
    assert by_name["Groceries"]["icon"] == "🛒"
    assert by_name["Electricity"]["kind"] == "expense"
    assert by_name["Income Taxes"]["kind"] == "expense"
    assert by_name["Advertising & Marketing"]["is_system"] is True
    assert by_name["Miscellaneous"]["kind"] == "expense"
    assert by_name["Debt Payment"]["kind"] == "expense"
    assert by_name["Debt Payment"]["is_system"] is True
    assert by_name["Vehicle Maintenance"]["is_system"] is True
    assert by_name["Balance Adjustment"]["kind"] == "transfer"
    assert by_name["Balance Adjustment"]["is_system"] is True
    assert by_name["Credit Card Payment"]["kind"] == "transfer"
    assert by_name["Credit Card Payment"]["is_system"] is True
    assert by_name["Transfer"]["is_system"] is True
    assert by_name["Groceries"]["owner_id"] is None


async def test_list_categories_returns_user_categories(client):
    """User sees their own categories and not another user's."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    # Count seeded categories, then add a custom one
    seeded_resp = await client.get("/categories", headers=headers)
    seeded_count = len(seeded_resp.json())

    await _create_category(client, headers, name="My Custom")

    # Second user creates a category that should not appear
    other_headers = _get_auth_header(await _create_second_user(client))
    await _create_category(client, other_headers, name="Other Expense")

    resp = await client.get("/categories", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == seeded_count + 1
    names = {c["name"] for c in data}
    assert "My Custom" in names
    assert "Other Expense" not in names



async def test_list_categories_without_auth_returns_401(client):
    """GET /categories without an Authorization header returns 401."""
    resp = await client.get("/categories")
    assert resp.status_code == 401


# --- GET /categories/{category_id} ---


async def test_get_category_returns_category(client):
    """Valid category ID returns the category with all fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_category(client, headers)
    category_id = create_resp.json()["id"]

    resp = await client.get(f"/categories/{category_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Custom Test Category"
    assert data["kind"] == "expense"
    assert data["group_id"] is None


async def test_get_category_not_found_returns_404(client):
    """Non-existent category ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/categories/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Category not found"


async def test_get_category_other_user_returns_404(client):
    """Accessing another user's category returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_category(client, headers)
    category_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.get(f"/categories/{category_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_get_category_without_auth_returns_401(client):
    """GET /categories/{id} without an Authorization header returns 401."""
    resp = await client.get(f"/categories/{NONEXISTENT_ID}")
    assert resp.status_code == 401


# --- POST /categories ---


async def test_create_category_returns_201(client):
    """Valid payload creates a category with correct fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_category(client, headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Custom Test Category"
    assert data["kind"] == "expense"
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_create_category_duplicate_name_returns_409(client):
    """Same name for the same user returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_category(client, headers, name="Duplicate Test", kind="expense")
    resp = await _create_category(client, headers, name="Duplicate Test", kind="expense")

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_create_category_duplicate_name_case_insensitive_returns_409(client):
    """Same name with different casing for the same user returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_category(client, headers, name="Duplicate Test", kind="expense")
    resp = await _create_category(client, headers, name="duplicate test", kind="expense")

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_create_category_differing_only_in_surrounding_spaces_returns_409(client):
    """A name is stored trimmed, so spaces around it cannot make a second category."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_category(client, headers, name="Duplicate Test", kind="expense")
    resp = await _create_category(client, headers, name="  Duplicate Test  ", kind="expense")

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_create_category_stores_its_name_without_surrounding_spaces(client):
    """Trimming happens on the way in, so the stored name is what every comparison reads."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_category(client, headers, name="  Dining Out  ", kind="expense")

    assert resp.status_code == 201
    assert resp.json()["name"] == "Dining Out"


async def test_create_category_named_only_spaces_is_refused(client):
    """Nothing is left after trimming, so it is refused rather than stored empty."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_category(client, headers, name="   ", kind="expense")

    assert resp.status_code == 422


async def test_create_category_same_name_different_kind_returns_409(client):
    """Same name with a different kind is still a duplicate."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp1 = await _create_category(client, headers, name="Misc", kind="expense")
    resp2 = await _create_category(client, headers, name="Misc", kind="income")

    assert resp1.status_code == 201
    assert resp2.status_code == 409


async def test_create_category_same_name_as_system_returns_409(client):
    """Custom categories cannot reuse system category names, regardless of kind or casing."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_category(client, headers, name="transfer", kind="expense")

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_create_category_same_name_for_different_users_returns_201(client):
    """Custom category names are unique per user, not globally."""
    headers = _get_auth_header(await _create_user(client))
    other_headers = _get_auth_header(await _create_second_user(client))

    resp1 = await _create_category(client, headers, name="Test", kind="expense")
    resp2 = await _create_category(client, other_headers, name="Test", kind="expense")

    assert resp1.status_code == 201
    assert resp2.status_code == 201
    assert resp1.json()["id"] != resp2.json()["id"]


async def test_create_category_invalid_kind_returns_422(client):
    """Invalid kind returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_category(client, headers, kind="not_a_real_kind")

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid category kind"


async def test_create_category_empty_name_returns_422(client):
    """Empty name returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_category(client, headers, name="")

    assert resp.status_code == 422


async def test_create_category_without_auth_returns_401(client):
    """POST /categories without an Authorization header returns 401."""
    resp = await client.post("/categories", json=CATEGORY_PAYLOAD)
    assert resp.status_code == 401


# --- PATCH /categories/{category_id} ---


async def test_patch_category_updates_name(client):
    """PATCH updates name and returns the updated category."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_category(client, headers)
    category_id = create_resp.json()["id"]

    resp = await client.patch(f"/categories/{category_id}", json={"name": "Renamed"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"


async def test_patch_category_empty_body_returns_unchanged(client):
    """PATCH with empty body returns 200 with no changes."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_category(client, headers)
    category_id = create_resp.json()["id"]

    before = await client.get(f"/categories/{category_id}", headers=headers)
    resp = await client.patch(f"/categories/{category_id}", json={}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == before.json()


async def test_patch_category_not_found_returns_404(client):
    """PATCH non-existent category returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(f"/categories/{NONEXISTENT_ID}", json={"name": "X"}, headers=headers)

    assert resp.status_code == 404


async def test_patch_category_other_user_returns_404(client):
    """PATCH on another user's category returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_category(client, headers)
    category_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.patch(f"/categories/{category_id}", json={"name": "Hacked"}, headers=other_headers)

    assert resp.status_code == 404


async def test_patch_category_rename_to_duplicate_returns_409(client):
    """Renaming a category to an existing name returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_category(client, headers, name="Alpha Unique", kind="expense")
    create_resp = await _create_category(client, headers, name="Beta Unique", kind="expense")
    category_id = create_resp.json()["id"]

    resp = await client.patch(f"/categories/{category_id}", json={"name": "Alpha Unique"}, headers=headers)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]

    # Verify the category was not mutated
    get_resp = await client.get(f"/categories/{category_id}", headers=headers)
    assert get_resp.json()["name"] == "Beta Unique"


async def test_patch_category_rename_to_system_name_returns_409(client):
    """Renaming a custom category to a system category name returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_category(client, headers, name="Custom Transfer")
    category_id = create_resp.json()["id"]

    resp = await client.patch(f"/categories/{category_id}", json={"name": "transfer"}, headers=headers)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]

    get_resp = await client.get(f"/categories/{category_id}", headers=headers)
    assert get_resp.json()["name"] == "Custom Transfer"


async def test_patch_system_category_returns_403(client):
    """System categories cannot be modified."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    categories_resp = await client.get("/categories", headers=headers)
    category_id = next(c["id"] for c in categories_resp.json() if c["name"] == "Transfer")

    resp = await client.patch(f"/categories/{category_id}", json={"name": "Moved Money"}, headers=headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "System categories cannot be modified"


async def test_patch_category_without_auth_returns_401(client):
    """PATCH /categories/{id} without an Authorization header returns 401."""
    resp = await client.patch(f"/categories/{NONEXISTENT_ID}", json={"name": "X"})
    assert resp.status_code == 401


# --- DELETE /categories/{category_id} ---


async def test_delete_category_returns_204(client):
    """DELETE removes the category and returns 204."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_category(client, headers)
    category_id = create_resp.json()["id"]

    resp = await client.delete(f"/categories/{category_id}", headers=headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/categories/{category_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_category_not_found_returns_404(client):
    """DELETE non-existent category returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(f"/categories/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404


async def test_delete_category_other_user_returns_404(client):
    """Deleting another user's category returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_category(client, headers)
    category_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.delete(f"/categories/{category_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_delete_category_without_auth_returns_401(client):
    """DELETE /categories/{id} without an Authorization header returns 401."""
    resp = await client.delete(f"/categories/{NONEXISTENT_ID}")
    assert resp.status_code == 401


async def test_delete_system_category_returns_403(client):
    """System categories cannot be deleted."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    categories_resp = await client.get("/categories", headers=headers)
    category_id = next(c["id"] for c in categories_resp.json() if c["name"] == "Credit Card Payment")

    resp = await client.delete(f"/categories/{category_id}", headers=headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "System categories cannot be deleted"


async def test_double_delete_returns_404_on_second(client):
    """Deleting the same category twice returns 204 then 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_category(client, headers)
    category_id = create_resp.json()["id"]

    resp1 = await client.delete(f"/categories/{category_id}", headers=headers)
    resp2 = await client.delete(f"/categories/{category_id}", headers=headers)

    assert resp1.status_code == 204
    assert resp2.status_code == 404
