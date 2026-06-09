"""Compatibility module for base budget route imports"""
import importlib
import sys

_base_budget_router_module = importlib.import_module("app.routes.base_budgets.router")

sys.modules[__name__] = _base_budget_router_module
