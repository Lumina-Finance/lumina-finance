"""System merchant defaults and seeding"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.merchant import Merchant

# Merchants that ship with the app and belong to every user. "Myself" is what a transfer between
# your own accounts is paid to, which otherwise leaves everyone typing their own spelling of it
SYSTEM_MERCHANT_NAMES = ("Myself",)


async def seed_system_merchants(db: AsyncSession) -> None:
    """Create the global system merchants that are missing

    Nothing is updated in place, since a system merchant carries only its name and that name is
    what identifies it

    Args:
        db: Active database session
    """
    # Fetch the existing system merchants by name so seeding can run against a database that
    # already has some of them
    existing_result = await db.execute(
        select(Merchant.name).where(Merchant.is_system.is_(True)),
    )
    existing_names = set(existing_result.scalars().all())

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
