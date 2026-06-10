"""Public service entrypoints for the insights net worth card"""

from app.services.insights.net_worth.service import get_net_worth

__all__ = ["get_net_worth"]
