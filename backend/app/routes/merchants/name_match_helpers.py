"""Answering which payee values already have a merchant"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.merchant import Merchant
from app.services.importers.shared.merchants import (
    get_import_merchant_scope_filter,
    select_requested_merchant_names,
)


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
    if not names:
        return []

    # One query for the whole file, rather than the whole merchant list for the user, which is what
    # a person with thousands of them would otherwise have to send to the browser. Both sides are
    # lowercased by the database, as the import itself matches them
    requested = select_requested_merchant_names(names)
    result = await db.execute(
        select(requested.c.name, Merchant)
        .join(Merchant, func.lower(Merchant.name) == func.lower(requested.c.name))
        .where(get_import_merchant_scope_filter(user_id))
        # The order the import reads its own candidates in, so both settle a name held in two scopes
        # the same way: the shared merchant first, then the oldest personal one
        .order_by(Merchant.is_system.desc(), Merchant.created_at, Merchant.id),
    )

    merchants_by_name: dict[str, Merchant] = {}
    for name, merchant in result.all():
        merchants_by_name.setdefault(name, merchant)
    return [(name, merchants_by_name[name]) for name in names if name in merchants_by_name]
