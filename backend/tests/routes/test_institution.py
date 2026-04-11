from app.models.base import InstitutionStatus
from app.models.institution import Institution
from tests.conftest import TestSession
from tests.routes.conftest import _create_user, _get_auth_header

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


async def test_list_institutions_returns_canonical_only(client):
    """List endpoint returns only CANONICAL institutions, not PENDING."""
    await _seed_institution(status=InstitutionStatus.CANONICAL, name="Canonical Bank")
    await _seed_institution(status=InstitutionStatus.PENDING, name="Pending Bank")
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/institutions", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "Canonical Bank"


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
