import pytest
from sqlalchemy.exc import IntegrityError

from app.models.base import InstitutionStatus
from app.models.institution import Institution

# --- Fixtures ---


@pytest.fixture
async def institution(db):
    """Seed an institution."""
    i = Institution(name="Test Bank", country_code="CA", website="https://testbank.example.com")
    db.add(i)
    await db.flush()
    return i


# --- Basic CRUD ---


async def test_create_institution(db, institution):
    """Insert an institution and verify all fields persist."""
    result = await db.get(Institution, institution.id)
    assert result is not None
    assert result.name == "Test Bank"
    assert result.country_code == "CA"
    assert result.website == "https://testbank.example.com"
    assert result.status == InstitutionStatus.PENDING


async def test_update_institution(db, institution):
    """Update an institution's status to canonical."""
    institution.status = InstitutionStatus.CANONICAL
    await db.flush()

    result = await db.get(Institution, institution.id)
    assert result.status == InstitutionStatus.CANONICAL


async def test_delete_institution(db, institution):
    """Delete an institution."""
    iid = institution.id
    await db.delete(institution)
    await db.flush()

    result = await db.get(Institution, iid)
    assert result is None


# --- Defaults ---


async def test_status_defaults_to_pending(db, institution):
    """Status should default to pending."""
    assert institution.status == InstitutionStatus.PENDING


# --- Constraints ---


async def test_null_name_rejected(db):
    """Institution name is NOT NULL."""
    db.add(Institution(name=None, country_code="CA", website="https://example.com"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_country_code_rejected(db):
    """Institution country_code is NOT NULL."""
    db.add(Institution(name="Test Bank", country_code=None, website="https://example.com"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_website_rejected(db):
    """Institution website is NOT NULL."""
    db.add(Institution(name="Test Bank", country_code="CA", website=None))
    with pytest.raises(IntegrityError):
        await db.flush()
