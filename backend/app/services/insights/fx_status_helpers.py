"""Helpers for combining FX conversion statuses across insight periods"""

from app.schemas.fx import FxRateIssue, FxStatus


def get_combined_fx_status(current_status: FxStatus, previous_status: FxStatus) -> FxStatus:
    """Return one FX status for selected and comparison period calculations

    Args:
        current_status: FX status from the selected period
        previous_status: FX status from the comparison period

    Returns:
        Combined FX status with duplicate missing pairs removed
    """
    if current_status.state == "none":
        return previous_status
    if previous_status.state == "none":
        return current_status

    missing_pairs = _get_unique_missing_pairs((current_status, previous_status))
    if not missing_pairs:
        fx_status = FxStatus(state="complete")
        return fx_status

    state = "unavailable" if current_status.state == previous_status.state == "unavailable" else "incomplete"
    fx_status = FxStatus(state=state, missing_pairs=missing_pairs)
    return fx_status


def _get_unique_missing_pairs(statuses: tuple[FxStatus, ...]) -> list[FxRateIssue]:
    """Return missing currency pairs without duplicates

    Args:
        statuses: FX statuses to merge in response order

    Returns:
        Missing currency pairs with the first occurrence of each pair kept
    """
    missing_pairs: list[FxRateIssue] = []
    seen_pairs = set()

    # Keep first occurrence of each missing pair so response order stays deterministic
    for status in statuses:
        for pair in status.missing_pairs:
            key = (pair.base, pair.quote)
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            missing_pairs.append(pair)

    return missing_pairs
