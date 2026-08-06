from app.models.base import InstitutionStatus
from app.models.institution import Institution
from app.routes import institution as institution_routes
from tests.conftest import TestSession
from tests.routes.support import _create_user, _get_auth_header

# --- Helpers ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"

INSTITUTION_PAYLOAD = {
    "name": "Test Bank",
    "country_code": "CA",
    "website": "https://testbank.example.com",
}


async def _seed_institution(status=InstitutionStatus.CANONICAL, **overrides):
    """Insert an institution directly via DB. Returns the created Institution."""
    defaults = {"name": "Test Bank", "country_code": "CA", "website": "https://testbank.example.com"}
    defaults.update(overrides)
    async with TestSession() as session:
        inst = Institution(status=status, **defaults)
        session.add(inst)
        await session.commit()
        await session.refresh(inst)
        return inst


# --- GET /institutions ---


async def test_list_institutions_returns_all_statuses(client):
    """List endpoint returns both CANONICAL and PENDING institutions."""
    await _seed_institution(status=InstitutionStatus.CANONICAL, name="Canonical Bank")
    await _seed_institution(status=InstitutionStatus.PENDING, name="Pending Bank")
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/institutions", headers=headers)

    assert resp.status_code == 200
    names = {i["name"] for i in resp.json()}
    assert names == {"Canonical Bank", "Pending Bank"}


async def test_list_institutions_sorted_by_name(client):
    """Canonical institutions are returned sorted alphabetically by name."""
    await _seed_institution(name="Zeta Bank")
    await _seed_institution(name="Alpha Bank")
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/institutions", headers=headers)

    assert resp.status_code == 200
    names = [i["name"] for i in resp.json()]
    assert names == ["Alpha Bank", "Zeta Bank"]


async def test_list_institutions_filter_by_country_code(client):
    """Country code filter returns only matching institutions."""
    await _seed_institution(name="Canadian Bank", country_code="CA")
    await _seed_institution(name="US Bank", country_code="US")
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/institutions", headers=headers, params={"country_code": "CA"})

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "Canadian Bank"


async def test_list_institutions_filter_no_match_returns_empty_list(client):
    """Country code filter with no matching institutions returns empty list."""
    await _seed_institution(country_code="CA")
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/institutions", headers=headers, params={"country_code": "JP"})

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_institutions_filter_too_short_returns_422(client):
    """Country code shorter than 2 characters returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/institutions", headers=headers, params={"country_code": "C"})

    assert resp.status_code == 422


async def test_list_institutions_filter_too_long_returns_422(client):
    """Country code longer than 2 characters returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/institutions", headers=headers, params={"country_code": "CAN"})

    assert resp.status_code == 422


async def test_list_institutions_without_auth_returns_401(client):
    """GET /institutions without an Authorization header returns 401."""
    resp = await client.get("/institutions")
    assert resp.status_code == 401


# --- GET /institutions/{institution_id} ---


