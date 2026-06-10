"""Public service entrypoints for cash-flow insights"""

from app.services.insights.cash_flow.service import get_cash_flow

__all__ = ["get_cash_flow"]
