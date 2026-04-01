from app.models.currency import Currency
from tests.conftest import TestSession

# --- Helpers ---

SIGNUP_PAYLOAD = {
    "email": "test@example.com",
    "password": "securepassword123",
    "first_name": "Test",
    "tz": "America/Toronto",
    "base_currency": "CAD",
}


async def _seed_currency():
    """Insert the CAD currency row required by the user's base_currency FK."""
    async with TestSession() as session:
        session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()


async def _seed_usd():
    """Insert the USD currency row for currency-change tests."""
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()


async def _create_user(client):
    """Seed currency and sign up a test user. Returns the signup response."""
    await _seed_currency()
    return await client.post("/auth/signup", json=SIGNUP_PAYLOAD)


def _auth_header(resp):
    """Extract a Bearer Authorization header dict from a signup/login response."""
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# --- GET /me ---


async def test_get_me_returns_full_profile(client):
    """Authenticated GET /me returns all user profile fields."""
    signup_resp = await _create_user(client)
    headers = _auth_header(signup_resp)

    resp = await client.get("/me", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == SIGNUP_PAYLOAD["email"]
    assert data["first_name"] == SIGNUP_PAYLOAD["first_name"]
    assert data["last_name"] is None
    assert data["profile_pic"] is None
    assert data["tz"] == SIGNUP_PAYLOAD["tz"]
    assert data["base_currency"] == SIGNUP_PAYLOAD["base_currency"]
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_get_me_without_auth_returns_401(client):
    """GET /me without an Authorization header returns 401."""
    resp = await client.get("/me")
    assert resp.status_code == 401


async def test_get_me_with_invalid_token_returns_401(client):
    """GET /me with a garbage Bearer token returns 401."""
    resp = await client.get("/me", headers={"Authorization": "Bearer garbage"})
    assert resp.status_code == 401


# --- PATCH /me ---


async def test_patch_updates_first_name(client):
    """PATCH /me updates first_name and returns the updated profile."""
    signup_resp = await _create_user(client)
    headers = _auth_header(signup_resp)

    resp = await client.patch("/me", json={"first_name": "Updated"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["first_name"] == "Updated"


async def test_patch_updates_last_name(client):
    """PATCH /me updates last_name."""
    signup_resp = await _create_user(client)
    headers = _auth_header(signup_resp)

    resp = await client.patch("/me", json={"last_name": "NewLast"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["last_name"] == "NewLast"


async def test_patch_updates_timezone(client):
    """PATCH /me updates timezone."""
    signup_resp = await _create_user(client)
    headers = _auth_header(signup_resp)

    resp = await client.patch("/me", json={"tz": "Europe/London"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["tz"] == "Europe/London"


async def test_patch_updates_base_currency(client):
    """PATCH /me updates base_currency when the new currency exists."""
    signup_resp = await _create_user(client)
    headers = _auth_header(signup_resp)
    await _seed_usd()

    resp = await client.patch("/me", json={"base_currency": "USD"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["base_currency"] == "USD"


async def test_patch_updates_multiple_fields(client):
    """PATCH /me updates multiple fields at once."""
    signup_resp = await _create_user(client)
    headers = _auth_header(signup_resp)

    resp = await client.patch("/me", json={"first_name": "Multi", "tz": "Asia/Tokyo"}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["first_name"] == "Multi"
    assert data["tz"] == "Asia/Tokyo"


async def test_patch_empty_body_returns_unchanged_profile(client):
    """PATCH /me with empty body returns 200 with no changes."""
    signup_resp = await _create_user(client)
    headers = _auth_header(signup_resp)

    before = await client.get("/me", headers=headers)
    resp = await client.patch("/me", json={}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == before.json()


async def test_patch_null_clears_nullable_field(client):
    """PATCH /me with null clears a nullable field."""
    signup_resp = await _create_user(client)
    headers = _auth_header(signup_resp)

    # Set last_name first
    await client.patch("/me", json={"last_name": "Temporary"}, headers=headers)
    # Clear it
    resp = await client.patch("/me", json={"last_name": None}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["last_name"] is None


async def test_patch_invalid_currency_returns_422(client):
    """PATCH /me with a non-existent currency code returns 422."""
    signup_resp = await _create_user(client)
    headers = _auth_header(signup_resp)

    resp = await client.patch("/me", json={"base_currency": "ZZZ"}, headers=headers)

    assert resp.status_code == 422


async def test_patch_empty_first_name_returns_422(client):
    """PATCH /me with empty first_name violates min_length and returns 422."""
    signup_resp = await _create_user(client)
    headers = _auth_header(signup_resp)

    resp = await client.patch("/me", json={"first_name": ""}, headers=headers)

    assert resp.status_code == 422


async def test_patch_short_currency_code_returns_422(client):
    """PATCH /me with a currency code shorter than 3 chars returns 422."""
    signup_resp = await _create_user(client)
    headers = _auth_header(signup_resp)

    resp = await client.patch("/me", json={"base_currency": "X"}, headers=headers)

    assert resp.status_code == 422


async def test_patch_without_auth_returns_401(client):
    """PATCH /me without an Authorization header returns 401."""
    resp = await client.patch("/me", json={"first_name": "Hacker"})
    assert resp.status_code == 401


async def test_patch_persists_across_requests(client):
    """PATCH /me changes are visible on subsequent GET /me."""
    signup_resp = await _create_user(client)
    headers = _auth_header(signup_resp)

    await client.patch("/me", json={"first_name": "Persisted"}, headers=headers)
    resp = await client.get("/me", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["first_name"] == "Persisted"
