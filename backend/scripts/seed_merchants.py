"""Seed the merchants table with global system merchants"""

import asyncio

from app.database import create_migration_sessionmaker
from app.models import category as _category  # noqa: F401
from app.models import group as _group  # noqa: F401
from app.models import user as _user  # noqa: F401
from app.services.merchants.defaults import SYSTEM_MERCHANT_NAMES, seed_system_merchants


async def seed_merchants() -> None:
    """Insert every missing system merchant into the database"""
    session_factory = create_migration_sessionmaker()
    async with session_factory() as db:
        await seed_system_merchants(db)
        await db.commit()
    print(f"Seeded {len(SYSTEM_MERCHANT_NAMES)} system merchants")


if __name__ == "__main__":
    asyncio.run(seed_merchants())
