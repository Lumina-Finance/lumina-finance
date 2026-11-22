"""The app's start-up as separate steps, and the switch for the cleanup timer

The lifespan is checked for the order of its steps, a failing check stopping it, and the cleanup timer
switch. The cache connection, the database key check and the sign-in provider seeding are also run alone
through app.extension, as code outside the app runs them. Inside the lifespan the steps are replaced by
recorders, since those tests are about what is run, in which order and when
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app import extension, main, startup
from app import valkey_store as store_module
from app.config.env import require
from app.db import database_keys
from app.services.fx import rate_cache
from app.services.fx.rate_cache import CachedFxRateProvider
from app.services.maintenance import expired_records
from app.valkey_store import ValkeyStore, get_valkey
from tests.services.fx.fakes import FakeProvider

# A date well before the day the cache counts as settled, so the test does not depend on today's date
_NOW = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
_DAY = date(2026, 3, 10)
_RATE = Decimal("1.37")


@pytest.fixture
def events(monkeypatch) -> list[str]:
    """Replace each start-up step the lifespan runs and the cleanup with a recorder, returning what ran in order"""
    events: list[str] = []

    def say(name: str) -> None:
        # The cache opens after every check, so a step that finds it open ran in the wrong place
        events.append(name if get_valkey() is None else f"{name} with the cache open")

    def recorder(name: str):
        async def record(*_args) -> None:
            # Yields once, so a timer started too early would run and show before the steps after it
            await asyncio.sleep(0)
            say(name)

        return record

    def record_bank_provider_checks() -> None:
        say("bank provider checks")

    monkeypatch.setattr(main, "verify_app_role_is_unprivileged", recorder("database role"))
    monkeypatch.setattr(main, "verify_database_keys", recorder("database keys"))
    monkeypatch.setattr(main, "sync_sign_in_providers", recorder("sign-in providers"))
    monkeypatch.setattr(main, "run_startup_checks", record_bank_provider_checks)

    async def record_cleanup(*_args) -> None:
        events.append("cleanup")

    monkeypatch.setattr(expired_records, "prune_expired_records", record_cleanup)
    monkeypatch.setattr(store_module, "VALKEY_URL", require("TEST_VALKEY_URL"))
    return events


async def test_the_default_start_up_runs_every_step_in_order_and_cleans_up_at_once(events, monkeypatch):
    """An install that changes nothing checks, seeds, opens the cache and prunes as it always has, and stops the timer before the cache"""
    tasks_before = len(asyncio.all_tasks())
    close_cache = ValkeyStore.aclose

    async def close_and_say(store: ValkeyStore) -> None:
        events.append("cache closed" if len(asyncio.all_tasks()) == tasks_before else "cache closed with the timer running")
        await close_cache(store)

    monkeypatch.setattr(ValkeyStore, "aclose", close_and_say)

    async with main._lifespan(main.app):
        assert isinstance(get_valkey(), ValkeyStore), "the cache is open while the app runs"

        # One turn of the loop lets the timer task the lifespan created start
        await asyncio.sleep(0)
        assert events == ["database role", "database keys", "sign-in providers", "bank provider checks", "cleanup"]

    assert events[-1] == "cache closed", "the timer stops first and the cache closes after it"
    assert get_valkey() is None, "the cache is gone with the app"
    assert len(asyncio.all_tasks()) == tasks_before, "the timer stops with the app"


@pytest.mark.parametrize(
    ("step", "ran_before_it"),
    [("verify_app_role_is_unprivileged", []), ("verify_database_keys", ["database role"])],
)
async def test_a_failing_check_stops_the_app_before_anything_else_starts(events, monkeypatch, step, ran_before_it):
    """A refused role or key keeps the app from starting: no later step runs, no cache opens and no cleanup begins"""
    tasks_before = len(asyncio.all_tasks())

    async def refuse(*_args) -> None:
        raise RuntimeError("refused")

    monkeypatch.setattr(main, step, refuse)

    with pytest.raises(RuntimeError, match="refused"):
        async with main._lifespan(main.app):
            pytest.fail("the app started")

    assert events == ran_before_it
    assert get_valkey() is None
    assert len(asyncio.all_tasks()) == tasks_before


async def test_turning_the_cleanup_timer_off_starts_the_app_with_no_cleanup_of_its_own(events, monkeypatch, caplog):
    """The app still checks and opens the cache, no pass runs at the start or later while it serves, and the log says the timer is off"""
    # Recorded first, so monkeypatch puts the flag back when the test ends and no later test starts with the timer off
    monkeypatch.setattr(expired_records, "_is_cleanup_timer_enabled", True)
    extension.set_cleanup_timer_enabled(False)
    tasks_before = len(asyncio.all_tasks())

    with caplog.at_level(logging.INFO, logger=expired_records.logger.name):
        async with main._lifespan(main.app):
            assert isinstance(get_valkey(), ValkeyStore), "the cache is still open"

            # Turns of the loop for a timer task to start in if the switch did not leave it out
            for _ in range(3):
                await asyncio.sleep(0)
            assert events == ["database role", "database keys", "sign-in providers", "bank provider checks"]
            assert len(asyncio.all_tasks()) == tasks_before, "no timer task exists"

    assert get_valkey() is None
    assert "The cleanup timer is off, so expired records wait for prune_expired_records" in caplog.messages


@pytest.mark.parametrize("value", ["false", 0, None])
def test_the_cleanup_timer_switch_refuses_a_value_that_is_not_true_or_false(monkeypatch, value):
    """Text such as "false" would count as on, so it is refused instead of leaving the timer running unnoticed"""
    monkeypatch.setattr(expired_records, "_is_cleanup_timer_enabled", True)

    with pytest.raises(TypeError, match="set_cleanup_timer_enabled takes True or False"):
        extension.set_cleanup_timer_enabled(value)

    assert expired_records._is_cleanup_timer_enabled is True


async def test_running_only_the_cache_connection_part_makes_the_exchange_rate_cache_work(monkeypatch, freeze_now):
    """With no lifespan and no other step, the call with no store opens the configured cache and closes it after the block

    A rate looked up twice inside the block is fetched once and then served from the cache
    """
    monkeypatch.setattr(store_module, "VALKEY_URL", require("TEST_VALKEY_URL"))

    # The test ValKey also holds the dev app's own cache, so the configured store gets a namespace of this
    # test's own and never reads or writes the app's keys
    namespace = f"test-{uuid4().hex}:"
    build_store = ValkeyStore.from_url
    monkeypatch.setattr(ValkeyStore, "from_url", lambda url: build_store(url, namespace=namespace))
    freeze_now(rate_cache, _NOW)
    provider = FakeProvider({("USD", "CAD"): {_DAY: _RATE}})

    async with extension.use_valkey():
        store = get_valkey()
        assert isinstance(store, ValkeyStore), "the configured cache is open inside the block"
        assert store.namespace == namespace
        try:
            cached = CachedFxRateProvider(provider)
            assert await cached.get_rates("USD", "CAD", _DAY, _DAY) == {_DAY: _RATE}
            assert await cached.get_rates("USD", "CAD", _DAY, _DAY) == {_DAY: _RATE}
        finally:
            # A settled rate is stored for months, so the test's keys go with it
            keys = [key async for key in store.client.scan_iter(match=namespace + "*")]
            if keys:
                await store.client.delete(*keys)

    assert len(provider.calls) == 1, "the second lookup came from the cache"
    assert get_valkey() is None, "the cache is gone after the block"


async def test_the_database_key_checks_run_on_one_connection_and_the_data_check_comes_first(monkeypatch):
    """Both key checks run, the encryption key before the bank hash key, on the connection the step opened"""
    seen = []
    connection = object()

    @asynccontextmanager
    async def connect():
        yield connection

    async def record(name: str, given) -> None:
        seen.append((name, given))

    monkeypatch.setattr(database_keys, "engine", SimpleNamespace(connect=connect))
    monkeypatch.setattr(database_keys, "verify_key_matches_data", lambda given: record("data", given))
    monkeypatch.setattr(database_keys, "verify_key_matches_hashes", lambda given: record("hashes", given))

    await extension.verify_database_keys()

    assert seen == [("data", connection), ("hashes", connection)]


@pytest.mark.parametrize(
    ("configs", "logged"),
    [([], "OIDC sign-in is not configured"), ([SimpleNamespace(slug="generic")], "OIDC sign-in enabled for: generic")],
)
async def test_syncing_the_sign_in_providers_seeds_the_configured_ones_and_says_which_are_on(monkeypatch, caplog, configs, logged):
    """The provider table is reconciled with the configured providers, and the log names them or says there are none"""
    synced = []

    @asynccontextmanager
    async def open_session():
        yield "session"

    async def record(session, given) -> None:
        synced.append((session, given))

    monkeypatch.setattr(startup, "async_session", open_session)
    monkeypatch.setattr(startup, "sync_oidc_providers", record)
    monkeypatch.setattr(startup, "OIDC_PROVIDER_CONFIGS", configs)

    with caplog.at_level(logging.INFO, logger=startup.logger.name):
        await extension.sync_sign_in_providers()

    assert synced == [("session", configs)]
    assert logged in caplog.text
