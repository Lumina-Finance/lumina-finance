from app.models.base import InstitutionStatus
from app.models.institution import Institution
from tests.conftest import TestSession
from tests.routes.conftest import _create_user, _get_auth_header

# --- Helpers ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"

ACCOUNT_PAYLOAD = {
    "account_type": "checking",
    "tax_treatment": "taxable",
    "name": "Main Chequing",
    "currency": "CAD",
}


async def _seed_institution():
    """Insert a canonical institution for FK tests.

    Inserts via raw session (not the API) because institutions are seeded data,
    not user-created resources.

    Returns:
        The persisted Institution ORM instance.
    """
    async with TestSession() as session:
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
    payload = {**ACCOUNT_PAYLOAD, **overrides}
    return await client.post("/accounts", json=payload, headers=headers)


async def _create_second_user(client):
    """Sign up a second user for ownership-isolation tests.

    Args:
        client: The async test client.

    Returns:
        The HTTP response from the signup endpoint.
    """
    return await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "securepassword123",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })


# --- GET /accounts ---


async def test_list_accounts_returns_empty_list(client):
    """User with no accounts gets an empty list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_accounts_returns_user_accounts(client):
    """User sees only their own accounts."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_account(client, headers, name="Account A")
    await _create_account(client, headers, name="Account B")

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    names = {a["name"] for a in data}
    assert names == {"Account A", "Account B"}


async def test_list_accounts_without_auth_returns_401(client):
    """GET /accounts without an Authorization header returns 401."""
    resp = await client.get("/accounts")
    assert resp.status_code == 401


# --- GET /accounts/{account_id} ---


async def test_get_account_returns_account(client):
    """Valid account ID returns the account with all fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == ACCOUNT_PAYLOAD["name"]
    assert data["account_type"] == ACCOUNT_PAYLOAD["account_type"]
    assert data["tax_treatment"] == ACCOUNT_PAYLOAD["tax_treatment"]
    assert data["currency"] == ACCOUNT_PAYLOAD["currency"]
    assert data["owner_id"] is not None
    assert data["household_id"] is None
    assert data["is_hidden"] is False
    assert data["closed_at"] is None


async def test_get_account_not_found_returns_404(client):
    """Non-existent account ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/accounts/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Account not found"


async def test_get_account_other_user_returns_404(client):
    """Accessing another user's account returns 404, not 403."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.get(f"/accounts/{account_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_get_account_without_auth_returns_401(client):
    """GET /accounts/{id} without an Authorization header returns 401."""
    resp = await client.get(f"/accounts/{NONEXISTENT_ID}")
    assert resp.status_code == 401


# --- POST /accounts ---


async def test_create_account_returns_201(client):
    """Valid payload creates an account with correct fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == ACCOUNT_PAYLOAD["name"]
    assert data["account_type"] == ACCOUNT_PAYLOAD["account_type"]
    assert data["tax_treatment"] == ACCOUNT_PAYLOAD["tax_treatment"]
    assert data["currency"] == ACCOUNT_PAYLOAD["currency"]
    assert data["is_hidden"] is False
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_create_account_with_institution(client):
    """Account can be linked to an existing institution."""
    inst = await _seed_institution()
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, institution_id=str(inst.id))

    assert resp.status_code == 201
    assert resp.json()["institution_id"] == str(inst.id)


async def test_create_account_invalid_account_type_returns_422(client):
    """Invalid account_type returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, account_type="not_a_real_type")

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid account type"


async def test_create_account_invalid_tax_treatment_returns_422(client):
    """Invalid tax_treatment returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, tax_treatment="not_a_real_treatment")

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid tax treatment"


async def test_create_account_invalid_currency_returns_422(client):
    """Non-existent currency code returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, currency="XXX")

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid currency code"


async def test_create_account_invalid_institution_returns_422(client):
    """Non-existent institution ID returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, institution_id=str(NONEXISTENT_ID))

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Institution not found"


async def test_create_account_empty_name_returns_422(client):
    """Empty name returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, name="")

    assert resp.status_code == 422


async def test_create_account_missing_field_returns_422(client):
    """Missing a required field returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    payload = {"name": "Test", "account_type": "checking"}  # missing currency
    resp = await client.post("/accounts", json=payload, headers=headers)

    assert resp.status_code == 422


async def test_create_account_without_auth_returns_401(client):
    """POST /accounts without an Authorization header returns 401."""
    resp = await client.post("/accounts", json=ACCOUNT_PAYLOAD)
    assert resp.status_code == 401


