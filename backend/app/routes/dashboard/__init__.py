"""Dashboard route module"""

from datetime import datetime

from app.routes.dashboard.router import (
    get_credit_widget_route,
    get_net_worth_widget_route,
    get_recent_activity_widget_route,
    get_savings_rate_widget_route,
    get_spending_breakdown_route,
    get_spending_comparison_route,
    router,
)

__all__ = [
    "datetime",
    "get_credit_widget_route",
    "get_net_worth_widget_route",
    "get_recent_activity_widget_route",
    "get_savings_rate_widget_route",
    "get_spending_breakdown_route",
    "get_spending_comparison_route",
    "router",
]
