"""Compatibility module for account route imports"""
import importlib
import sys

_account_router_module = importlib.import_module("app.routes.accounts.router")

sys.modules[__name__] = _account_router_module
