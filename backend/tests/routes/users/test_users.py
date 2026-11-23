import pytest

from app.allowance_hook import AllowanceKind
from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _get_auth_header
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check, seed_usd_currency

# --- GET /me ---


async def test_get_me_returns_full_profile(client):
    """Authenticated GET /me returns all user profile fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

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
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"first_name": "Updated"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["first_name"] == "Updated"


async def test_patch_updates_last_name(client):
    """PATCH /me updates last_name."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"last_name": "NewLast"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["last_name"] == "NewLast"


async def test_patch_updates_timezone(client):
    """PATCH /me updates timezone."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"tz": "Europe/London"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["tz"] == "Europe/London"


async def test_patch_invalid_timezone_returns_422(client):
    """PATCH /me rejects non-IANA timezone names."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"tz": "Toronto"}, headers=headers)

    assert resp.status_code == 422


async def test_patch_updates_base_currency(client):
    """PATCH /me updates base_currency when the new currency exists."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await seed_usd_currency()

    resp = await client.patch("/me", json={"base_currency": "USD"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["base_currency"] == "USD"


@pytest.mark.parametrize(
    ("refused", "new_currency", "status_code", "detail", "saved_currency", "asks"),
    [
        pytest.param({AllowanceKind.MAIN_CURRENCY_CHANGE}, "USD", 403, ALLOWANCE_REASON, "CAD", 1, id="refused"),
        pytest.param(set(), "USD", 200, None, "USD", 1, id="allowed"),
        pytest.param({AllowanceKind.MAIN_CURRENCY_CHANGE}, "CAD", 200, None, "CAD", 0, id="same-currency-never-asked"),
    ],
)
async def test_patch_base_currency_asks_the_check_only_for_a_different_currency(
    client, refused, new_currency, status_code, detail, saved_currency, asks
):
    """A refused change answers with the check's sentence and keeps the main currency, and the currency already held is not asked about"""
    headers = _get_auth_header(await _create_user(client))
    await seed_usd_currency()
    user_id = (await client.get("/me", headers=headers)).json()["id"]
    asked = install_check(refused=refused)

    resp = await client.patch("/me", json={"base_currency": new_currency}, headers=headers)

    assert resp.status_code == status_code, resp.text
    assert resp.json().get("detail") == detail
    assert (await client.get("/me", headers=headers)).json()["base_currency"] == saved_currency
    assert [
        (str(request.user_id), request.held, request.adding) for request in asked if request.kind == AllowanceKind.MAIN_CURRENCY_CHANGE
    ] == [(user_id, None, 0)] * asks


async def test_patch_refused_main_currency_change_keeps_every_other_field_and_the_cache_time(client):
    """A refused change of main currency saves none of the fields sent with it and marks no change for the cache check"""
    headers = _get_auth_header(await _create_user(client))
    await seed_usd_currency()
    before = (await client.get("/me/cache-status", headers=headers)).json()["personal"]["changed_at"]
    install_check(refused={AllowanceKind.MAIN_CURRENCY_CHANGE})

    refused = await client.patch("/me", json={"first_name": "Updated", "base_currency": "USD"}, headers=headers)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == ALLOWANCE_REASON
    profile = (await client.get("/me", headers=headers)).json()
    assert (profile["first_name"], profile["base_currency"]) == (SIGNUP_PAYLOAD["first_name"], "CAD")
    assert (await client.get("/me/cache-status", headers=headers)).json()["personal"]["changed_at"] == before


async def test_patch_unknown_base_currency_is_not_asked_about(client):
    """A currency that does not exist answers 422 before the check is asked, so the user fixes the code first"""
    headers = _get_auth_header(await _create_user(client))
    asked = install_check(refused={AllowanceKind.MAIN_CURRENCY_CHANGE})

    resp = await client.patch("/me", json={"base_currency": "XXX"}, headers=headers)

    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == "Invalid currency code"
    assert asked == []


async def test_patch_updates_multiple_fields(client):
    """PATCH /me updates multiple fields at once."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"first_name": "Multi", "tz": "Asia/Tokyo"}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["first_name"] == "Multi"
    assert data["tz"] == "Asia/Tokyo"


async def test_patch_empty_body_returns_unchanged_profile(client):
    """PATCH /me with empty body returns 200 with no changes."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    before = await client.get("/me", headers=headers)
    with client.expecting_no_change():
        resp = await client.patch("/me", json={}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == before.json()


async def test_patch_null_clears_nullable_field(client):
    """PATCH /me with null clears a nullable field."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    # Set last_name first
    await client.patch("/me", json={"last_name": "Temporary"}, headers=headers)
    # Clear it
    resp = await client.patch("/me", json={"last_name": None}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["last_name"] is None


async def test_patch_invalid_currency_returns_422(client):
    """PATCH /me with a non-existent currency code returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"base_currency": "XXX"}, headers=headers)

    assert resp.status_code == 422


