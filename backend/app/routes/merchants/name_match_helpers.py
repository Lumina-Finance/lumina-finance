"""Answering which payee values already have a merchant"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.merchant import Merchant
from app.services.importers.shared.merchants import get_import_merchant_key


async def get_merchants_matching_names(
    db: AsyncSession,
    user_id: uuid.UUID,
    names: list[str],
) -> list[tuple[str, Merchant]]:
    """Return the merchants an import would file each payee value under

    Matched by the rule the import itself matches by, and over the scope it matches in, so the page
    asking this and the commit that follows reach the same verdict

    Args:
        db: Active database session
        user_id: Authenticated user identifier
        names: Payee values from the file, already trimmed

    Returns:
        One pair per value that matched, holding the value as it was asked about and its merchant
    """
    keys = {get_import_merchant_key(name) for name in names}

    # One query for the whole file, rather than the whole merchant list for the user, which is what
    # a person with thousands of them would otherwise have to send to the browser
    result = await db.execute(
        select(Merchant)
        .where(
            Merchant.is_system.is_(True) | ((Merchant.owner_id == user_id) & Merchant.group_id.is_(None)),
            func.lower(Merchant.name).in_(keys),
        )
        # The order the import reads its own candidates in, so both settle a name held in two scopes
        # the same way: the shared merchant first, then the oldest personal one
        .order_by(Merchant.is_system.desc(), Merchant.created_at, Merchant.id),
    )

    merchants_by_key: dict[str, Merchant] = {}
    for merchant in result.scalars().all():
        merchants_by_key.setdefault(get_import_merchant_key(merchant.name), merchant)

    matches = []
    for name in names:
        merchant = merchants_by_key.get(get_import_merchant_key(name))
        if merchant is not None:
            matches.append((name, merchant))
    return matches
