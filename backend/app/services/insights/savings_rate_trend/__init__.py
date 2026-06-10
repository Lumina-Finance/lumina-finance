"""Public service entrypoints for savings-rate trend insights"""

from app.services.insights.savings_rate_trend.service import get_savings_rate_trend

__all__ = ["get_savings_rate_trend"]
