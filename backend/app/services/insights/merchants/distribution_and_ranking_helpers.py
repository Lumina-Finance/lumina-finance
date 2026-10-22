"""Helpers for building merchant distribution and ranking rows"""

from app.services.insights.merchants.spend_stats_helpers import (
    MerchantSpendStats,
    MerchantSpendStatsById,
)

MERCHANT_DISTRIBUTION_LIMIT = 8
MERCHANT_RANKING_LIMIT = 10


MerchantDistributionRow = tuple[str, str, int, int | None]
MerchantRankingRow = tuple[str, str, int, int, int]


def get_merchant_distribution_rows(
    current_stats_by_id: MerchantSpendStatsById,
    previous_stats_by_id: MerchantSpendStatsById,
) -> list[MerchantDistributionRow]:
    """Return top merchant rows plus one Other row for remaining spend

    Args:
        current_stats_by_id: Selected-period merchant spend stats keyed by merchant ID
        previous_stats_by_id: Comparison-period merchant spend stats keyed by merchant ID

    Returns:
        Merchant distribution rows for the response
    """
    ranked_entries = sorted(
        current_stats_by_id.items(),
        key=lambda entry: (-entry[1].amount, entry[1].name),
    )
    visible_entries = ranked_entries[:MERCHANT_DISTRIBUTION_LIMIT]
    remaining_entries = ranked_entries[MERCHANT_DISTRIBUTION_LIMIT:]

    rows: list[MerchantDistributionRow] = []

    # Build visible merchant rows with comparison movement values
    for merchant_id, stats in visible_entries:
        previous_amount = previous_stats_by_id.get(merchant_id, MerchantSpendStats("", 0, 0)).amount
        rows.append(
            (
                str(merchant_id),
                stats.name,
                stats.amount,
                stats.amount - previous_amount,
            )
        )

    other_amount = sum(stats.amount for _merchant_id, stats in remaining_entries)
    if other_amount > 0:
        rows.append(("other-merchants", "Other", other_amount, None))

    return rows


def get_merchant_ranking_rows(
    current_stats_by_id: MerchantSpendStatsById,
    previous_stats_by_id: MerchantSpendStatsById,
) -> list[MerchantRankingRow]:
    """Return top merchant rows sorted by current spend

    Args:
        current_stats_by_id: Selected-period merchant spend stats keyed by merchant ID
        previous_stats_by_id: Comparison-period merchant spend stats keyed by merchant ID

    Returns:
        Merchant ranking rows for the response
    """
    ranked_entries = sorted(
        current_stats_by_id.items(),
        key=lambda entry: (-entry[1].amount, entry[1].name),
    )

    rows: list[MerchantRankingRow] = []

    # Build capped ranking rows with transaction counts and the comparison-period spend
    for merchant_id, stats in ranked_entries[:MERCHANT_RANKING_LIMIT]:
        previous_amount = previous_stats_by_id.get(merchant_id, MerchantSpendStats("", 0, 0)).amount
        rows.append(
            (
                str(merchant_id),
                stats.name,
                stats.amount,
                stats.transaction_count,
                previous_amount,
            )
        )
    return rows
