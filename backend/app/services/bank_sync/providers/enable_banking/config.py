"""Enable Banking's settings, read once as the provider loads"""

import logging

from app.config.bank_sync import provider_setting_key, read_count_setting, read_test_origin_setting

logger = logging.getLogger(__name__)

PROVIDER_ID = "enable_banking"

# The one origin Enable Banking requests reach, always over HTTPS and only at public addresses
ENABLE_BANKING_ORIGIN = "https://api.enablebanking.com"

TEST_ORIGIN_KEY = provider_setting_key(PROVIDER_ID, "TEST_ORIGIN")
DAILY_REQUESTS_KEY = provider_setting_key(PROVIDER_ID, "DAILY_REQUESTS")


def warn_if_test_origin_set() -> None:
    """Warn while the testing-only origin is set, as the app and the bank sync worker each do when they start"""
    if ENABLE_BANKING_TEST_ORIGIN:
        logger.warning(
            "%s sends Enable Banking requests only to %s, without HTTPS or the public address check, "
            "and refuses every other origin, Enable Banking's included. It is for testing only",
            TEST_ORIGIN_KEY,
            ENABLE_BANKING_TEST_ORIGIN,
        )


# Testing only: while set, the one origin Enable Banking requests may reach, exempt from the HTTPS and
# public address checks, so development instances and browser tests reach a fake Enable Banking server
# on a private network and nothing else. Unset by default and kept out of the environment variable
# docs, and the app and the bank sync worker each warn as they start while it is set
ENABLE_BANKING_TEST_ORIGIN = read_test_origin_setting(TEST_ORIGIN_KEY)

# Syncs and listings each connection may run in a rolling 24 hours, each counted once. Banks under
# PSD2 let an app read an account without the user present about four times a day, and each sync
# reads each account's balances and transactions once
ENABLE_BANKING_DAILY_REQUESTS = read_count_setting(DAILY_REQUESTS_KEY, 4)
