"""Asking the installed allowance check about records in a currency other than the user's main one, before adding one or changing one held"""

import hashlib
import uuid
from collections.abc import Iterable
from typing import Protocol

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.allowance_hook import AllowanceKind
from app.models.user import User
from app.services.allowance.require import find_feature_refusal, is_asked_about, require_feature

# Hex digits of the digest the browser compares, so a clash between two different sentences is vanishingly unlikely
TOKEN_LENGTH = 16

# Where a session keeps the user and the answer the check gave for them, so every question one request
# or job asks about the user's records shares a single ask
_ANSWER_KEY = "foreign_currencies_answer"


class CurrencyRecord(Protocol):
    """A record held in one currency, owned by its user alone or through a group: an account, a recurring budget or a tax-advantaged category"""

    currency: str
    group_id: uuid.UUID | None


def is_other_currency(base_currency: str, currency: str, group_id: uuid.UUID | None) -> bool:
    """Return whether a record's currency is one the check is asked about: another than the user's main one, on a record the user owns alone

    The one place deciding which records the check's answer about other currencies reaches
    """
    return is_asked_about(group_id) and currency.upper() != base_currency.upper()


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
    if not is_other_currency(base_currency, currency, group_id):
        return
    await require_feature(user_id, AllowanceKind.FOREIGN_CURRENCIES)


async def find_foreign_currencies_reason(user_id: uuid.UUID) -> str | None:
    """Return the sentence the installed check gives when it refuses records in another currency, or None when it allows them

    Args:
        user_id: The user holding the records
    """
    refusal = await find_feature_refusal(user_id, AllowanceKind.FOREIGN_CURRENCIES)
    return refusal.reason if refusal is not None else None


async def find_session_foreign_currencies_reason(db: AsyncSession, user_id: uuid.UUID) -> str | None:
    """Return the check's sentence refusing records in another currency, asking once for the session however often it is called

    Args:
        db: The request's or job's session
        user_id: The user holding the records
    """
    answer = db.info.get(_ANSWER_KEY)
    if answer is None or answer[0] != user_id:
        answer = (user_id, await find_foreign_currencies_reason(user_id))
        db.info[_ANSWER_KEY] = answer
    return answer[1]


async def find_read_only_reason(db: AsyncSession, user: User, record: CurrencyRecord) -> str | None:
    """Return why a record the user holds is read-only, the check's sentence, or None when it can change

    A record in the user's main currency, or owned through a group, is never asked about

    Args:
        db: The request's session
        user: The signed-in user
        record: The record about to change or be shown
    """
    if not is_other_currency(user.base_currency, record.currency, record.group_id):
        return None
    return await find_session_foreign_currencies_reason(db, user.id)


async def require_writable_record(db: AsyncSession, user: User, record: CurrencyRecord) -> None:
    """Refuse a change to a record held in a currency the check refuses the user, or anything added to it

    Deleting and archiving such a record never asks, so its user can always put it away

    Raises:
        HTTPException 403: The record is read-only, with the check's sentence as the detail
    """
    reason = await find_read_only_reason(db, user, record)
    if reason is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=reason)


async def attach_read_only_reasons(db: AsyncSession, user: User, records: Iterable[CurrencyRecord]) -> None:
    """Set each record's `read_only_reason` for its response, asking the check at most once

    Args:
        db: The request's session
        user: The signed-in user receiving the response
        records: The accounts, recurring budgets or tax-advantaged categories about to be sent
    """
    for record in records:
        record.read_only_reason = await find_read_only_reason(db, user, record)


async def find_foreign_currencies_token(user_id: uuid.UUID) -> str | None:
    """Return a short digest of the refusal's sentence, or None when the check allows records in another currency

    Args:
        user_id: The user holding the records
    """
    reason = await find_foreign_currencies_reason(user_id)
    if reason is None:
        return None
    return hashlib.sha256(reason.encode()).hexdigest()[:TOKEN_LENGTH]