async def test_get_institution_returns_institution(client):
    """Valid UUID returns the institution with all fields."""
    inst = await _seed_institution(status=InstitutionStatus.CANONICAL, name="Royal Bank")
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/institutions/{inst.id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Royal Bank"
    assert data["status"] == "canonical"
    assert data["country_code"] == "CA"
    assert data["website"] == "https://testbank.example.com"


async def test_get_institution_returns_pending_institution(client):
    """Detail endpoint returns institutions regardless of status."""
    inst = await _seed_institution(status=InstitutionStatus.PENDING)
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/institutions/{inst.id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["status"] == "pending"


async def test_get_institution_not_found_returns_404(client):
    """Non-existent UUID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/institutions/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Institution not found"


async def test_get_institution_invalid_uuid_returns_422(client):
    """Invalid UUID format returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/institutions/not-a-uuid", headers=headers)

    assert resp.status_code == 422


async def test_get_institution_without_auth_returns_401(client):
    """GET /institutions/{id} without an Authorization header returns 401."""
    resp = await client.get(f"/institutions/{NONEXISTENT_ID}")
    assert resp.status_code == 401


# --- POST /institutions ---


async def test_create_institution_returns_201_with_pending_status(client):
    """Valid submission creates an institution with PENDING status."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post("/institutions", json=INSTITUTION_PAYLOAD, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == INSTITUTION_PAYLOAD["name"]
    assert data["country_code"] == INSTITUTION_PAYLOAD["country_code"]
    assert data["website"] == INSTITUTION_PAYLOAD["website"]
    assert data["status"] == "pending"
    assert data["logo_url"] is None
    assert data["id"] is not None


async def test_create_institution_with_logo_url_returns_logo_url(client):
    """Submitting an institution with logo_url stores and returns it."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    payload = {**INSTITUTION_PAYLOAD, "logo_url": "https://cdn.example.com/testbank.png"}
    resp = await client.post("/institutions", json=payload, headers=headers)

    assert resp.status_code == 201
    assert resp.json()["logo_url"] == "https://cdn.example.com/testbank.png"


async def test_get_institution_returns_logo_url_when_set(client):
    """Detail endpoint surfaces logo_url for institutions that have one."""
    inst = await _seed_institution(name="Logo Bank", logo_url="https://cdn.example.com/logo-bank.png")
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/institutions/{inst.id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["logo_url"] == "https://cdn.example.com/logo-bank.png"


async def test_create_institution_status_override_ignored(client):
    """Client cannot override status — it is always set to PENDING server-side."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    payload = {**INSTITUTION_PAYLOAD, "status": "canonical"}
    resp = await client.post("/institutions", json=payload, headers=headers)

    assert resp.status_code == 201
    assert resp.json()["status"] == "pending"


async def test_create_institution_duplicate_name_and_country_returns_409(client):
    """Submitting an institution with the same name and country code is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp1 = await client.post("/institutions", json=INSTITUTION_PAYLOAD, headers=headers)
    resp2 = await client.post("/institutions", json=INSTITUTION_PAYLOAD, headers=headers)

    assert resp1.status_code == 201
    assert resp2.status_code == 409
    assert resp2.json()["detail"] == "Institution with this name and country already exists"


async def test_create_institution_empty_name_returns_422(client):
    """Empty name violates min_length and returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    payload = {**INSTITUTION_PAYLOAD, "name": ""}
    resp = await client.post("/institutions", json=payload, headers=headers)

    assert resp.status_code == 422


async def test_create_institution_missing_field_returns_422(client):
    """Missing a required field returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    payload = {"name": "Test Bank", "country_code": "CA"}  # missing website
    resp = await client.post("/institutions", json=payload, headers=headers)

    assert resp.status_code == 422


async def test_create_institution_country_code_wrong_length_returns_422(client):
    """Country code not exactly 2 characters returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    payload = {**INSTITUTION_PAYLOAD, "country_code": "C"}
    resp = await client.post("/institutions", json=payload, headers=headers)

    assert resp.status_code == 422


async def test_create_institution_without_auth_returns_401(client):
    """POST /institutions without an Authorization header returns 401."""
    resp = await client.post("/institutions", json=INSTITUTION_PAYLOAD)
    assert resp.status_code == 401


# --- PATCH /institutions/{institution_id} ---


async def test_update_institution_rewrites_the_shared_row(client):
    """A correction to the website is stored, leaving the other fields alone."""
    inst = await _seed_institution()
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(
        f"/institutions/{inst.id}",
        json={"website": "https://newbank.example.com"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["website"] == "https://newbank.example.com"
    assert data["name"] == "Test Bank"
    assert data["country_code"] == "CA"


async def test_update_institution_demotes_a_canonical_row(client):
    """A correction drops a canonical institution back to pending."""
    inst = await _seed_institution(status=InstitutionStatus.CANONICAL)
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(
        f"/institutions/{inst.id}",
        json={"website": "https://newbank.example.com"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "pending"


async def test_update_institution_leaves_omitted_fields_alone(client):
    """Fields left out of the request keep their stored values."""
    inst = await _seed_institution(logo_url="https://cdn.example.com/logo-bank.png")
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(
        f"/institutions/{inst.id}",
        json={"website": "https://newbank.example.com"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["logo_url"] == "https://cdn.example.com/logo-bank.png"


async def test_update_institution_clears_logo_url_with_an_explicit_null(client):
    """Sending logo_url as null clears the stored logo."""
    inst = await _seed_institution(logo_url="https://cdn.example.com/logo-bank.png")
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(f"/institutions/{inst.id}", json={"logo_url": None}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["logo_url"] is None


async def test_update_institution_rejects_a_null_on_a_required_field(client):
    """A field backed by a NOT NULL column cannot be sent as null."""
    inst = await _seed_institution()
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    for field in ("name", "country_code", "website"):
        resp = await client.patch(f"/institutions/{inst.id}", json={field: None}, headers=headers)
        assert resp.status_code == 422, field


async def test_update_institution_rename_onto_an_existing_pair_returns_409(client):
    """Renaming onto a name and country another institution holds is rejected."""
    await _seed_institution(name="Alpha Bank", country_code="CA")
    beta = await _seed_institution(name="Beta Bank", country_code="CA")
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(f"/institutions/{beta.id}", json={"name": "Alpha Bank"}, headers=headers)

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Institution with this name and country already exists"


async def test_update_institution_keeping_its_own_name_is_not_a_conflict(client):
    """Resending the stored name alongside a change does not collide with the row itself."""
    inst = await _seed_institution(name="Alpha Bank", country_code="CA")
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(
        f"/institutions/{inst.id}",
        json={"name": "Alpha Bank", "website": "https://alpha.example.com"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["website"] == "https://alpha.example.com"


async def test_update_institution_conflict_reads_the_name_and_country_pair(client):
    """Changing only the country onto an existing pair is rejected."""
    canadian = await _seed_institution(name="Alpha Bank", country_code="CA")
    await _seed_institution(name="Alpha Bank", country_code="US")
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(
        f"/institutions/{canadian.id}",
        json={"country_code": "US"},
        headers=headers,
    )

    assert resp.status_code == 409


async def test_update_institution_with_unchanged_values_changes_nothing(client):
    """Saving the form without editing it is not a correction, so the row stays canonical."""
    inst = await _seed_institution(status=InstitutionStatus.CANONICAL)
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(
        f"/institutions/{inst.id}",
        json={
            "name": "Test Bank",
            "country_code": "CA",
            "website": "https://testbank.example.com",
        },
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "canonical"


async def test_update_institution_losing_a_name_race_returns_409(client, monkeypatch):
    """A pair claimed between the check and the commit answers with the same conflict."""
    inst = await _seed_institution(name="Beta Bank", country_code="CA")
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    real_mark_user_cache_changed = institution_routes.mark_user_cache_changed

    async def claim_the_pair_first(db, user_id):
        """Take the requested pair from another session, the way a concurrent write would"""
        await _seed_institution(name="Alpha Bank", country_code="CA")
        await real_mark_user_cache_changed(db, user_id)

    monkeypatch.setattr(institution_routes, "mark_user_cache_changed", claim_the_pair_first)

    resp = await client.patch(
        f"/institutions/{inst.id}",
        json={"name": "Alpha Bank"},
        headers=headers,
    )

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Institution with this name and country already exists"


async def test_create_institution_losing_a_name_race_returns_409(client, monkeypatch):
    """A pair claimed between the check and the commit answers with the same conflict."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    real_mark_user_cache_changed = institution_routes.mark_user_cache_changed

    async def claim_the_pair_first(db, user_id):
        """Take the requested pair from another session, the way a concurrent write would"""
        await _seed_institution(name="Test Bank", country_code="CA")
        await real_mark_user_cache_changed(db, user_id)

    monkeypatch.setattr(institution_routes, "mark_user_cache_changed", claim_the_pair_first)

    resp = await client.post("/institutions", json=INSTITUTION_PAYLOAD, headers=headers)

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Institution with this name and country already exists"


async def test_update_institution_with_no_fields_changes_nothing(client):
    """A request carrying no fields leaves the row, including its status, untouched."""
    inst = await _seed_institution(status=InstitutionStatus.CANONICAL)
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(f"/institutions/{inst.id}", json={}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "canonical"
    assert data["website"] == "https://testbank.example.com"


async def test_update_institution_not_found_returns_404(client):
    """Correcting an institution that does not exist returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(
        f"/institutions/{NONEXISTENT_ID}",
        json={"website": "https://newbank.example.com"},
        headers=headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Institution not found"


async def test_update_institution_status_override_ignored(client):
    """Client cannot hold a row canonical by sending a status alongside the correction."""
    inst = await _seed_institution(status=InstitutionStatus.CANONICAL)
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(
        f"/institutions/{inst.id}",
        json={"status": "canonical", "website": "https://newbank.example.com"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "pending"


async def test_update_institution_validates_like_create(client):
    """An empty name and a country code of the wrong length are both rejected."""
    inst = await _seed_institution()
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    empty_name_resp = await client.patch(f"/institutions/{inst.id}", json={"name": ""}, headers=headers)
    long_country_resp = await client.patch(
        f"/institutions/{inst.id}",
        json={"country_code": "CAN"},
        headers=headers,
    )

    assert empty_name_resp.status_code == 422
    assert long_country_resp.status_code == 422


async def test_update_institution_without_auth_returns_401(client):
    """PATCH /institutions/{id} without an Authorization header returns 401."""
    resp = await client.patch(
        f"/institutions/{NONEXISTENT_ID}",
        json={"website": "https://newbank.example.com"},
    )
    assert resp.status_code == 401


async def test_update_institution_updates_cache_status(client):
    """A correction marks app data changed for the submitting user's cache validation."""
    inst = await _seed_institution()
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    before_resp = await client.get("/me/cache-status", headers=headers)
    resp = await client.patch(
        f"/institutions/{inst.id}",
        json={"website": "https://newbank.example.com"},
        headers=headers,
    )
    after_resp = await client.get("/me/cache-status", headers=headers)

    assert resp.status_code == 200
    before_changed_at = before_resp.json()["personal"]["changed_at"]
    after_changed_at = after_resp.json()["personal"]["changed_at"]
    assert after_changed_at is not None
    assert after_changed_at != before_changed_at
