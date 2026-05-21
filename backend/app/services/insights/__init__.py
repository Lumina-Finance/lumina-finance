"""Public service entrypoints for insights card endpoints."""

from app.services.insights.cash_flow import get_cash_flow
from app.services.insights.fund_flow import get_fund_flow
from app.services.insights.income_expense_breakdown import get_income_expense_breakdown
from app.services.insights.merchant_distribution import get_merchant_distribution
from app.services.insights.merchant_ranking import get_merchant_ranking
from app.services.insights.net_worth import get_net_worth
from app.services.insights.period_glance import get_period_glance
from app.services.insights.savings_rate_trend import get_savings_rate_trend

__all__ = [
    "get_cash_flow",
    "get_fund_flow",
    "get_income_expense_breakdown",
    "get_merchant_distribution",
    "get_merchant_ranking",
    "get_net_worth",
    "get_period_glance",
    "get_savings_rate_trend",
]
