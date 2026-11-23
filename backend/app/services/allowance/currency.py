"""Asking the installed allowance check before a user adds a record in a currency other than their main one"""

import uuid

from app.allowance_hook import AllowanceKind, Refusal
from app.services.allowance.require import find_feature_refusal, is_asked_about, require_feature


async def require_currency(user_id: uuid.UUID, base_currency: str, currency: str, *, group_id: uuid.UUID | None = None) -> None:
    """Refuse a user who may not add a record in a currency other than their main one

    Args:
        user_id: The user adding
        base_currency: The user's main currency
        currency: The currency of the record about to be added
        group_id: The group the record would belong to, which exempts it, since a record owned
            through a group is never asked about

    Raises:
        HTTPException 403: The installed check refused, with its reason as the detail
    """
    # The one place deciding whether a currency needs asking about
    if not is_asked_about(group_id) or currency.upper() == base_currency.upper():
        return
    await require_feature(user_id, AllowanceKind.FOREIGN_CURRENCIES)


async def find_foreign_currencies_refusal(user_id: uuid.UUID) -> Refusal | None:
    """Ask whether a user may hold records in another currency, and return the refusal or None when they may

    Args:
        user_id: The user holding the records
    """
    return await find_feature_refusal(user_id, AllowanceKind.FOREIGN_CURRENCIES)
