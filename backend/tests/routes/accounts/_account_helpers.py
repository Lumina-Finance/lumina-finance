from datetime import date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.models.account import AccountBalanceSnapshot
from app.models.base import InstitutionStatus
from app.models.category import Category
from app.models.institution import Institution
from app.models.transaction import Transaction
from tests.conftest import TestSession

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"

class _FixedClock:
    """Fixed clock used to make account lifecycle dates deterministic"""

    def __init__(self, instant):
        """Store the fixed instant returned by the test clock"""
        self.instant = instant

    def now(self, tz=None):
        """Return the fixed instant in the requested timezone"""
        return self.instant.astimezone(tz) if tz else self.instant


async def _seed_institution(logo_url: str | None = None):
    """Insert a canonical institution for FK tests.

    Inserts via raw session (not the API) because institutions are seeded data,
    not user-created resources

    Returns:
        The persisted Institution ORM instance
    """
    async with TestSession() as session:

        # Insert a canonical institution row for account FK validation
        inst = Institution(
            status=InstitutionStatus.CANONICAL,
            name="Test Bank",
            country_code="CA",
            website="https://testbank.example.com",
            logo_url=logo_url,
        )
        session.add(inst)
        await session.commit()
        await session.refresh(inst)
        return inst


async def _create_second_user(client):
    """Sign up a second user for ownership-isolation tests.

    Args:
        client: The async test client

    Returns:
        The HTTP response from the signup endpoint
    """
    return await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "securepassword123",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })


async def _signup_user(client, *, email: str, first_name: str, tz: str):
    """Sign up a user with caller-provided identity and timezone details"""
    return await client.post("/auth/signup", json={
        "email": email,
        "password": "securepassword123",
        "first_name": first_name,
        "tz": tz,
        "base_currency": "CAD",
    })


def _created_at_in_tz(account_data: dict, tz: str) -> date:
    """Return an account creation date in the requested timezone"""
    return datetime.fromisoformat(account_data["created_at"]).astimezone(ZoneInfo(tz)).date()


def _clock_on_account_day(account_data: dict, tz: str) -> _FixedClock:
    """Return a fixed clock pinned to the account creation day"""
    dt = _created_at_in_tz(account_data, tz)
    return _FixedClock(datetime(dt.year, dt.month, dt.day, 16, 0, tzinfo=ZoneInfo(tz)))


async def _archive_adjustment_rows(account_id: str):
    """Return archive balance adjustment transactions for an account"""
    async with TestSession() as session:

        # Fetch archive balance adjustments and their categories in creation order
        return (await session.execute(
            select(Transaction, Category)
            .join(Category, Category.id == Transaction.category_id)
            .where(
                Transaction.account_id == UUID(account_id),
                Transaction.notes == "Account archived",
            )
            .order_by(Transaction.created_at),
        )).all()


async def _latest_snapshot_balance(account_id: str) -> int:
    """Return the latest balance snapshot amount for an account"""
    async with TestSession() as session:

        # Read the newest balance snapshot for the account
        balance = await session.scalar(
            select(AccountBalanceSnapshot.balance)
            .where(AccountBalanceSnapshot.account_id == UUID(account_id))
            .order_by(AccountBalanceSnapshot.dt.desc())
            .limit(1),
        )
        assert balance is not None
        return balance
