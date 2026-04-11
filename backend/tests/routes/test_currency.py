from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.conftest import _seed_currency

# --- Helpers ---


async def _seed_currencies():
    """Insert multiple currencies for list tests."""
    async with TestSession() as session:
        session.add_all([
            Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2),
            Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
            Currency(id="JPY", name="Japanese Yen", symbol="¥", minor_unit_exponent=0),
        ])
        await session.commit()


# --- GET /currencies ---


async def test_list_currencies_returns_all_sorted_by_id(client):
    """Unauthenticated request returns all currencies sorted by ISO code."""
    await _seed_currencies()

    resp = await client.get("/currencies")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 3
    assert [c["id"] for c in data] == ["CAD", "JPY", "USD"]
    for currency in data:
        assert "id" in currency
        assert "name" in currency
        assert "symbol" in currency
        assert "minor_unit_exponent" in currency


# --- GET /currencies/{currency_id} ---


async def test_get_currency_returns_matching_currency(client):
    """Valid currency code returns the matching currency with all fields."""
    await _seed_currency()

    resp = await client.get("/currencies/CAD")

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "CAD"
    assert data["name"] == "Canadian Dollar"
    assert data["symbol"] == "$"
    assert data["minor_unit_exponent"] == 2


async def test_get_currency_not_found_returns_404(client):
    """Non-existent currency code returns 404."""
    resp = await client.get("/currencies/XXX")

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Currency not found"


async def test_get_currency_lowercase_code_returns_404(client):
    """Lowercase currency code does not match uppercase PK (case-sensitive lookup)."""
    await _seed_currency()

    resp = await client.get("/currencies/cad")

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Currency not found"
