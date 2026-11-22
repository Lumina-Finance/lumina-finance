"""Installing an allowance check that refuses, as code built on the app would"""

from collections.abc import Collection

from app.allowance_hook import AllowanceKind, AllowanceRequest, Refusal, set_allowance_check

# The sentence a refusing check gives
ALLOWANCE_REASON = "This server allows no more of these"


def install_check(
    *, refused: Collection[AllowanceKind] = (), maximum: int | None = None, reason: str = ALLOWANCE_REASON
) -> list[AllowanceRequest]:
    """Install a check refusing every request of the kinds in refused, and a record request that would take its holdings past the maximum

    Args:
        refused: The kinds refused whatever the user holds
        maximum: The most of a record kind a user may hold
        reason: The sentence a refusal gives

    Returns:
        The requests the check is asked, filled as they come in
    """
    asked: list[AllowanceRequest] = []

    async def check(request: AllowanceRequest) -> Refusal | None:
        asked.append(request)
        over_maximum = maximum is not None and request.held is not None and request.held + request.adding > maximum
        return Refusal(reason) if request.kind in refused or over_maximum else None

    set_allowance_check(check)
    return asked