async def test_patch_empty_first_name_returns_422(client):
    """PATCH /me with empty first_name violates min_length and returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"first_name": ""}, headers=headers)

    assert resp.status_code == 422


async def test_patch_short_currency_code_returns_422(client):
    """PATCH /me with a currency code shorter than 3 chars returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"base_currency": "X"}, headers=headers)

    assert resp.status_code == 422


async def test_patch_null_first_name_returns_422(client):
    """PATCH /me with null first_name returns 422 (non-nullable field)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"first_name": None}, headers=headers)

    assert resp.status_code == 422


async def test_patch_null_tz_returns_422(client):
    """PATCH /me with null tz returns 422 (non-nullable field)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"tz": None}, headers=headers)

    assert resp.status_code == 422


async def test_patch_null_base_currency_returns_422(client):
    """PATCH /me with null base_currency returns 422 (non-nullable field)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"base_currency": None}, headers=headers)

    assert resp.status_code == 422


async def test_patch_extra_fields_are_ignored(client):
    """PATCH /me with unknown fields ignores them and doesn't change the profile."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    before = await client.get("/me", headers=headers)
    with client.expecting_no_change():
        resp = await client.patch("/me", json={"foo": "bar"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == before.json()


async def test_patch_email_is_ignored(client):
    """PATCH /me cannot change email even if included in the body."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    with client.expecting_no_change():
        resp = await client.patch("/me", json={"email": "hacker@evil.com"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["email"] == SIGNUP_PAYLOAD["email"]


async def test_patch_updates_profile_pic(client):
    """PATCH /me updates profile_pic."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"profile_pic": "https://example.com/pic.jpg"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["profile_pic"] == "https://example.com/pic.jpg"


async def test_patch_refuses_a_profile_pic_past_the_limit_and_keeps_the_stored_one(client):
    """A profile picture of 3,000 or of 2,049 characters is refused on its own field, one of 2,048 is kept, and the address stored stays"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    stored = "https://example.com/" + "p" * (2048 - len("https://example.com/"))
    assert len(stored) == 2048
    assert (await client.patch("/me", json={"profile_pic": stored}, headers=headers)).status_code == 200

    for too_long in (stored + "p", "https://example.com/" + "p" * 3_000):
        resp = await client.patch("/me", json={"profile_pic": too_long}, headers=headers)

        assert resp.status_code == 422
        assert resp.json()["detail"][0]["loc"] == ["body", "profile_pic"]
    assert (await client.get("/me", headers=headers)).json()["profile_pic"] == stored


async def test_patch_keeps_a_last_name_of_256_characters_and_refuses_257(client):
    """A last name as wide as its column is stored, and one character more is refused on its own field"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    assert (await client.patch("/me", json={"last_name": "n" * 256}, headers=headers)).status_code == 200
    resp = await client.patch("/me", json={"last_name": "n" * 257}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"][0]["loc"] == ["body", "last_name"]


async def test_patch_without_auth_returns_401(client):
    """PATCH /me without an Authorization header returns 401."""
    resp = await client.patch("/me", json={"first_name": "Hacker"})
    assert resp.status_code == 401


async def test_patch_persists_across_requests(client):
    """PATCH /me changes are visible on subsequent GET /me."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await client.patch("/me", json={"first_name": "Persisted"}, headers=headers)
    resp = await client.get("/me", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["first_name"] == "Persisted"


# --- date format ---


async def test_new_user_starts_on_the_month_day_year_date_format(client):
    """A new account reads dates as before until it picks another format, in the profile and the sign-up response"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/me", headers=headers)

    assert signup_resp.json()["user"]["date_format"] == "month-day-year"
    assert resp.json()["date_format"] == "month-day-year"


@pytest.mark.parametrize("date_format", ["day-month-year", "iso", "month-day-year"])
async def test_patch_saves_each_date_format(client, date_format):
    """Each offered date format is saved and read back on the next request."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"date_format": date_format}, headers=headers)
    reread = await client.get("/me", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["date_format"] == date_format
    assert reread.json()["date_format"] == date_format


@pytest.mark.parametrize("date_format", ["match-language", "dd/mm/yyyy", ""])
async def test_patch_unknown_date_format_returns_422(client, date_format):
    """PATCH /me refuses a date format the app does not offer, and keeps the saved one."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"date_format": date_format}, headers=headers)
    reread = await client.get("/me", headers=headers)

    assert resp.status_code == 422
    assert reread.json()["date_format"] == "month-day-year"


async def test_patch_null_date_format_returns_422(client):
    """PATCH /me with null date_format returns 422 (non-nullable field)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"date_format": None}, headers=headers)

    assert resp.status_code == 422
