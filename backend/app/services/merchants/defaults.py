"""System merchant defaults and seeding"""

import uuid

from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.merchant import Merchant

# What a transfer between your own accounts is paid to, which otherwise leaves everyone typing
# their own spelling of it. Also carried by the balance adjustments the app writes for itself,
# since those are nobody's transaction but still have to name a merchant
SELF_MERCHANT_NAME = "Myself"

# Carried by an imported row whose file had a merchant to state and left it blank. Every transaction
# has to have a merchant, and this says the answer is not known rather than claiming one
UNKNOWN_MERCHANT_NAME = "Unknown"

# Merchants that ship with the app and belong to every user
SYSTEM_MERCHANT_NAMES = (SELF_MERCHANT_NAME, UNKNOWN_MERCHANT_NAME)


async def seed_system_merchants(db: AsyncSession) -> list[str]:
    """Create the global system merchants that are missing

    Nothing is updated in place, since a system merchant carries only its name and that name is
    what identifies it

    Args:
        db: Active database session

    Returns:
        Names of the merchants this run created, which is empty where they were all already there
    """
    rows = [
        {"id": uuid.uuid4(), "owner_id": None, "group_id": None, "name": name, "is_system": True, "default_category_id": None}
        for name in SYSTEM_MERCHANT_NAMES
    ]

    # One statement against the unique index on the folded system name, so a run beside this one waits
    # for it and then finds the merchants there. The predicate is written as the index's own, since
    # the database picks the index by it
    result = await db.execute(
        insert(Merchant)
        .values(rows)
        .on_conflict_do_nothing(index_elements=[func.lower(Merchant.name)], index_where=text("is_system = true"))
        .returning(Merchant.name)
    )
    return list(result.scalars().all())
