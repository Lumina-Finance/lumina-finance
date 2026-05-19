"""Public service entrypoints for insights card endpoints."""

from app.services.insights.income_expense_breakdown import get_income_expense_breakdown
from app.services.insights.income_expense_flow import get_income_expense_flow
from app.services.insights.net_worth import get_net_worth
from app.services.insights.period_glance import get_period_glance
from app.services.insights.savings_rate_trend import get_savings_rate_trend

__all__ = [
    "get_income_expense_breakdown",
    "get_income_expense_flow",
    "get_net_worth",
    "get_period_glance",
    "get_savings_rate_trend",
]
