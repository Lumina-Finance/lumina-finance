import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.transaction import TransactionResponse

RangeKind = Literal["WTD", "MTD", "QTD", "YTD"]


class CategoryBreakdownEntry(BaseModel):
    """One category's contribution to the spending/income breakdown widget.

    ``amount`` is a positive minor-unit total — expense rows are flipped so
    the frontend can render both kinds with the same tooltip format.
    """

    category_id: uuid.UUID
    name: str
    amount: int


class SpendingBreakdownResponse(BaseModel):
    """Category-level expense and income totals for the given range.

    Both breakdowns are served in one payload so the widget's spending/income
    toggle can flip instantly without refetching. ``range`` picks the calendar
    period (WTD / MTD / QTD / YTD) — the boundaries match the spending
    comparison endpoint's current-period slots. Entries are sorted largest-
    first and include only categories with non-zero totals in the range.
    """

    range: RangeKind
    expense: list[CategoryBreakdownEntry]
    income: list[CategoryBreakdownEntry]


class SpendingComparisonResponse(BaseModel):
    """Current-period vs. prior-period cumulative expense series for the spending widget.

    ``slot_labels`` spans the full current period (7 days for WTD, N days
    for MTD where N = current month's length, all weeks of the current
    quarter for QTD, 12 months for YTD) and drives the chart's x-axis.

    ``current`` / ``previous`` are cumulative positive minor-unit totals in
    the user's base currency (expense-kind transactions on base-currency
    accounts only). They contain only the slots with real data — ``current``
    stops at today, and ``previous`` stops at the prior period's last day
    (so it can be shorter than ``current`` for MTD when the prior month had
    fewer days, or up to ``len(slot_labels)`` otherwise). The frontend zips
    by index and treats missing trailing entries as no data.
    """

    range: RangeKind
    slot_labels: list[str]
    current: list[int]
    previous: list[int]


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

    recurring_expenses_estimate: int | None
    savings_rate_history: list[MonthlyIncomeExpense]

    upcoming_bills: list[dict] | None = None
    runway_months: float | None = None

    recent_transactions: list[TransactionResponse]
    active_budgets: list[ActiveBudgetSummary]
    transaction_window_days: int
