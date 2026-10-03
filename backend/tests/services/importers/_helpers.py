from app.models.currency import Currency
from app.models.user import User


async def _seed_user(session) -> User:
    """Insert a user whose base currency, the Canadian dollar, is seeded with them, for an import to write for"""
    session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
    user = User(email="import@example.com", first_name="Import", tz="America/Toronto", base_currency="CAD")
    session.add(user)
    await session.flush()
    return user
