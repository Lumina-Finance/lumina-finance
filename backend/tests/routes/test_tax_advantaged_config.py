from tests.routes.conftest import _create_account, _create_user, _get_auth_header

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"


# --- Helpers ---


async def _create_tax_free_account(client, headers, **overrides):
    """Create a tax-free account. Defaults to asset/savings so configs are meaningful."""
    defaults = {
        "account_kind": "asset",
        "account_type": "savings",
        "tax_treatment": "tax_free",
        "name": "TFSA",
    }
    defaults.update(overrides)
    return await _create_account(client, headers, **defaults)


async def _create_second_user(client):
    """Sign up a second user for ownership-isolation tests."""
    return await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "securepassword123",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })


# --- GET /accounts/{id}/tax-advantaged-configs ---


async def test_list_configs_returns_empty_list(client):
    """Account with no configs returns an empty list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.get(f"/accounts/{account_id}/tax-advantaged-configs", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_configs_returns_configs_ordered_by_year(client):
    """List endpoint returns all configs for the account, ordered by year ascending."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    # Insert in non-sorted order to verify the endpoint orders them
    for year, limit in ((2027, 800_000), (2025, 600_000), (2026, 700_000)):
        post_resp = await client.post(
            f"/accounts/{account_id}/tax-advantaged-configs",
            json={"year": year, "contribution_limit": limit},
            headers=headers,
        )
        assert post_resp.status_code == 201

    resp = await client.get(f"/accounts/{account_id}/tax-advantaged-configs", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert [row["year"] for row in data] == [2025, 2026, 2027]
    assert [row["contribution_limit"] for row in data] == [600_000, 700_000, 800_000]


async def test_list_configs_scoped_to_account(client):
    """Configs from a different account don't leak into the listing."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_a = (await _create_tax_free_account(client, headers, name="A")).json()["id"]
    account_b = (await _create_tax_free_account(client, headers, name="B")).json()["id"]

    await client.post(
        f"/accounts/{account_a}/tax-advantaged-configs",
        json={"year": 2026, "contribution_limit": 700_000},
        headers=headers,
    )

    resp = await client.get(f"/accounts/{account_b}/tax-advantaged-configs", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_configs_other_user_returns_404(client):
    """Another user cannot list a private account's configs."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.get(f"/accounts/{account_id}/tax-advantaged-configs", headers=other_headers)

    assert resp.status_code == 404


async def test_list_configs_nonexistent_account_returns_404(client):
    """Listing configs for a nonexistent account returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/accounts/{NONEXISTENT_ID}/tax-advantaged-configs", headers=headers)

    assert resp.status_code == 404


async def test_list_configs_without_auth_returns_401(client):
    """GET without an Authorization header returns 401."""
    resp = await client.get(f"/accounts/{NONEXISTENT_ID}/tax-advantaged-configs")
    assert resp.status_code == 401


# --- POST /accounts/{id}/tax-advantaged-configs ---


async def test_create_config_returns_201_with_full_shape(client):
    """Happy path: creates a config row and returns all fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.post(
        f"/accounts/{account_id}/tax-advantaged-configs",
        json={"year": 2026, "contribution_limit": 700_000, "withdrawal_limit": 200_000},
        headers=headers,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["account_id"] == account_id
    assert data["year"] == 2026
    assert data["contribution_limit"] == 700_000
    assert data["withdrawal_limit"] == 200_000


async def test_create_config_withdrawal_limit_defaults_null(client):
    """Omitting withdrawal_limit serializes the field as null."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.post(
        f"/accounts/{account_id}/tax-advantaged-configs",
        json={"year": 2026, "contribution_limit": 700_000},
        headers=headers,
    )

    assert resp.status_code == 201
    assert resp.json()["withdrawal_limit"] is None


async def test_create_config_on_taxable_account_returns_422(client):
    """Taxable accounts cannot have tax-advantaged configs."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)  # defaults to taxable
    account_id = create_resp.json()["id"]

    resp = await client.post(
        f"/accounts/{account_id}/tax-advantaged-configs",
        json={"year": 2026, "contribution_limit": 700_000},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Tax-advantaged configs cannot be set on taxable accounts"


async def test_create_config_duplicate_year_returns_409(client):
    """Posting a second config for the same year returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    first = await client.post(
        f"/accounts/{account_id}/tax-advantaged-configs",
        json={"year": 2026, "contribution_limit": 700_000},
        headers=headers,
    )
    assert first.status_code == 201

    dup = await client.post(
        f"/accounts/{account_id}/tax-advantaged-configs",
        json={"year": 2026, "contribution_limit": 800_000},
        headers=headers,
    )

    assert dup.status_code == 409
    assert dup.json()["detail"] == "A config for this year already exists"


async def test_create_config_negative_contribution_limit_returns_422(client):
    """Pydantic rejects negative contribution limits."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.post(
        f"/accounts/{account_id}/tax-advantaged-configs",
        json={"year": 2026, "contribution_limit": -1},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_create_config_year_out_of_range_returns_422(client):
    """Pydantic rejects year < 1900 or > 2100."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.post(
        f"/accounts/{account_id}/tax-advantaged-configs",
        json={"year": 1899, "contribution_limit": 700_000},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_create_config_other_user_returns_404(client):
    """Another user cannot create a config on someone else's account."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.post(
        f"/accounts/{account_id}/tax-advantaged-configs",
        json={"year": 2026, "contribution_limit": 700_000},
        headers=other_headers,
    )

    assert resp.status_code == 404


async def test_create_config_nonexistent_account_returns_404(client):
    """Posting to a nonexistent account returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post(
        f"/accounts/{NONEXISTENT_ID}/tax-advantaged-configs",
        json={"year": 2026, "contribution_limit": 700_000},
        headers=headers,
    )

    assert resp.status_code == 404


async def test_create_config_without_auth_returns_401(client):
    """POST without an Authorization header returns 401."""
    resp = await client.post(
        f"/accounts/{NONEXISTENT_ID}/tax-advantaged-configs",
        json={"year": 2026, "contribution_limit": 700_000},
    )
    assert resp.status_code == 401


# --- PATCH /accounts/{id}/tax-advantaged-configs/{year} ---


async def test_patch_config_updates_contribution_limit(client):
    """PATCH can update just the contribution_limit."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    await client.post(
        f"/accounts/{account_id}/tax-advantaged-configs",
        json={"year": 2026, "contribution_limit": 700_000, "withdrawal_limit": 200_000},
        headers=headers,
    )

    resp = await client.patch(
        f"/accounts/{account_id}/tax-advantaged-configs/2026",
        json={"contribution_limit": 750_000},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["contribution_limit"] == 750_000
    assert data["withdrawal_limit"] == 200_000  # untouched


async def test_patch_config_clears_withdrawal_limit(client):
    """Explicit null on withdrawal_limit clears it (nullable column)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    await client.post(
        f"/accounts/{account_id}/tax-advantaged-configs",
        json={"year": 2026, "contribution_limit": 700_000, "withdrawal_limit": 200_000},
        headers=headers,
    )

    resp = await client.patch(
        f"/accounts/{account_id}/tax-advantaged-configs/2026",
        json={"withdrawal_limit": None},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["withdrawal_limit"] is None


async def test_patch_config_updates_both_fields(client):
    """PATCH can update both limits in one request."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    await client.post(
        f"/accounts/{account_id}/tax-advantaged-configs",
        json={"year": 2026, "contribution_limit": 700_000},
        headers=headers,
    )

    resp = await client.patch(
        f"/accounts/{account_id}/tax-advantaged-configs/2026",
        json={"contribution_limit": 750_000, "withdrawal_limit": 250_000},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["contribution_limit"] == 750_000
    assert data["withdrawal_limit"] == 250_000


async def test_patch_config_empty_body_returns_unchanged(client):
    """PATCH with empty body is a no-op and returns the existing row."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    await client.post(
        f"/accounts/{account_id}/tax-advantaged-configs",
        json={"year": 2026, "contribution_limit": 700_000, "withdrawal_limit": 200_000},
        headers=headers,
    )

    resp = await client.patch(
        f"/accounts/{account_id}/tax-advantaged-configs/2026",
        json={},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["contribution_limit"] == 700_000
    assert data["withdrawal_limit"] == 200_000


async def test_patch_config_explicit_null_contribution_limit_returns_422(client):
    """contribution_limit cannot be cleared via PATCH."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    await client.post(
        f"/accounts/{account_id}/tax-advantaged-configs",
        json={"year": 2026, "contribution_limit": 700_000},
        headers=headers,
    )

    resp = await client.patch(
        f"/accounts/{account_id}/tax-advantaged-configs/2026",
        json={"contribution_limit": None},
        headers=headers,
    )

    assert resp.status_code == 422
    assert "contribution_limit cannot be cleared" in resp.json()["detail"]


async def test_patch_config_nonexistent_year_returns_404(client):
    """PATCH on a year with no config row returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/accounts/{account_id}/tax-advantaged-configs/2026",
        json={"contribution_limit": 750_000},
        headers=headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Tax-advantaged config not found"


async def test_patch_config_other_user_returns_404(client):
    """Another user cannot patch a config on someone else's account."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    await client.post(
        f"/accounts/{account_id}/tax-advantaged-configs",
        json={"year": 2026, "contribution_limit": 700_000},
        headers=headers,
    )

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.patch(
        f"/accounts/{account_id}/tax-advantaged-configs/2026",
        json={"contribution_limit": 800_000},
        headers=other_headers,
    )

    assert resp.status_code == 404


