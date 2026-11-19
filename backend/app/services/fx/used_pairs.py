"""The currency pairs the server has converted for each user, kept in ValKey

Recorded by the converter as it works, so the check of whether a user's converted figures are out of
date needs no list of pairs kept in step with the code that converts. With no store nothing is
recorded, and what is recorded is only a hint of what to check, so losing it costs nothing but that check
"""

import time
from datetime import timedelta
from uuid import UUID

from app.database import current_user_id_ctx
from app.valkey_store import get_valkey

# How long a pair stays recorded after its last conversion. Each pair is scored by that time and a
# read drops the pairs older than this, so a currency dropped from every account stops costing provider
# calls even while the user keeps converting other pairs. The key expires after the same time, so the
# record of a user who stops converting altogether goes too
USED_PAIR_TTL = timedelta(days=30)

# Changing how the key or members are written starts the record clean without a flush
_KEY_VERSION = "v2"


def _key(user_id: UUID) -> str:
    """Return the key one user's pairs are stored under"""
    return f"fx-pairs:{_KEY_VERSION}:{user_id}"


def _now() -> float:
    """Return the current time in seconds since the epoch"""
    return time.time()


async def record_used_pair(base: str, quote: str) -> None:
    """Record that the signed-in user's request converted a pair

    Does nothing outside a request or without a store, and a store failure is skipped

    Args:
        base: Normalized source currency code
        quote: Normalized target currency code
    """
    user_id = current_user_id_ctx.get()
    store = get_valkey()
    if user_id is None or store is None:
        return
    await store.add_to_scored_set(_key(user_id), f"{base}/{quote}", _now(), USED_PAIR_TTL)


async def get_used_pairs(user_id: UUID) -> list[tuple[str, str]] | None:
    """Return the pairs converted within the expiry for a user, in a fixed order

    Pairs last converted earlier are removed from the record

    Args:
        user_id: User whose pairs to read

    Returns:
        Base and quote of each pair, empty when none is recorded, or None when there is no store
        or it can't be read
    """
    store = get_valkey()
    if store is None:
        return None
    members = await store.get_scored_set(_key(user_id), min_score=_now() - USED_PAIR_TTL.total_seconds())
    if members is None:
        return None
    return sorted((base, quote) for base, quote in (member.split("/") for member in members))
