"""Route behaviour when a stored timezone no longer resolves"""

import uuid

from fastapi import status
from sqlalchemy import func, select, update

from app.models.account import Account, TaxAdvantagedCategory
from app.models.user import User
from app.utils.dates import ACCOUNT_OWNER_PROFILE, OWN_PROFILE
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _create_account, _create_user, _get_auth_header, _seed_currency

# An identifier no release of the IANA database carries. Signup validates against the zone database,
# so a row only holds one of these when the value arrived another way, such as a restore from an
# instance whose database carried identifiers this one does not
UNRESOLVABLE_IDENTIFIER = "Mars/Olympus_Mons"


async def _store_unresolvable_timezone(email: str = SIGNUP_PAYLOAD["email"]):
    """Write an unresolvable timezone straight to the row, past the schema guarding every write

    Args:
        email: Address of the user whose stored timezone is replaced

    Returns:
        None
    """
    async with TestSession() as session:

        # Replace the user's timezone with one no zone database resolves
        await session.execute(update(User).where(User.email == email).values(tz=UNRESOLVABLE_IDENTIFIER))
        await session.commit()


async def _signup(client, *, email: str):
    """Sign up a second user, so a group has an owner and a member

    Args:
        client: Async test client
        email: Address for the new user

    Returns:
        API response from signing up the user
    """
    return await client.post("/auth/signup", json={**SIGNUP_PAYLOAD, "email": email})


async def _create_tax_advantaged_category(client, headers):
    """Create a personal tax-advantaged category

    Args:
        client: Async test client
        headers: Authorization header for the creating user

    Returns:
        API response from creating the category
    """
    return await client.post(
        "/tax-advantaged-categories",
        json={"name": "TFSA", "tax_treatment": "tax_free", "currency": "CAD"},
        headers=headers,
    )


async def test_dashboard_refuses_an_unresolvable_stored_timezone(client):
    """The reader is told which setting is at fault instead of getting a server error"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _store_unresolvable_timezone()

    resp = await client.get("/dashboard/credit", headers=headers)

    assert resp.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert UNRESOLVABLE_IDENTIFIER in resp.json()["detail"]


async def test_account_creation_writes_nothing_when_the_stored_timezone_is_unresolvable(client):
    """The refusal lands before the commit, so a failed request leaves no account behind"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _store_unresolvable_timezone()

    create_resp = await _create_account(client, headers)

    assert create_resp.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert OWN_PROFILE in create_resp.json()["detail"]
    async with TestSession() as session:

        # Count every account row, since a refusal after the commit would leave one behind
        account_count = await session.scalar(select(func.count()).select_from(Account))
    assert account_count == 0


async def test_category_creation_writes_nothing_when_the_stored_timezone_is_unresolvable(client):
    """The refusal lands before the commit, so a failed request leaves no category behind"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _store_unresolvable_timezone()

    create_resp = await _create_tax_advantaged_category(client, headers)

    assert create_resp.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert UNRESOLVABLE_IDENTIFIER in create_resp.json()["detail"]
    async with TestSession() as session:

        # Count every tax-advantaged category row, since a refusal after the commit would leave one behind
        category_count = await session.scalar(select(func.count()).select_from(TaxAdvantagedCategory))
    assert category_count == 0


async def test_category_update_writes_nothing_when_the_stored_timezone_is_unresolvable(client):
    """A refused update leaves the category as it was rather than saving and then failing"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    category_id = (await _create_tax_advantaged_category(client, headers)).json()["id"]
    await _store_unresolvable_timezone()

    update_resp = await client.patch(
        f"/tax-advantaged-categories/{category_id}",
        json={"name": "RRSP"},
        headers=headers,
    )

    assert update_resp.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert UNRESOLVABLE_IDENTIFIER in update_resp.json()["detail"]
    async with TestSession() as session:

        # Read the stored name back, since a refusal after the commit would have saved the new one
        stored_name = await session.scalar(
            select(TaxAdvantagedCategory.name).where(TaxAdvantagedCategory.id == uuid.UUID(category_id)),
        )
    assert stored_name == "TFSA"


async def test_an_invalid_category_payload_is_reported_before_the_timezone(client):
    """Validation runs above the timezone lookup, so a bad field is what the user is told about"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    category_id = (await _create_tax_advantaged_category(client, headers)).json()["id"]
    await _store_unresolvable_timezone()

    create_resp = await client.post(
        "/tax-advantaged-categories",
        json={"name": "RRSP", "tax_treatment": "taxable", "currency": "CAD"},
        headers=headers,
    )
    update_resp = await client.patch(
        f"/tax-advantaged-categories/{category_id}",
        json={"tax_treatment": "taxable"},
        headers=headers,
    )

    assert create_resp.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert update_resp.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert create_resp.json()["detail"] == "Tax-advantaged categories require a non-taxable tax treatment"
    assert update_resp.json()["detail"] == "Tax-advantaged categories require a non-taxable tax treatment"


async def test_a_reader_with_no_categories_is_not_refused(client):
    """The owners whose zones are needed come from the rows found, so an empty list needs none"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _store_unresolvable_timezone()

    resp = await client.get("/tax-advantaged-categories", headers=headers)

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == []


async def test_the_category_listing_refuses_an_unresolvable_stored_timezone(client):
    """The reader is told which value is at fault instead of getting a server error"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _create_tax_advantaged_category(client, headers)
    await _store_unresolvable_timezone()

    resp = await client.get("/tax-advantaged-categories", headers=headers)

    assert resp.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert UNRESOLVABLE_IDENTIFIER in resp.json()["detail"]


async def test_a_group_account_refusal_says_the_owner_setting_is_at_fault(client):
    """A group account is dated on its owner's day, which the member creating it cannot fix"""
    await _seed_currency()
    owner_resp = await _signup(client, email="owner@example.com")
    member_resp = await _signup(client, email="member@example.com")
    owner_headers = _get_auth_header(owner_resp)
    member_headers = _get_auth_header(member_resp)
    member_user_id = member_resp.json()["user"]["id"]

    group_id = (await client.post("/groups", json={"name": "Household"}, headers=owner_headers)).json()["id"]
    await client.post(f"/groups/{group_id}/members", json={"user_id": member_user_id}, headers=owner_headers)
    await client.patch(f"/groups/{group_id}/members/{member_user_id}", json={"is_admin": True}, headers=owner_headers)
    await _store_unresolvable_timezone("owner@example.com")

    create_resp = await _create_account(client, member_headers, group_id=group_id)

    assert create_resp.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert ACCOUNT_OWNER_PROFILE in create_resp.json()["detail"]
    assert OWN_PROFILE not in create_resp.json()["detail"]
