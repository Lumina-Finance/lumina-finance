"""Seed the categories table with global system categories."""

import asyncio

from app.services.category_defaults import SYSTEM_CATEGORY_DEFAULTS, seed_system_categories

from app.database import async_session
from app.models import group as _group  # noqa: F401
from app.models import user as _user  # noqa: F401


async def seed_categories() -> None:
    """Update/insert every system category into the database."""
    async with async_session() as db:
        await seed_system_categories(db)
        await db.commit()
    print(f"Seeded {len(SYSTEM_CATEGORY_DEFAULTS)} system categories.")


if __name__ == "__main__":
    asyncio.run(seed_categories())
