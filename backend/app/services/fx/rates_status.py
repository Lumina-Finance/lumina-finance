"""A digest of the recent exchange rates behind the converted figures a user has seen

A browser that kept converted totals compares the digest with the one it saved, and fetches the
totals again when it differs. Nothing is stored here, so a flushed or restarted store can't bring back an
old value, and the digest is worked out from the rates the cache already serves every other request
"""

import asyncio
import hashlib
import logging
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, TaxAdvantagedCategory
from app.models.budget import BaseBudget
from app.models.transaction import Transaction
from app.services.fx.errors import FxRateError
from app.services.fx.frankfurter_provider import FrankfurterProvider
from app.services.fx.provider import FxRateProvider
from app.services.fx.rate_cache import SETTLED_RATE_AGE, CachedFxRateProvider
from app.services.fx.used_pairs import get_used_pairs

logger = logging.getLogger(__name__)

# Every stored currency a figure is converted from or to, transactions last as the largest table. A user
# whose data holds no currency but their own needs no conversion, so an empty record of pairs is complete
# for them. A test fails when a model gains a currency column missing here
CONVERTED_CURRENCY_COLUMNS = (Account.currency, TaxAdvantagedCategory.currency, BaseBudget.currency, Transaction.currency)


async def holds_other_currencies(db: AsyncSession, base_currency: str, *, group_owned_only: bool = False) -> bool:
    """Return whether any row the user can see holds a currency other than their own, counting only recent transactions

    Args:
        db: Session scoped to the user by row-level security
        base_currency: The user's own currency
        group_owned_only: Count only rows a group owns, which convert even while amounts the user
            owns alone are left out. A transaction counts through its account

    Returns:
        True as soon as one such row is found
    """
    window_start, _today = _get_unsettled_window(datetime.now(UTC).date())
    for column in CONVERTED_CURRENCY_COLUMNS:
        query = select(column).where(column != base_currency)
        if column.class_ is Transaction:
            # An older transaction converts at a settled rate the digest never covers, and the date bound
            # keeps the read on the account and date index instead of every transaction the user sees
            query = query.where(Transaction.dt >= window_start)
            if group_owned_only:
                query = query.join(Account, Account.id == Transaction.account_id).where(Account.group_id.is_not(None))
        elif group_owned_only:
            query = query.where(column.class_.group_id.is_not(None))
        if await db.scalar(select(query.exists())):
            return True
    return False


# Longest one request waits for the rates, however many pairs there are. The browser asks after it
# has opened, so a slow provider costs a late refresh and never a held screen
RATES_STATUS_BUDGET_SECONDS = 4.0

type PairWindow = tuple[str, str, date, date]

# Reads under way, by pair and window, so every request asking while one runs waits for that one's
# answer instead of making a provider call of its own. A running read is not stopped when the
# request that started it gives up, so its rates still reach the cache for the next ask
_in_flight: dict[PairWindow, asyncio.Task[dict[date, Decimal]]] = {}


def _get_unsettled_window(today: date) -> tuple[date, date]:
    """Return the first and last dates whose rates the cache does not yet treat as fixed"""
    return today - SETTLED_RATE_AGE + timedelta(days=1), today


async def _read_rates(provider: FxRateProvider, window: PairWindow) -> dict[date, Decimal]:
    """Read one pair's rates for its window, sharing the read with every request already making it

    Raises:
        FxRateError: The provider could not give the rates
    """
    task = _in_flight.get(window)
    if task is None:
        task = asyncio.create_task(provider.get_rates(*window))
        _in_flight[window] = task
        task.add_done_callback(lambda finished: _finish_read(window, finished))

    # Shielded, so a waiting request that gives up leaves the read running for the others
    return await asyncio.shield(task)


def _finish_read(window: PairWindow, task: asyncio.Task[dict[date, Decimal]]) -> None:
    """Forget a finished read, and mark its failure as seen when every waiter has already left"""
    _in_flight.pop(window, None)
    if not task.cancelled() and task.exception() is not None:
        logger.info("An exchange rate status read failed with %s", type(task.exception()).__name__)


def _digest(pair_rates: list[tuple[PairWindow, dict[date, Decimal]]]) -> str:
    """Return a stable digest of the rates read for each pair, moved by a changed, added or lost rate"""
    # Each pair has a line of its own, so a pair with no rate in the window still moves the digest
    lines = [
        line
        for (base, quote, _start, _end), rates in pair_rates
        for line in (
            f"{base}/{quote}",
            *(f"{base}/{quote}|{rate_date.isoformat()}|{format(rate.normalize(), 'f')}" for rate_date, rate in sorted(rates.items())),
        )
    ]
    return hashlib.sha256("\n".join(lines).encode()).hexdigest()


async def get_rates_digest(
    user_id: UUID,
    *,
    holds_other_currencies: bool,
    withholds_conversion: bool = False,
    provider: FxRateProvider | None = None,
) -> str | None:
    """Return a digest of the unsettled rates for the pairs the server has converted for a user

    Args:
        user_id: User whose converted pairs to read
        holds_other_currencies: Whether any row the user sees holds a currency other than their
            own, so their figures need conversions
        withholds_conversion: Whether every amount in another currency the user sees is theirs
            alone and left out of their totals, so no rate was looked up for them and no pair
            recorded. False when a group-owned one remains, since that still converts
        provider: Source of rates the cache lacks, the usual provider when omitted

    Returns:
        The digest, or None when the store can't be read, the provider failed or reading took
        longer than the budget. The browser treats an unknown digest as changed. A user with no
        recorded pair who holds only their own currency gets the fixed digest of an empty set,
        equal between visits. One who holds others gets None, since their pairs may have expired
        or failed to record while their saved figures still depend on rates. One whose
        conversions are all withheld gets that same fixed digest, since their figures depend
        on no rate
    """
    pairs = await get_used_pairs(user_id)
    if pairs is None:
        return None
    if not pairs:
        return None if holds_other_currencies and not withholds_conversion else _digest([])

    provider = provider or CachedFxRateProvider(FrankfurterProvider())
    start, end = _get_unsettled_window(datetime.now(UTC).date())
    windows: list[PairWindow] = [(base, quote, start, end) for base, quote in pairs]
    try:
        async with asyncio.timeout(RATES_STATUS_BUDGET_SECONDS):
            results = await asyncio.gather(*(_read_rates(provider, window) for window in windows))
    except FxRateError, TimeoutError:
        return None
    return _digest(list(zip(windows, results, strict=True)))
