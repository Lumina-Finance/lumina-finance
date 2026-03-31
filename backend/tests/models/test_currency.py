import pytest
from sqlalchemy.exc import IntegrityError

from app.models.currency import Currency

# --- Basic CRUD ---


async def test_create_currency(db):
    """Insert a currency and verify all fields persist."""
    currency = Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2)
    db.add(currency)
    await db.flush()

    result = await db.get(Currency, "CAD")
    assert result is not None
    assert result.name == "Canadian Dollar"
    assert result.symbol == "$"
    assert result.minor_unit_exponent == 2


async def test_read_currency(db):
    """Insert and read back a currency by primary key."""
    db.add(Currency(id="USD", name="United States Dollar", symbol="$", minor_unit_exponent=2))
    await db.flush()

    result = await db.get(Currency, "USD")
    assert result is not None
    assert result.id == "USD"


async def test_update_currency(db):
    """Update a currency's name."""
    db.add(Currency(id="JPY", name="Japanes Yen", symbol="¥", minor_unit_exponent=0))
    await db.flush()

    currency = await db.get(Currency, "JPY")
    currency.name = "Japanese Yen"
    await db.flush()

    updated = await db.get(Currency, "JPY")
    assert updated.name == "Japanese Yen"


async def test_delete_currency(db):
    """Delete a currency and verify it's gone."""
    db.add(Currency(id="GBP", name="Pound Sterling", symbol="£", minor_unit_exponent=2))
    await db.flush()

    currency = await db.get(Currency, "GBP")
    await db.delete(currency)
    await db.flush()

    result = await db.get(Currency, "GBP")
    assert result is None


# --- Constraints ---


async def test_duplicate_currency_id_rejected(db):
    """Primary key uniqueness should prevent duplicate currency codes."""
    db.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
    await db.flush()

    db.add(Currency(id="CAD", name="Duplicate", symbol="X", minor_unit_exponent=0))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_name_rejected(db):
    """Currency name is NOT NULL."""
    db.add(Currency(id="XXX", name=None, symbol="?", minor_unit_exponent=0))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_symbol_rejected(db):
    """Currency symbol is NOT NULL."""
    db.add(Currency(id="XXX", name="Test", symbol=None, minor_unit_exponent=0))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_minor_unit_exponent_rejected(db):
    """Currency minor_unit_exponent is NOT NULL."""
    db.add(Currency(id="XXX", name="Test", symbol="?", minor_unit_exponent=None))
    with pytest.raises(IntegrityError):
        await db.flush()
