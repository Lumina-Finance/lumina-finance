from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.support import _create_account, _create_user, _get_auth_header

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"


async def _seed_usd_currency() -> None:
    """Insert USD for currency mismatch tests."""
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()


async def _create_second_user(client):
    """Sign up a second test user.

    Args:
        client: The async test client.

    Returns:
        The HTTP response from the signup endpoint.
    """
    return await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "SecurePassword123!",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })


async def _create_tax_advantaged_category(client, headers, **overrides):
    """Create a tax-advantaged category.

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The HTTP response from the API.
    """
    payload = {
        "name": "TFSA",
        "tax_treatment": "tax_free",
        "currency": "CAD",
        **overrides,
    }
    return await client.post("/tax-advantaged-categories", json=payload, headers=headers)


async def _create_group(client, headers):
    """Create a group and return its ID.

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.

    Returns:
        The created group ID.
    """
    resp = await client.post("/groups", json={"name": "Household"}, headers=headers)
    assert resp.status_code == 201
    return resp.json()["id"]


async def test_create_personal_account_can_link_owned_tax_advantaged_category(client):
    """Personal account can link a personal tax-advantaged category owned by the same user."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    tax_advantaged_category_id = (await _create_tax_advantaged_category(client, headers)).json()["id"]

    resp = await _create_account(client, headers, tax_advantaged_category_id=tax_advantaged_category_id)

    assert resp.status_code == 201
    assert resp.json()["tax_advantaged_category_id"] == tax_advantaged_category_id


async def test_list_accounts_includes_tax_advantaged_category_id(client):
    """Account overviews include the linked tax-advantaged category id."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    tax_advantaged_category_id = (await _create_tax_advantaged_category(client, headers)).json()["id"]
    account_id = (await _create_account(client, headers, tax_advantaged_category_id=tax_advantaged_category_id)).json()["id"]

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == [
        {
            "id": account_id,
            "owner_id": signup_resp.json()["user"]["id"],
            "group_id": None,
            "account_kind": "asset",
            "account_type": "checking",
            "tax_advantaged_category_id": tax_advantaged_category_id,
            "name": "Main Chequing",
            "institution": None,
            "currency": "CAD",
            "current_balance": 0,
            "base_currency_current_balance": 0,
            "current_balance_fx_status": {"state": "none", "missing_pairs": []},
            "credit_limit": None,
            "is_archived": False,
            "closed_at": None,
        },
    ]


async def test_update_personal_account_can_link_and_unlink_owned_tax_advantaged_category(client):
    """Personal account owner can link and unlink an owned tax-advantaged category."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    tax_advantaged_category_id = (await _create_tax_advantaged_category(client, headers)).json()["id"]
    account_id = (await _create_account(client, headers)).json()["id"]

    link_resp = await client.patch(
        f"/accounts/{account_id}",
        json={"tax_advantaged_category_id": tax_advantaged_category_id},
        headers=headers,
    )
    unlink_resp = await client.patch(
        f"/accounts/{account_id}",
        json={"tax_advantaged_category_id": None},
        headers=headers,
    )

    assert link_resp.status_code == 200
    assert link_resp.json()["tax_advantaged_category_id"] == tax_advantaged_category_id
    assert unlink_resp.status_code == 200
    assert unlink_resp.json()["tax_advantaged_category_id"] is None


async def test_delete_linked_tax_advantaged_category_nulls_account_link(client):
    """Deleting a linked tax-advantaged category leaves the account and clears its FK."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    tax_advantaged_category_id = (await _create_tax_advantaged_category(client, headers)).json()["id"]
    account_id = (await _create_account(client, headers, tax_advantaged_category_id=tax_advantaged_category_id)).json()["id"]

    delete_resp = await client.delete(f"/tax-advantaged-categories/{tax_advantaged_category_id}", headers=headers)
    account_resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert delete_resp.status_code == 204
    assert account_resp.status_code == 200
    assert account_resp.json()["tax_advantaged_category_id"] is None


