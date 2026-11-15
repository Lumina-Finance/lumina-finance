"""Skips Akahu's tests when its provider folder is deleted

Deleting the provider's folder removes Akahu from the app, so its own tests go with it. Its route
tests share the route tests' client
"""

from app.services.bank_sync.providers.registry import load_adapters

if "akahu" not in load_adapters():
    collect_ignore_glob = ["*.py"]
else:
    from tests.routes.conftest import captured_email, client

    __all__ = ["captured_email", "client"]
