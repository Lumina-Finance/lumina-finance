"""Compatibility module for budget route imports"""
import importlib
import sys

_budget_router_module = importlib.import_module("app.routes.budgets.router")

sys.modules[__name__] = _budget_router_module
