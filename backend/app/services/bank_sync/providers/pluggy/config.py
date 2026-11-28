"""Pluggy's settings, read once as the provider loads"""

import logging

from app.config.bank_sync import provider_setting_key, read_count_setting, read_test_origin_setting

logger = logging.getLogger(__name__)

PROVIDER_ID = "pluggy"

# The one origin Pluggy requests reach, always over HTTPS and only at public addresses
PLUGGY_ORIGIN = "https://api.pluggy.ai"

TEST_ORIGIN_KEY = provider_setting_key(PROVIDER_ID, "TEST_ORIGIN")
DAILY_REQUESTS_KEY = provider_setting_key(PROVIDER_ID, "DAILY_REQUESTS")


def warn_if_test_origin_set() -> None:
    """Warn while the testing-only origin is set, as the app and the bank sync worker each do when they start"""
    if PLUGGY_TEST_ORIGIN:
        logger.warning(
            "%s sends Pluggy requests only to %s, without HTTPS or the public address check, "
            "and refuses every other origin, Pluggy's included. It is for testing only",
            TEST_ORIGIN_KEY,
            PLUGGY_TEST_ORIGIN,
        )


# Testing only: while set, the one origin Pluggy requests may reach, exempt from the HTTPS and public
# address checks, so development instances and browser tests reach a fake Pluggy server on a private
# network and nothing else, not even a real connection restored from production. Unset by default
# and kept out of the environment variable docs, and the app and the bank sync worker each warn as
# they start while it is set
PLUGGY_TEST_ORIGIN = read_test_origin_setting(TEST_ORIGIN_KEY)

# Syncs and listings each connection may run in a rolling 24 hours, each counted once however many
# requests it sends. Pluggy limits each endpoint to 360 requests a minute and nothing per day, but it
# updates an item's data once a day and charges per request past a plan's minimum, so one an hour on
# average leaves room for an import and Sync now without paying for pulls that find nothing new
PLUGGY_DAILY_REQUESTS = read_count_setting(DAILY_REQUESTS_KEY, 24)
