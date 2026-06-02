"""Compatibility entrypoint for the insights merchant ranking card."""

from app.services.insights.merchants import get_merchant_ranking

__all__ = ["get_merchant_ranking"]
