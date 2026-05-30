import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel

from app.schemas.fx import FxStatus
from app.schemas.transaction import TransactionResponse

RangeKind = Literal["WTD", "MTD", "QTD", "YTD"]


class CategoryBreakdownEntry(BaseModel):
    """One category's contribution to the spending/income breakdown widget.

    ``amount`` is a positive minor-unit total. Rows are sign-directed, while
    ``category_kind`` preserves the category's original income/expense kind.
    """

    category_id: uuid.UUID
    name: str
    category_kind: str
    amount: int


class SpendingBreakdownResponse(BaseModel):
    """Category-level expense and income totals for the given range.

    Both breakdowns are served in one payload so the widget's spending/income
    toggle can flip instantly without refetching. ``range`` picks the calendar
    period (WTD / MTD / QTD / YTD) — the boundaries match the spending
    comparison endpoint's current-period slots. Entries are sorted largest-
    first and compacted with an Other slice for the dashboard widget.
    ``expense_total`` and ``income_total`` are authoritative center totals
    after flipped refund/loss categories are netted against their original side.
    """

    range: RangeKind
    expense: list[CategoryBreakdownEntry]
    income: list[CategoryBreakdownEntry]
    expense_total: int
    income_total: int


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


class CreditWidgetResponse(BaseModel):
    """Credit usage totals for the dashboard credit widget.

    - `credit_limit_total` sums `credit_limit` across readable non-hidden
      revolving-credit accounts converted to the user's base currency when needed.
    - `credit_used` flips negative account balances into positive usage and
      treats positive stored-credit balances as zero used.
    - `fx_status` reports whether foreign-currency conversions were complete,
      incomplete, unavailable, or unnecessary.
    """

    credit_limit_total: int
    credit_used: int
    fx_status: FxStatus


class NetWorthWidgetResponse(BaseModel):
    """Net worth totals and trend for the dashboard net worth widget.

    - `current_net_worth` is the sum of latest signed balances across every readable
      non-hidden account converted to the user's base currency when needed.
    - `net_worth_history` is a day-by-day series of net worth over the last
      `net_worth_window_days` days (length = `net_worth_window_days`, index 0 =
      earliest day, final index = today). Forward-filled from
      `AccountBalanceSnapshot` rows so days without activity carry the previous
      day's balance.
    - `fx_status` reports whether foreign-currency conversions were complete,
      incomplete, unavailable, or unnecessary.
    """

    current_net_worth: int
    net_worth_history: list[int]
    net_worth_window_days: int
    fx_status: FxStatus


class SavingsRateWidgetResponse(BaseModel):
    """Savings-rate history for the dashboard savings-rate widget.

    `savings_rate_history` is a per-month series of raw income and expense
    totals covering the current (in-progress) calendar month plus the prior
    six months, ordered oldest-first. Foreign-currency account activity is
    converted to the user's base currency when needed. The rate itself is
    derived on the frontend so it can handle the three zero-income cases
    (real rate, ``-inf`` when expenses exist without income, ``0`` when both
    are zero) without having to serialize non-finite floats.
    `fx_status` reports whether conversions were complete, incomplete,
    unavailable, or unnecessary.
    """

    savings_rate_history: list[MonthlyIncomeExpense]
    fx_status: FxStatus


class RecentActivityWidgetResponse(BaseModel):
    """Recent transaction rows for the dashboard recent activity widget."""

    recent_transactions: list[TransactionResponse]
    transaction_window_days: int
