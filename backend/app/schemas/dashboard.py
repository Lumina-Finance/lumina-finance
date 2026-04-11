from pydantic import BaseModel

from app.schemas.account import AccountsOverview
from app.schemas.budget import BudgetResponse
from app.schemas.transaction import TransactionResponse


class DashboardResponse(BaseModel):
    """Aggregated payload for `GET /dashboard`.

    Bundles everything the dashboard landing page renders in one round trip:
    account cards, the recent activity widget, and the active-budget widget.
    ``transaction_window_days`` echoes the window the route used so the frontend
    can label the recent-activity section without guessing.

    ``accounts`` uses the trimmed ``AccountsOverview`` shape (same as the
    ``/accounts`` page) because the dashboard renders cards, not full detail.
    TODO: upcoming bills and runway calculations are missing.
    """

    accounts: list[AccountsOverview]
    recent_transactions: list[TransactionResponse]
    active_budgets: list[BudgetResponse]
    transaction_window_days: int