async def test_patch_config_without_auth_returns_401(client):
    """PATCH without an Authorization header returns 401."""
    resp = await client.patch(
        f"/accounts/{NONEXISTENT_ID}/tax-advantaged-configs/2026",
        json={"contribution_limit": 700_000},
    )
    assert resp.status_code == 401


# --- DELETE /accounts/{id}/tax-advantaged-configs/{year} ---


async def test_delete_config_returns_204(client):
    """DELETE removes the config row and returns 204."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    await client.post(
        f"/accounts/{account_id}/tax-advantaged-configs",
        json={"year": 2026, "contribution_limit": 700_000},
        headers=headers,
    )

    resp = await client.delete(
        f"/accounts/{account_id}/tax-advantaged-configs/2026",
        headers=headers,
    )

    assert resp.status_code == 204

    # Confirm it's actually gone
    list_resp = await client.get(f"/accounts/{account_id}/tax-advantaged-configs", headers=headers)
    assert list_resp.json() == []


async def test_delete_config_nonexistent_year_returns_404(client):
    """DELETE on a year with no config row returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.delete(
        f"/accounts/{account_id}/tax-advantaged-configs/2026",
        headers=headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Tax-advantaged config not found"


async def test_delete_config_other_user_returns_404(client):
    """Another user cannot delete a config on someone else's account."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tax_free_account(client, headers)
    account_id = create_resp.json()["id"]

    await client.post(
        f"/accounts/{account_id}/tax-advantaged-configs",
        json={"year": 2026, "contribution_limit": 700_000},
        headers=headers,
    )

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.delete(
        f"/accounts/{account_id}/tax-advantaged-configs/2026",
        headers=other_headers,
    )

    assert resp.status_code == 404

    # Confirm the row still exists
    list_resp = await client.get(f"/accounts/{account_id}/tax-advantaged-configs", headers=headers)
    assert len(list_resp.json()) == 1


async def test_delete_config_without_auth_returns_401(client):
    """DELETE without an Authorization header returns 401."""
    resp = await client.delete(f"/accounts/{NONEXISTENT_ID}/tax-advantaged-configs/2026")
    assert resp.status_code == 401
