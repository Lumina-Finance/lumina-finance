"""Seed the merchants table with global system merchants"""

import asyncio

from app.database import create_migration_sessionmaker
from app.models import import_all_models
from app.services.merchants.defaults import seed_system_merchants

# Import all models so every mapper the seeded rows relate to is configured
import_all_models()


async def seed_merchants() -> None:
    """Insert every missing system merchant into the database"""
    session_factory = create_migration_sessionmaker()
    async with session_factory() as db:
        created_names = await seed_system_merchants(db)
        await db.commit()
    print(f"Seeded {len(created_names)} system merchants")


if __name__ == "__main__":
    asyncio.run(seed_merchants())
