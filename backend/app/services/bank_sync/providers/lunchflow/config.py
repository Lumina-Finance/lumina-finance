"""Lunch Flow's settings, read once as the provider loads"""

import logging

from app.config.bank_sync import provider_setting_key, read_count_setting, read_test_origin_setting

logger = logging.getLogger(__name__)

PROVIDER_ID = "lunchflow"

# The one origin Lunch Flow requests reach, always over HTTPS and only at public addresses. The bare
# lunchflow.app answers every API request with a permanent redirect here. Requests never follow one
LUNCHFLOW_ORIGIN = "https://www.lunchflow.app"

TEST_ORIGIN_KEY = provider_setting_key(PROVIDER_ID, "TEST_ORIGIN")
DAILY_REQUESTS_KEY = provider_setting_key(PROVIDER_ID, "DAILY_REQUESTS")


def warn_if_test_origin_set() -> None:
    """Warn while the testing-only origin is set, called as the app and the bank sync worker each start"""
    if LUNCHFLOW_TEST_ORIGIN:
        logger.warning(
            "%s sends Lunch Flow requests only to %s, without HTTPS or the public address check, "
            "and refuses every other origin, Lunch Flow's included. It is for testing only",
            TEST_ORIGIN_KEY,
            LUNCHFLOW_TEST_ORIGIN,
        )


# Testing only: while set, the one origin Lunch Flow requests may reach, exempt from the HTTPS and
# public address checks, so development instances and browser tests reach a fake Lunch Flow server on
# a private network and nothing else, not even a real connection restored from production. Unset by
# default and kept out of the environment variable docs. The app and the bank sync worker each
# warn as they start while it is set
LUNCHFLOW_TEST_ORIGIN = read_test_origin_setting(TEST_ORIGIN_KEY)

# Syncs and listings each connection may run in a rolling 24 hours, each counted once however many
# requests it sends. Lunch Flow publishes no limit and updates its data once a day, so one an hour on
# average leaves room for an import and Sync now without pulling far more often than the data changes
LUNCHFLOW_DAILY_REQUESTS = read_count_setting(DAILY_REQUESTS_KEY, 24)
