"""Transaction overview outlier conversion"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.fx import FxStatus
from app.schemas.transaction import OutlierTransaction
from app.services.fx import FxConverter
from app.services.transactions.overview.queries import (
    get_overview_outlier_details,
    get_overview_outlier_tied_rows,
)

# How many transactions the most expensive transactions panel has room for
OVERVIEW_OUTLIER_LIMIT = 3


def _rank_outlier_candidate(candidate) -> tuple[int, int, str]:
    """Order a converted candidate by its outflow, then the most recent date, then its identifier"""
    row, converted_amount = candidate
    return converted_amount, -row.date.toordinal(), str(row.id)


async def _convert_outlier_candidates(rows, converter: FxConverter, base_currency: str) -> list[tuple]:
    """Convert candidate rows to the base currency, leaving out those without a rate or an outflow"""
    converted_candidates = []
    for row in rows:
        converted_amount = await converter.convert_minor_units(
            int(row.amount),
            base=row.currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_amount is None or converted_amount >= 0:
            continue

        converted_candidates.append((row, converted_amount))
    return converted_candidates


async def _get_last_amount_at_outflow(row, outflow: int, converter: FxConverter, base_currency: str) -> int:
    """Return the largest amount that converts to the same outflow as a row, found by halving the amounts between"""

    async def convert(amount: int) -> int | None:
        return await converter.convert_minor_units(amount, base=row.currency, quote=base_currency, rate_date=row.date)

    amount = int(row.amount)
    if amount == -1 or await convert(amount + 1) != outflow:
        return amount
    if await convert(-1) == outflow:
        return -1

    # An amount nearer zero never converts to a larger outflow, so the amounts converting to this one run
    # unbroken. The lower end converts to it and the upper end does not
    low, high = amount + 1, -1
    while high - low > 1:
        middle = (low + high) // 2
        if await convert(middle) == outflow:
            low = middle
        else:
            high = middle
    return low


async def _get_tied_group_rows(
    db: AsyncSession,
    transaction_filters,
    *,
    converted_candidates: list[tuple],
    converter: FxConverter,
    base_currency: str,
) -> list:
    """Return the left-out rows of each group that could still take a place on the panel

    Left-out rows of a group convert to no larger an outflow than the group's last candidate row. They
    can take a place only when they land on the panel's last place outflow too, and then they rank by
    identifier. That happens when an earlier candidate of another amount lands there, or when a larger
    amount does, which a currency whose minor unit is worth less than the base currency's allows, such
    as a yen against a Canadian cent. Only as many of those rows as the panel has places can win, so the
    ones with the lowest identifiers are read

    Args:
        db: Active database session
        transaction_filters: SQLAlchemy filters shared by overview queries
        converted_candidates: Converted candidate rows, ranked best first
        converter: Request-scoped FX converter
        base_currency: User base currency used for overview metrics

    Returns:
        Rows to rank with the candidates, empty when no left-out row can take a place
    """
    if len(converted_candidates) < OVERVIEW_OUTLIER_LIMIT:
        return []
    last_place_outflow = converted_candidates[OVERVIEW_OUTLIER_LIMIT - 1][1]

    tied_rows = []
    for row, converted_amount in converted_candidates:
        if row.position != OVERVIEW_OUTLIER_LIMIT or row.group_size <= OVERVIEW_OUTLIER_LIMIT or converted_amount != last_place_outflow:
            continue

        group = [candidate for candidate, _ in converted_candidates if (candidate.currency, candidate.date) == (row.currency, row.date)]
        tied_amounts = {
            int(candidate.amount) for candidate, outflow in converted_candidates if candidate in group and outflow == last_place_outflow
        }
        last_amount = await _get_last_amount_at_outflow(row, last_place_outflow, converter, base_currency)
        if last_amount == int(row.amount) and tied_amounts == {int(row.amount)}:
            continue

        tied_rows += await get_overview_outlier_tied_rows(
            db,
            transaction_filters,
            currency=row.currency,
            group_date=row.date,
            read_ids=[candidate.id for candidate in group],
            last_amount=last_amount,
            limit=OVERVIEW_OUTLIER_LIMIT,
        )
    return tied_rows


async def convert_overview_outliers(
    *,
    db: AsyncSession,
    transaction_filters,
    outlier_candidate_rows,
    converter: FxConverter,
    base_currency: str,
) -> tuple[list[OutlierTransaction], FxStatus]:
    """Convert and rank overview outlier transactions

    Args:
        db: Active database session
        transaction_filters: SQLAlchemy filters shared by overview queries
        outlier_candidate_rows: Candidate transaction rows eligible for outlier ranking
        converter: Request-scoped FX converter
        base_currency: User base currency used for overview metrics

    Returns:
        Top converted outlier response rows and FX status for the conversion
    """
    # Convert candidate transactions so outliers can be ranked across account currencies
    converted_outlier_candidates = await _convert_outlier_candidates(outlier_candidate_rows, converter, base_currency)

    # Rank by each transaction's own converted outflow, so a purchase refunded later still counts.
    # Equal outflows go to the most recent, then to the identifier, because the database promises
    # no order of its own and the panel would otherwise change under a reload that changed no data.
    # The tie has to break here rather than in the query, which orders on amounts as stored: two
    # rows in different currencies can differ there and still land on one converted outflow
    converted_outlier_candidates.sort(key=_rank_outlier_candidate)
    tied_group_rows = await _get_tied_group_rows(
        db,
        transaction_filters,
        converted_candidates=converted_outlier_candidates,
        converter=converter,
        base_currency=base_currency,
    )
    if tied_group_rows:
        converted_outlier_candidates += await _convert_outlier_candidates(tied_group_rows, converter, base_currency)
        converted_outlier_candidates.sort(key=_rank_outlier_candidate)

    ranked = [row for row, _converted_amount in converted_outlier_candidates[:OVERVIEW_OUTLIER_LIMIT]]
    details_by_id = {detail.id: detail for detail in await get_overview_outlier_details(db, [row.id for row in ranked])} if ranked else {}

    # A transaction deleted since the candidates were read has no details, and leaves the panel
    ranked = [row for row in ranked if row.id in details_by_id]
    outliers = [
        OutlierTransaction(
            id=row.id,
            merchant_name=details_by_id[row.id].merchant_name,
            notes=details_by_id[row.id].notes,
            amount=int(row.amount),
            currency=row.currency,
            dt=row.date,
        )
        for row in ranked
    ]
    return outliers, converter.get_status()
