import uuid
from datetime import date, datetime

from pydantic import BaseModel

from app.schemas.transaction import TransactionResponse


class MonthlyIncomeExpense(BaseModel):
    """One entry in the savings-rate history — raw totals for a single calendar month.

    Carries the absolute values of income and expenses so the frontend can
    derive the rate and distinguish the three zero-income cases (real rate,
    ``-inf`` when expenses exist without income, ``0`` when both are zero).
    """

    month: date
    income: int
    expenses: int


class ActiveBudgetSummary(BaseModel):
    """Slim per-budget payload for the dashboard's active budgets widget.

    Carries only what the widget renders: budget identity, period bounds,
    overall limit, and total spent so far. Per-category breakdowns live on
    `GET /budgets/{id}/utilization` — the dashboard doesn't need them.
    """

    budget_id: uuid.UUID
    base_budget_id: uuid.UUID
    name: str
    currency: str
    period_start: datetime
    period_end: datetime
    overall_limit: int
    total_spent: int


class DashboardResponse(BaseModel):
    """Aggregated payload for `GET /dashboard`.

    Bundles every widget the dashboard landing page renders in one round trip.
    Individual sub-queries mirror the scoping logic used by the list endpoints
    (`list_accounts`, `list_transactions`, `list_budgets`) so the dashboard
    respects the same permission rules without reissuing per-resource checks.

    Net worth widget:
    - `current_net_worth` is the sum of latest balances across every accessible
      account in the user's base currency, with liability balances subtracted.
    - `net_worth_history` is a day-by-day series of net worth over the last
      `net_worth_window_days` days (length = `net_worth_window_days`, index 0 =
      earliest day, final index = today). Forward-filled from
      `AccountBalanceSnapshot` rows so days without activity carry the previous
      day's balance.

    Credit widget:
    - `credit_limit_total` sums `credit_limit` across accessible liability
      accounts in the user's base currency that have a limit set.
    - `credit_used` is the absolute value of the current outstanding balance on
      those same accounts (liability balances are stored as negatives).

    Spending comparison fields:
    - `current_month_cumulative` is a day-by-day cumulative expense total for
      the current calendar month (index 0 = day 1). Length = today's
      day-of-month, so the frontend draws a line from day 1 up to today.
    - `historical_avg_cumulative` is the average cumulative expense curve
      across up to six complete prior months (index 0 = day 1). Length = days
      in the current month, so it aligns on the same x-axis and extends to
      month-end. `None` when the user has no complete prior months with
      expenses in their base currency.
    - `historical_months_averaged` is the number of prior months that
      contributed to the average (0 when None, else 1-6). Lets the frontend
      label the comparison line (e.g. "3-month average").

    Recurring / savings rate:
    - `recurring_expenses_estimate` is reserved for an estimated monthly total
      of recurring expenses over the trailing three months. Ships as `None`
      until the `ScheduledTransaction` model lands.
    - `savings_rate_history` is a per-month series of raw income and expense
      totals covering the current (in-progress) calendar month plus the prior
      six months, ordered oldest-first. Base-currency accounts only. The rate
      itself is derived on the frontend so it can handle the three zero-income
      cases (real rate, ``-inf`` when expenses exist without income, ``0``
      when both are zero) without having to serialize non-finite floats.

    Spending, credit, and savings fields sum only activity on accounts whose
    currency matches the user's base currency; foreign-currency activity is
    excluded until fx data is connected.
    """

    current_net_worth: int
    net_worth_history: list[int]
    net_worth_window_days: int

    credit_limit_total: int
    credit_used: int

    current_month_cumulative: list[int]
    historical_avg_cumulative: list[int] | None
    historical_months_averaged: int

    recurring_expenses_estimate: int | None
    savings_rate_history: list[MonthlyIncomeExpense]

    upcoming_bills: list[dict] | None = None
    runway_months: float | None = None

    recent_transactions: list[TransactionResponse]
    active_budgets: list[ActiveBudgetSummary]
    transaction_window_days: int
