"""Finds the bank provider adapters installed as subpackages of the providers package

A provider is one folder under providers, named after its provider id. Its package exports its
adapter class as ADAPTER. Deleting the folder removes the provider: connections made through it stay
readable under their stored provider id and sync nothing
"""

import importlib
import logging
import pkgutil
import re
from functools import cache

from app.config.bank_sync import read_provider_settings
from app.services.bank_sync import providers
from app.services.bank_sync.providers.contract import ProviderAdapter

logger = logging.getLogger(__name__)

# The provider columns' check holds every stored id to the same form (models/bank_connection.py)
PROVIDER_ID_PATTERN = re.compile(r"[a-z][a-z0-9_]*")


@cache
def load_adapters() -> dict[str, type[ProviderAdapter]]:
    """Return the adapter class of every provider installed, by provider id, importing each once

    A folder that can't be imported, or exports no ADAPTER, is logged as an error and skipped, so a
    provider left half deleted doesn't stop the app. A setting the provider refuses as it loads
    still stops startup

    Raises:
        RuntimeError: An adapter's id doesn't match its folder's name or the stored id's form, or a
            provider refuses one of its settings
    """
    adapters: dict[str, type[ProviderAdapter]] = {}
    for module in sorted(pkgutil.iter_modules(providers.__path__), key=lambda found: found.name):
        if not module.ispkg:
            continue
        try:
            adapter = importlib.import_module(f"{providers.__name__}.{module.name}").ADAPTER
        except ImportError, AttributeError:
            logger.exception("Skipped the bank provider in providers/%s: it couldn't be loaded", module.name)
            continue
        if not (isinstance(adapter, type) and issubclass(adapter, ProviderAdapter)):
            logger.error("Skipped the bank provider in providers/%s, whose ADAPTER isn't a provider adapter", module.name)
            continue
        if adapter.provider_id != module.name or not PROVIDER_ID_PATTERN.fullmatch(adapter.provider_id):
            raise RuntimeError(
                f"The bank provider in providers/{module.name} has the id {adapter.provider_id!r}. It must match its folder's name, "
                "in lowercase letters, digits and underscores, starting with a letter"
            )
        adapters[adapter.provider_id] = adapter
    return adapters


def run_startup_checks() -> None:
    """Load every installed provider, read its switches and run its startup check, as the app and the bank sync worker each do as they start

    Raises:
        RuntimeError: A provider refuses one of its settings, a switch isn't true or false, or an id is malformed
    """
    for provider_id, adapter in load_adapters().items():
        read_provider_settings(provider_id)
        adapter.on_startup()
