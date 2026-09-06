

from tests.routes.accounts._account_helpers import (
    NONEXISTENT_ID,
    _seed_institution,
)
from tests.routes.support import ACCOUNT_PAYLOAD, _create_account, _create_user, _get_auth_header

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
    assert data["currency"] == ACCOUNT_PAYLOAD["currency"]
    assert data["is_archived"] is False
    assert data["can_write"] is True
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_create_account_with_institution(client):
    """Account can be linked to an existing institution; response embeds the summary."""
    inst = await _seed_institution(logo_url="https://cdn.example.com/testbank.png")
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, institution_id=str(inst.id))

    assert resp.status_code == 201
    institution = resp.json()["institution"]
    assert institution is not None
    assert institution["id"] == str(inst.id)
    assert institution["name"] == inst.name
    assert institution["website"] == inst.website
    assert institution["logo_url"] == "https://cdn.example.com/testbank.png"


async def test_create_account_invalid_account_type_returns_422(client):
    """Invalid account_type returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, account_type="not_a_real_type")

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid account type"


async def test_create_account_invalid_account_kind_returns_422(client):
    """Invalid account_kind returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, account_kind="not_a_real_kind")

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid account kind"


async def test_create_account_kind_type_mismatch_returns_422(client):
    """Submitting kind=asset with a liability type (or vice versa) returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, account_kind="asset", account_type="credit_card")

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account kind does not match account type"


async def test_create_account_missing_kind_returns_422(client):
    """Pydantic rejects payloads missing the required account_kind field."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    payload = {k: v for k, v in ACCOUNT_PAYLOAD.items() if k != "account_kind"}
    resp = await client.post("/accounts", json=payload, headers=headers)

    assert resp.status_code == 422


async def test_create_liability_account_succeeds(client):
    """Creating a liability account (credit_card) with kind=liability is accepted and round-trips."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(
        client, headers, account_kind="revolving", account_type="credit_card", name="Visa Infinite",
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["account_kind"] == "revolving"
    assert data["account_type"] == "credit_card"


async def test_create_liability_with_credit_limit_succeeds(client):
    """Setting credit_limit on a liability account is accepted and round-trips."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(
        client, headers,
        account_kind="revolving", account_type="credit_card", name="Visa", credit_limit=500_000,
    )

    assert resp.status_code == 201
    assert resp.json()["credit_limit"] == 500_000


async def test_create_liability_without_credit_limit_defaults_null(client):
    """Liability accounts without credit_limit serialize the field as null."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(
        client, headers, account_kind="revolving", account_type="credit_card", name="Visa",
    )

    assert resp.status_code == 201
    assert resp.json()["credit_limit"] is None


async def test_create_asset_with_credit_limit_returns_422(client):
    """Setting credit_limit on an asset account is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, credit_limit=500_000)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "credit_limit is only valid on revolving-credit accounts"


async def test_update_liability_credit_limit_succeeds(client):
    """Patching credit_limit on a liability account is accepted."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(
        client, headers, account_kind="revolving", account_type="credit_card", name="Visa",
    )
    account_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/accounts/{account_id}", json={"credit_limit": 750_000}, headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["credit_limit"] == 750_000


async def test_update_asset_credit_limit_returns_422(client):
    """Patching credit_limit on an asset account is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/accounts/{account_id}", json={"credit_limit": 500_000}, headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "credit_limit is only valid on revolving-credit accounts"


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

    # Missing both currency and account_kind — Pydantic rejects either omission
    payload = {"name": "Test", "account_type": "checking"}
    resp = await client.post("/accounts", json=payload, headers=headers)

    assert resp.status_code == 422


async def test_create_account_without_auth_returns_401(client):
    """POST /accounts without an Authorization header returns 401."""
    resp = await client.post("/accounts", json=ACCOUNT_PAYLOAD)
    assert resp.status_code == 401


async def test_create_account_null_institution_accepted(client):
    """Null institution_id is valid — cash or unlinked accounts serialize institution as null."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, institution_id=None)

    assert resp.status_code == 201
    assert resp.json()["institution"] is None


async def test_create_account_with_all_optional_fields(client):
    """Account created with all optional fields set returns correct values."""
    inst = await _seed_institution()
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(
        client, headers,
        institution_id=str(inst.id),
        is_archived=True,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["institution"]["id"] == str(inst.id)
    assert data["is_archived"] is True


async def test_create_account_owner_id_cannot_be_hijacked(client):
    """Extra owner_id in the body cannot hijack ownership."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    payload = {**ACCOUNT_PAYLOAD, "owner_id": NONEXISTENT_ID}
    resp = await client.post("/accounts", json=payload, headers=headers)

    assert resp.status_code == 201
    assert resp.json()["owner_id"] == user_id


async def test_create_account_duplicate_names_allowed(client):
    """Multiple accounts with the same name are allowed."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp1 = await _create_account(client, headers, name="Savings")
    resp2 = await _create_account(client, headers, name="Savings")

    assert resp1.status_code == 201
    assert resp2.status_code == 201
    assert resp1.json()["id"] != resp2.json()["id"]
