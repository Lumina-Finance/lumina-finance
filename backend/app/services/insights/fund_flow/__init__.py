"""Public service entrypoints for fund-flow insights"""

from app.services.insights.fund_flow.service import get_fund_flow

__all__ = ["get_fund_flow"]
