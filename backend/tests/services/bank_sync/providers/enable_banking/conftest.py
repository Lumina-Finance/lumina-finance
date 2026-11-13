"""Skips Enable Banking's tests when its provider folder is deleted

Deleting the provider's folder removes Enable Banking from the app, so its own tests go with it
"""

from app.services.bank_sync.providers.registry import load_adapters

if "enable_banking" not in load_adapters():
    collect_ignore_glob = ["*.py"]
