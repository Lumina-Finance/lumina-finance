"""Seed the reference data every database needs, as the migrator"""

import asyncio
import logging
from collections.abc import Awaitable, Callable, Sequence

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.config.database import migration_database_url
from app.models import import_all_models
from app.services.categories.defaults import seed_system_categories
from app.services.currencies.defaults import seed_currencies
from app.services.merchants.defaults import seed_system_merchants

logger = logging.getLogger(__name__)

# Each seed by name, in the order a start-up runs them
SEEDS: dict[str, Callable[[AsyncSession], Awaitable[object]]] = {
    "currencies": seed_currencies,
    "categories": seed_system_categories,
    "merchants": seed_system_merchants,
}


async def seed_reference_data(names: Sequence[str] = tuple(SEEDS)) -> None:
    """Create or update the named reference data in one transaction, as the migrator

    Each seed is a single insert that waits for a run beside it rather than failing against it, and
    running one twice leaves the same rows

    Args:
        names: The seeds to run, from SEEDS, in the order given
    """
    # So every mapper the seeded tables relate to is configured
    import_all_models()

    engine = create_async_engine(migration_database_url(), hide_parameters=True)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as db:
            for name in names:
                await SEEDS[name](db)
                logger.info("Seeded the %s", name)
            await db.commit()
    finally:
        await engine.dispose()


def run_seeds(names: Sequence[str]) -> None:
    """Seed the named reference data from the command line, logging each seed as it finishes"""
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    logger.setLevel(logging.INFO)
    asyncio.run(seed_reference_data(names))
