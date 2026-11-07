"""Akahu's settings, read once as the provider loads"""

import logging

from app.config.bank_sync import provider_setting_key, read_count_setting, read_test_origin_setting

logger = logging.getLogger(__name__)

PROVIDER_ID = "akahu"

# The one origin Akahu requests reach, always over HTTPS and only at public addresses
AKAHU_ORIGIN = "https://api.akahu.io"

TEST_ORIGIN_KEY = provider_setting_key(PROVIDER_ID, "TEST_ORIGIN")
DAILY_REQUESTS_KEY = provider_setting_key(PROVIDER_ID, "DAILY_REQUESTS")


def warn_if_test_origin_set() -> None:
    """Warn while the testing-only origin is set, as the app and the bank sync worker each do when they start"""
    if AKAHU_TEST_ORIGIN:
        logger.warning(
            "%s sends Akahu requests only to %s, without HTTPS or the public address check, "
            "and refuses every other origin, Akahu's included. It is for testing only",
            TEST_ORIGIN_KEY,
            AKAHU_TEST_ORIGIN,
        )


# Testing only: while set, the one origin Akahu requests may reach, exempt from the HTTPS and public
# address checks, so development instances and browser tests reach a fake Akahu server on a private
# network and nothing else, not even a real connection restored from production. Unset by default
# and kept out of the environment variable docs, and the app and the bank sync worker each warn as
# they start while it is set
AKAHU_TEST_ORIGIN = read_test_origin_setting(TEST_ORIGIN_KEY)

# Syncs and listings each connection may run in a rolling 24 hours, each counted once however many
# requests it sends. Akahu publishes no rate limit, and a personal app's data refreshes once a day,
# so the default is generous
AKAHU_DAILY_REQUESTS = read_count_setting(DAILY_REQUESTS_KEY, 100)
