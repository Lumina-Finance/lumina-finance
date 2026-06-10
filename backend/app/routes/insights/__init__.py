"""Insights route module"""

from datetime import datetime

from app.routes.insights.router import (
    get_cash_flow_route,
    get_fund_flow_route,
    get_income_expense_breakdown_route,
    get_merchant_distribution_route,
    get_merchant_ranking_route,
    get_merchants_route,
    get_net_worth_route,
    get_period_at_a_glance_route,
    get_savings_rate_trend_route,
    router,
)

__all__ = [
    "datetime",
    "get_cash_flow_route",
    "get_fund_flow_route",
    "get_income_expense_breakdown_route",
    "get_merchant_distribution_route",
    "get_merchant_ranking_route",
    "get_merchants_route",
    "get_net_worth_route",
    "get_period_at_a_glance_route",
    "get_savings_rate_trend_route",
    "router",
]