async def test_create_account_null_institution_accepted(client):
    """Null institution_id is valid — cash or unlinked accounts have no institution."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, institution_id=None)

    assert resp.status_code == 201
    assert resp.json()["institution_id"] is None


async def test_create_account_with_all_optional_fields(client):
    """Account created with all optional fields set returns correct values."""
    inst = await _seed_institution()
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(
        client, headers,
        institution_id=str(inst.id),
        lifetime_contribution_limit=500000,
        is_hidden=True,
        tax_treatment="tax_free",
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["institution_id"] == str(inst.id)
    assert data["lifetime_contribution_limit"] == 500000
    assert data["is_hidden"] is True
    assert data["tax_treatment"] == "tax_free"


async def test_create_account_extra_fields_ignored(client):
    """Extra fields like owner_id in the body cannot hijack ownership."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    payload = {**ACCOUNT_PAYLOAD, "owner_id": NONEXISTENT_ID, "household_id": NONEXISTENT_ID}
    resp = await client.post("/accounts", json=payload, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["owner_id"] == user_id
    assert data["household_id"] is None


async def test_create_account_duplicate_names_allowed(client):
    """Multiple accounts with the same name are allowed."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp1 = await _create_account(client, headers, name="Savings")
    resp2 = await _create_account(client, headers, name="Savings")

    assert resp1.status_code == 201
    assert resp2.status_code == 201
    assert resp1.json()["id"] != resp2.json()["id"]


# --- PATCH /accounts/{account_id} ---


async def test_patch_account_updates_name(client):
    """PATCH updates name and returns the updated account."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(f"/accounts/{account_id}", json={"name": "Renamed"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"


async def test_patch_account_updates_is_hidden(client):
    """PATCH toggles is_hidden."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(f"/accounts/{account_id}", json={"is_hidden": True}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["is_hidden"] is True


async def test_patch_account_sets_closed_at(client):
    """PATCH can close an account by setting closed_at."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/accounts/{account_id}",
        json={"closed_at": "2026-03-01T00:00:00Z"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["closed_at"] is not None


async def test_patch_account_empty_body_returns_unchanged(client):
    """PATCH with empty body returns 200 with no changes."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    before = await client.get(f"/accounts/{account_id}", headers=headers)
    resp = await client.patch(f"/accounts/{account_id}", json={}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == before.json()


async def test_patch_account_invalid_tax_treatment_returns_422(client):
    """PATCH with invalid tax_treatment returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/accounts/{account_id}",
        json={"tax_treatment": "not_a_real_treatment"},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid tax treatment"


async def test_patch_account_not_found_returns_404(client):
    """PATCH non-existent account returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(f"/accounts/{NONEXISTENT_ID}", json={"name": "X"}, headers=headers)

    assert resp.status_code == 404


async def test_patch_account_without_auth_returns_401(client):
    """PATCH /accounts/{id} without an Authorization header returns 401."""
    resp = await client.patch(f"/accounts/{NONEXISTENT_ID}", json={"name": "X"})
    assert resp.status_code == 401


async def test_patch_account_clears_institution(client):
    """PATCH with institution_id=null detaches the account from its institution."""
    inst = await _seed_institution()
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers, institution_id=str(inst.id))
    account_id = create_resp.json()["id"]

    resp = await client.patch(f"/accounts/{account_id}", json={"institution_id": None}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["institution_id"] is None


async def test_patch_account_clears_closed_at(client):
    """PATCH with closed_at=null reopens a closed account."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    # Close it
    await client.patch(f"/accounts/{account_id}", json={"closed_at": "2026-03-01T00:00:00Z"}, headers=headers)
    # Reopen it
    resp = await client.patch(f"/accounts/{account_id}", json={"closed_at": None}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["closed_at"] is None


async def test_patch_account_invalid_institution_returns_422(client):
    """PATCH with non-existent institution_id returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/accounts/{account_id}",
        json={"institution_id": NONEXISTENT_ID},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Institution not found"


async def test_patch_account_immutable_fields_ignored(client):
    """PATCH cannot change account_type or currency — extra fields are ignored."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/accounts/{account_id}",
        json={"account_type": "savings", "currency": "USD"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["account_type"] == ACCOUNT_PAYLOAD["account_type"]
    assert resp.json()["currency"] == ACCOUNT_PAYLOAD["currency"]


# --- DELETE /accounts/{account_id} ---


async def test_delete_account_returns_204(client):
    """DELETE removes the account and returns 204."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.delete(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 204

    # Verify account is gone
    get_resp = await client.get(f"/accounts/{account_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_account_not_found_returns_404(client):
    """DELETE non-existent account returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(f"/accounts/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404


async def test_delete_account_other_user_returns_404(client):
    """Deleting another user's account returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.delete(f"/accounts/{account_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_delete_account_without_auth_returns_401(client):
    """DELETE /accounts/{id} without an Authorization header returns 401."""
    resp = await client.delete(f"/accounts/{NONEXISTENT_ID}")
    assert resp.status_code == 401


async def test_double_delete_returns_404_on_second(client):
    """Deleting the same account twice returns 204 then 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp1 = await client.delete(f"/accounts/{account_id}", headers=headers)
    resp2 = await client.delete(f"/accounts/{account_id}", headers=headers)

    assert resp1.status_code == 204
    assert resp2.status_code == 404


# --- Ownership isolation ---


async def test_other_user_cannot_patch_account(client):
    """PATCH on another user's account returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.patch(f"/accounts/{account_id}", json={"name": "Hacked"}, headers=other_headers)

    assert resp.status_code == 404


async def test_list_accounts_excludes_other_users_accounts(client):
    """User A's accounts do not appear in User B's list."""
    signup_resp = await _create_user(client)
    headers_a = _get_auth_header(signup_resp)
    await _create_account(client, headers_a, name="User A Account")

    headers_b = _get_auth_header(await _create_second_user(client))
    await _create_account(client, headers_b, name="User B Account")

    # User B should only see their own account
    resp = await client.get("/accounts", headers=headers_b)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "User B Account"
