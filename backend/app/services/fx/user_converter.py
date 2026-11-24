"""Building the converter a signed-in user's request converts with"""

import uuid
from functools import partial

from sqlalchemy.ext.asyncio import AsyncSession

from app.database import current_user_id_ctx
from app.services.allowance.currency import find_foreign_currencies_reason
from app.services.fx.converter import FxConverter
from app.services.fx.provider import FxRateProvider

# Where a session keeps the user and the answer the check gave for them, so every converter one request
# builds shares a single ask
_ANSWER_KEY = "foreign_currencies_answer"


async def _find_reason(db: AsyncSession, user_id: uuid.UUID) -> str | None:
    """Return the check's sentence for a user, asking once for the session"""
    answer = db.info.get(_ANSWER_KEY)
    if answer is None or answer[0] != user_id:
        answer = (user_id, await find_foreign_currencies_reason(user_id))
        db.info[_ANSWER_KEY] = answer
    return answer[1]


def build_user_fx_converter(
    db: AsyncSession,
    currency_exponents: dict[str, int],
    *,
    provider: FxRateProvider | None = None,
) -> FxConverter:
    """Return a converter that leaves out amounts in another currency while the installed check refuses them for the signed-in user

    The check is asked before the first conversion between currencies, and once for the request's
    session however many converters it builds. Outside a signed-in request nothing is asked and the
    converter converts

    Args:
        db: The request's session
        currency_exponents: Minor-unit exponents keyed by currency code
        provider: Optional FX provider implementation
    """
    user_id = current_user_id_ctx.get()
    find_withheld_reason = partial(_find_reason, db, user_id) if user_id is not None else None
    return FxConverter(provider=provider, currency_exponents=currency_exponents, find_withheld_reason=find_withheld_reason)
