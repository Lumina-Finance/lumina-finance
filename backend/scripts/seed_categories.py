"""Seed the categories table with global system categories"""

import asyncio

from app.database import create_migration_sessionmaker
from app.models import import_all_models
from app.services.categories.defaults import SYSTEM_CATEGORY_DEFAULTS, seed_system_categories

# Import all models so every mapper the seeded rows relate to is configured
import_all_models()


async def seed_categories() -> None:
    """Update or insert every system category into the database"""
    session_factory = create_migration_sessionmaker()
    async with session_factory() as db:
        await seed_system_categories(db)
        await db.commit()
    print(f"Seeded {len(SYSTEM_CATEGORY_DEFAULTS)} system categories")


if __name__ == "__main__":
    asyncio.run(seed_categories())
