"""Public service entrypoints for the insights income/expense breakdown card"""

from app.services.insights.income_expense_breakdown.service import get_income_expense_breakdown

__all__ = ["get_income_expense_breakdown"]
