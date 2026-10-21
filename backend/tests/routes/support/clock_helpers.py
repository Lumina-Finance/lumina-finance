"""Shared clock helpers for tests of the future-date cutoff"""

import importlib
from datetime import UTC, date, datetime

# The default test user's profile zone is America/Toronto, where this instant is 23:30 on June 9
# In UTC and in any zone ahead of Toronto it is already June 10, so a cutoff taken from the server
# clock or the browser's zone lets June 10 through and a cutoff taken from the profile does not
PROFILE_LATE_EVENING = datetime(2026, 6, 10, 3, 30, tzinfo=UTC)
PROFILE_TODAY = date(2026, 6, 9)
PROFILE_TOMORROW = date(2026, 6, 10)


def freeze_profile_clock(freeze_now, moment: datetime = PROFILE_LATE_EVENING) -> None:
    """Freeze every clock the account, insights and dashboard cutoffs read

    Args:
        freeze_now: The ``freeze_now`` fixture
        moment: Instant the clocks answer
    """
    from app.routes import dashboard as dashboard_routes
    from app.routes import insights as insights_routes
    from app.routes.users import date_helpers

    # The package attribute named router is the APIRouter, so the module is imported by path
    account_routes = importlib.import_module("app.routes.accounts.router")

    for module in (date_helpers, insights_routes, dashboard_routes, account_routes):
        freeze_now(module, moment)
