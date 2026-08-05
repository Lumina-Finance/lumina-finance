"""System merchant defaults and seeding"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.merchant import Merchant

# What a transfer between your own accounts is paid to, which otherwise leaves everyone typing
# their own spelling of it. Also carried by the balance adjustments the app writes for itself,
# since those are nobody's transaction but still have to name a merchant
SELF_MERCHANT_NAME = "Myself"

# Carried by an imported row whose file had a payee to state and left it blank. Every transaction
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
    # Fetch the existing system merchants by name so seeding can run against a database that
    # already has some of them
    existing_result = await db.execute(
        select(Merchant.name).where(Merchant.is_system.is_(True)),
    )
    existing_names = set(existing_result.scalars().all())

    created_names = []
    for name in SYSTEM_MERCHANT_NAMES:
        if name in existing_names:
            continue
        db.add(Merchant(
            owner_id=None,
            group_id=None,
            name=name,
            is_system=True,
            default_category_id=None,
        ))
        created_names.append(name)
    return created_names
