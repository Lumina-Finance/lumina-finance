"""Skips SimpleFIN's tests when its provider folder is deleted, and otherwise serves it through the fake SimpleFIN Bridge

Its route tests share the route tests' client, clock and mailbox
"""

from app.services.bank_sync.providers.registry import load_adapters

# Deleting the provider's folder removes SimpleFIN from the app, so its own tests go with it
if "simplefin" not in load_adapters():
    collect_ignore_glob = ["*.py"]
else:
    from tests.routes.conftest import captured_email, client, pin_clock
    from tests.services.bank_sync.providers.simplefin.fixtures import scenario, simplefin_reaches_the_fake_bridge

    __all__ = ["captured_email", "client", "pin_clock", "scenario", "simplefin_reaches_the_fake_bridge"]
