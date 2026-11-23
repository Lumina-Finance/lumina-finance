"""Asking the installed allowance check before a user adds a record in a currency other than their main one"""

import hashlib
import uuid

from app.allowance_hook import AllowanceKind
from app.services.allowance.require import find_feature_refusal, is_asked_about, require_feature

# Hex digits of the digest the browser compares, so a clash between two different sentences is vanishingly unlikely
TOKEN_LENGTH = 16


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


async def find_foreign_currencies_reason(user_id: uuid.UUID) -> str | None:
    """Return the sentence the installed check gives when it refuses records in another currency, or None when it allows them

    Args:
        user_id: The user holding the records
    """
    refusal = await find_feature_refusal(user_id, AllowanceKind.FOREIGN_CURRENCIES)
    return refusal.reason if refusal is not None else None


async def find_foreign_currencies_token(user_id: uuid.UUID) -> str | None:
    """Return a short digest of the refusal's sentence, or None when the check allows records in another currency

    Args:
        user_id: The user holding the records
    """
    reason = await find_foreign_currencies_reason(user_id)
    if reason is None:
        return None
    return hashlib.sha256(reason.encode()).hexdigest()[:TOKEN_LENGTH]
