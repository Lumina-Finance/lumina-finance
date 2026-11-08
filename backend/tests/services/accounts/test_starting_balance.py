import ast
import inspect

from app.services.accounts import starting_balance


def test_starting_balance_service_imports_nothing_from_routes():
    """Services sit below routes, so the service that records a starting balance must not import one"""
    imported = [
        node.module for node in ast.walk(ast.parse(inspect.getsource(starting_balance))) if isinstance(node, ast.ImportFrom) and node.module
    ]

    assert [module for module in imported if module.startswith("app.routes")] == []
