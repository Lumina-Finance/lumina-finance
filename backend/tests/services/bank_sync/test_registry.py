"""Finding the bank providers installed as folders

Deleting a provider's folder has to leave the app working, so a folder left half deleted is skipped
with an error in the log rather than stopping startup. An id that doesn't match its folder would
store connections no install could find again, so that stops startup
"""

import logging
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

from app.services.bank_sync import providers
from app.services.bank_sync.providers.registry import load_adapters

_ADAPTER_SOURCE = """
from tests.services.bank_sync.fake_provider import FakeProviderAdapter


class Adapter(FakeProviderAdapter):
    provider_id = {provider_id!r}


ADAPTER = Adapter
"""


@pytest.fixture
def providers_folder(tmp_path, monkeypatch) -> Iterator[Path]:
    """Point the providers package at an empty folder for the test, reading it afresh and forgetting what it imported afterwards"""
    monkeypatch.setattr(providers, "__path__", [str(tmp_path)])
    load_adapters.cache_clear()
    yield tmp_path
    load_adapters.cache_clear()
    for name in [name for name in sys.modules if name.startswith(f"{providers.__name__}.") and name.split(".")[-1] in _folders(tmp_path)]:
        del sys.modules[name]


def _folders(root: Path) -> set[str]:
    """Return the names of the folders and modules in the providers folder"""
    return {path.stem for path in root.iterdir()}


def _add_provider(root: Path, folder: str, source: str) -> None:
    """Add a provider folder whose package holds the source"""
    (root / folder).mkdir()
    (root / folder / "__init__.py").write_text(source)


def test_a_half_deleted_folder_is_skipped_and_logged_while_the_rest_load(providers_folder, caplog):
    """A folder missing its adapter module, or exporting no ADAPTER, is left out with an error, and a whole provider still loads"""
    _add_provider(providers_folder, "good_bank", _ADAPTER_SOURCE.format(provider_id="good_bank"))
    _add_provider(providers_folder, "half_gone", "from .adapter import Adapter\n\nADAPTER = Adapter\n")
    _add_provider(providers_folder, "no_adapter", "")
    (providers_folder / "contract_like.py").write_text("ADAPTER = None\n")

    with caplog.at_level(logging.ERROR):
        adapters = load_adapters()

    assert list(adapters) == ["good_bank"]
    assert [record.getMessage() for record in caplog.records] == [
        "Skipped the bank provider in providers/half_gone: it couldn't be loaded",
        "Skipped the bank provider in providers/no_adapter: it couldn't be loaded",
    ]


def test_no_provider_folder_leaves_no_provider(providers_folder):
    """A server with every provider folder deleted has no providers, and loading still succeeds"""
    assert load_adapters() == {}


@pytest.mark.parametrize(
    ("folder", "provider_id"),
    [("lunar_bank", "solar_bank"), ("Lunar", "Lunar")],
    ids=["other-folders-name", "capitals"],
)
def test_an_id_unlike_its_folder_or_the_stored_form_stops_startup(providers_folder, folder, provider_id):
    """Connections are stored under the id, so one that a folder name can't carry or the column refuses stops the app starting"""
    _add_provider(providers_folder, folder, _ADAPTER_SOURCE.format(provider_id=provider_id))

    with pytest.raises(RuntimeError, match=f"The bank provider in providers/{folder} has the id"):
        load_adapters()