async def test_create_account_rejects_nonexistent_tax_advantaged_category_link(client):
    """Account creation rejects a missing tax-advantaged category id."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, tax_advantaged_category_id=NONEXISTENT_ID)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid tax-advantaged category"


async def test_create_account_rejects_tax_advantaged_category_link_for_liability_account(client):
    """Only asset accounts can link tax-advantaged categories."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    tax_advantaged_category_id = (await _create_tax_advantaged_category(client, headers)).json()["id"]

    resp = await _create_account(
        client,
        headers,
        account_kind="revolving",
        account_type="credit_card",
        tax_advantaged_category_id=tax_advantaged_category_id,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Tax-advantaged categories can only be linked to asset accounts"


async def test_create_account_rejects_tax_advantaged_category_currency_mismatch(client):
    """Account and linked tax-advantaged category must use the same currency."""
    await _seed_usd_currency()
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    usd_tax_advantaged_category_id = (await _create_tax_advantaged_category(client, headers, currency="USD")).json()["id"]

    resp = await _create_account(client, headers, tax_advantaged_category_id=usd_tax_advantaged_category_id)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Tax-advantaged category currency must match account currency"


async def test_create_personal_account_rejects_other_users_tax_advantaged_category(client):
    """Personal accounts can only link tax-advantaged categories owned by the account owner."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers = _get_auth_header(await _create_second_user(client))
    other_tax_advantaged_category_id = (await _create_tax_advantaged_category(client, other_headers)).json()["id"]

    resp = await _create_account(client, headers, tax_advantaged_category_id=other_tax_advantaged_category_id)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid tax-advantaged category"


async def test_create_personal_account_rejects_group_scoped_tax_advantaged_category(client):
    """Personal accounts cannot link tax-advantaged categories scoped to a group."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    group_id = await _create_group(client, headers)
    group_tax_advantaged_category_id = (await _create_tax_advantaged_category(client, headers, group_id=group_id)).json()["id"]

    resp = await _create_account(client, headers, tax_advantaged_category_id=group_tax_advantaged_category_id)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid tax-advantaged category"


async def test_create_group_account_can_link_same_group_tax_advantaged_category(client):
    """Group account can link a same-group tax-advantaged category at creation time."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    group_id = await _create_group(client, headers)
    tax_advantaged_category_id = (await _create_tax_advantaged_category(client, headers, group_id=group_id)).json()["id"]

    resp = await _create_account(client, headers, group_id=group_id, tax_advantaged_category_id=tax_advantaged_category_id)

    assert resp.status_code == 201
    assert resp.json()["tax_advantaged_category_id"] == tax_advantaged_category_id


async def test_group_account_rejects_personal_tax_advantaged_category(client):
    """Group accounts cannot link personal tax-advantaged categorys."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    group_id = await _create_group(client, headers)
    personal_tax_advantaged_category_id = (await _create_tax_advantaged_category(client, headers)).json()["id"]
    account_id = (await _create_account(client, headers, group_id=group_id)).json()["id"]

    resp = await client.patch(
        f"/accounts/{account_id}",
        json={"tax_advantaged_category_id": personal_tax_advantaged_category_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid tax-advantaged category"


async def test_group_account_link_requires_acting_tax_advantaged_category_owner_admin(client):
    """Group account tax-advantaged categories can only be linked by the category owner when they are an account admin."""
    owner_resp = await _create_user(client)
    owner_headers = _get_auth_header(owner_resp)
    group_id = await _create_group(client, owner_headers)

    member_resp = await _create_second_user(client)
    member_headers = _get_auth_header(member_resp)
    member_user_id = member_resp.json()["user"]["id"]
    add_member = await client.post(f"/groups/{group_id}/members", json={"user_id": member_user_id}, headers=owner_headers)
    promote = await client.patch(
        f"/groups/{group_id}/members/{member_user_id}",
        json={"is_admin": True},
        headers=owner_headers,
    )
    assert add_member.status_code == 201
    assert promote.status_code == 200

    member_tax_advantaged_category_id = (await _create_tax_advantaged_category(client, member_headers, group_id=group_id)).json()["id"]
    account_id = (await _create_account(client, owner_headers, group_id=group_id)).json()["id"]

    owner_link_resp = await client.patch(
        f"/accounts/{account_id}",
        json={"tax_advantaged_category_id": member_tax_advantaged_category_id},
        headers=owner_headers,
    )
    member_link_resp = await client.patch(
        f"/accounts/{account_id}",
        json={"tax_advantaged_category_id": member_tax_advantaged_category_id},
        headers=member_headers,
    )

    assert owner_link_resp.status_code == 422
    assert owner_link_resp.json()["detail"] == "Only the category owner can link this tax-advantaged category to a group account"
    assert member_link_resp.status_code == 200
    assert member_link_resp.json()["tax_advantaged_category_id"] == member_tax_advantaged_category_id


async def test_group_account_rejects_tax_advantaged_category_owner_without_account_admin_access(client):
    """A group category owner still needs account admin access to link their tax-advantaged category"""
    owner_resp = await _create_user(client)
    owner_headers = _get_auth_header(owner_resp)
    group_id = await _create_group(client, owner_headers)

    member_resp = await _create_second_user(client)
    member_headers = _get_auth_header(member_resp)
    member_user_id = member_resp.json()["user"]["id"]
    add_member = await client.post(f"/groups/{group_id}/members", json={"user_id": member_user_id}, headers=owner_headers)
    assert add_member.status_code == 201

    member_tax_advantaged_category_id = (await _create_tax_advantaged_category(client, member_headers, group_id=group_id)).json()["id"]
    account_id = (await _create_account(client, owner_headers, group_id=group_id)).json()["id"]

    resp = await client.patch(
        f"/accounts/{account_id}",
        json={"tax_advantaged_category_id": member_tax_advantaged_category_id},
        headers=member_headers,
    )
    account_resp = await client.get(f"/accounts/{account_id}", headers=owner_headers)

    assert resp.status_code == 404
    assert account_resp.json()["tax_advantaged_category_id"] is None


async def test_group_account_rejects_tax_advantaged_category_from_different_group(client):
    """Group account can only link tax-advantaged categories scoped to the same group."""
    owner_resp = await _create_user(client)
    owner_headers = _get_auth_header(owner_resp)
    first_group_id = await _create_group(client, owner_headers)
    second_group_id = (await client.post("/groups", json={"name": "Other Household"}, headers=owner_headers)).json()["id"]
    other_group_tax_advantaged_category_id = (
        await _create_tax_advantaged_category(client, owner_headers, group_id=second_group_id)
    ).json()["id"]
    account_id = (await _create_account(client, owner_headers, group_id=first_group_id)).json()["id"]

    resp = await client.patch(
        f"/accounts/{account_id}",
        json={"tax_advantaged_category_id": other_group_tax_advantaged_category_id},
        headers=owner_headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid tax-advantaged category"
